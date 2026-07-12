import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { ImageProviderInput, ImageProviderResult } from "../types.js";

const SUCCESS_STATUSES = new Set(["SUCCESS", "SUCCEED", "SUCCEEDED", "COMPLETED", "COMPLETE", "DONE", "FINISHED", "OK", "READY"]);
const FAILURE_STATUSES = new Set(["FAILURE", "FAILED", "FAIL", "ERROR", "ERRORED", "CANCELED", "CANCELLED", "TIMEOUT", "REJECTED", "EXPIRED"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authHeaders(json = true): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${config.image.apiKey}`
  };
  if (json) headers["content-type"] = "application/json";
  return headers;
}

function clampPollMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return config.image.pollMs;
  return Math.max(ms, config.image.minPollMs);
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function providerMode(): "openai-compatible" | "async-wrapper" {
  return config.image.providerMode === "async-wrapper" ? "async-wrapper" : "openai-compatible";
}

function describeProviderError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message) return message;
  }
  const message = record.message;
  if (typeof message === "string" && message) return message;
  const rawText = record.rawText;
  if (typeof rawText === "string" && rawText) return rawText.slice(0, 300);
  return "";
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function getNestedData(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const record = payload as Record<string, unknown>;
  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    return record.data as Record<string, unknown>;
  }
  return record;
}

function extractTaskId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const directTask = firstString(record.task_id) || firstString(record.taskId);
  if (directTask) return directTask;
  const id = firstString(record.id);
  if (id?.startsWith("task")) return id;
  if (record.data) return extractTaskId(record.data);
  return undefined;
}

function extractImage(payload: unknown): ImageProviderResult["image"] | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const data = Array.isArray(record.data) ? record.data : undefined;
  const first = data?.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
  if (first?.url) return { kind: "url", value: String(first.url), mimeType: "image/png" };
  if (first?.b64_json) return { kind: "b64", value: String(first.b64_json), mimeType: "image/png" };

  const nested = getNestedData(payload);
  const result = nested.result as Record<string, unknown> | undefined;
  const resultImages = Array.isArray(result?.images) ? result.images : undefined;
  const resultFirst = resultImages?.[0] as Record<string, unknown> | undefined;
  if (Array.isArray(resultFirst?.url) && resultFirst.url[0]) {
    return { kind: "url", value: String(resultFirst.url[0]), mimeType: "image/png" };
  }
  if (resultFirst?.url) return { kind: "url", value: String(resultFirst.url), mimeType: "image/png" };
  return undefined;
}

async function fetchJson(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<{ status: number; payload: unknown }> {
  const timeoutMs = Math.max(1, init?.timeoutMs || config.image.requestTimeoutMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const { timeoutMs: _timeoutMs, signal: _signal, ...fetchInit } = init || {};
  const response = await fetch(url, {
    ...fetchInit,
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { rawText: text };
  }
  if (!response.ok) {
    const detail = describeProviderError(payload);
    throw new Error(`Provider HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return { status: response.status, payload };
}

function imageTaskUrls(taskId: string): string[] {
  const root = config.image.baseUrl;
  return [
    `${root}/images/tasks/${encodeURIComponent(taskId)}`,
    `${root}/tasks/${encodeURIComponent(taskId)}`
  ];
}

function asyncJobPath(kind: "generations" | "edits"): string {
  return `/v1/images/${kind}`;
}

function asyncJobRequestUrl(kind: "generations" | "edits"): string {
  return `${config.image.baseUrl}/images/${kind}`;
}

function imageRequestParams(input: ImageProviderInput): Record<string, unknown> {
  const params: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    size: input.size,
    output_format: config.image.outputFormat,
    moderation: config.image.moderation,
    n: 1
  };
  if (input.quality !== "auto") params.quality = input.quality;
  return params;
}

async function waitForAsyncWrapperJob(jobId: string): Promise<unknown> {
  const deadline = Date.now() + config.image.timeoutMs;
  let pollAfterMs = config.image.pollMs;

  while (Date.now() < deadline) {
    const timeoutMs = Math.min(config.image.requestTimeoutMs, remainingMs(deadline));
    if (timeoutMs <= 0) break;
    const { payload } = await fetchJson(`${config.image.asyncBaseUrl}/image-jobs/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
      timeoutMs
    });
    const job = (payload && typeof payload === "object" ? (payload as Record<string, unknown>).job : undefined) as Record<string, unknown> | undefined;
    if (!job) throw new Error("Async image job missing job payload");
    const status = String(job.status || "").toLowerCase();
    if (status === "succeeded") {
      const responseBody = typeof job.responseBody === "string" ? job.responseBody : "{}";
      let responsePayload: unknown = {};
      try {
        responsePayload = JSON.parse(responseBody);
      } catch {
        responsePayload = { rawText: responseBody };
      }
      return responsePayload;
    }
    if (status === "failed") {
      const responseStatus = typeof job.responseStatus === "number" ? `HTTP ${job.responseStatus}: ` : "";
      const detail = firstString(job.error) || firstString(job.lastError) || "Async image job failed";
      throw new Error(`Async wrapper job ${jobId} failed: ${responseStatus}${detail}`);
    }
    const nextPoll = Number(job.pollAfterMs);
    pollAfterMs = clampPollMs(nextPoll);
    await sleep(Math.min(pollAfterMs, remainingMs(deadline)));
  }
  throw new Error(`Async image job timeout: ${jobId}`);
}

async function encodeFormDataForAsyncWrapper(form: FormData): Promise<string> {
  const fields: Array<Record<string, unknown>> = [];
  for (const [name, value] of form.entries()) {
    if (value instanceof Blob) {
      const isFile = typeof File !== "undefined" && value instanceof File;
      fields.push({
        name,
        type: "file",
        filename: isFile ? value.name : "blob",
        mimeType: value.type || "application/octet-stream",
        data: Buffer.from(await value.arrayBuffer()).toString("base64")
      });
    } else {
      fields.push({ name, type: "field", value: String(value) });
    }
  }
  return JSON.stringify({ fields });
}

async function createAsyncWrapperJob(params: {
  kind: "generations" | "edits";
  requestBody: string;
  contentType: string;
}): Promise<{ payload: unknown; providerTaskId?: string }> {
  const { payload } = await fetchJson(`${config.image.asyncBaseUrl}/image-jobs`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify({
      path: asyncJobPath(params.kind),
      requestUrl: asyncJobRequestUrl(params.kind),
      requestBody: params.requestBody,
      contentType: params.contentType
    })
  });

  const job = (payload && typeof payload === "object" ? (payload as Record<string, unknown>).job : undefined) as Record<string, unknown> | undefined;
  const jobId = typeof job?.id === "string" ? job.id : undefined;
  if (!jobId) throw new Error("Async wrapper returned no job id");
  return { payload: await waitForAsyncWrapperJob(jobId), providerTaskId: jobId };
}

async function waitForProviderTask(taskId: string): Promise<unknown> {
  const deadline = Date.now() + config.image.timeoutMs;
  let lastPayload: unknown = {};
  let lastError: unknown;

  while (Date.now() < deadline) {
    for (const url of imageTaskUrls(taskId)) {
      const timeoutMs = Math.min(config.image.requestTimeoutMs, remainingMs(deadline));
      if (timeoutMs <= 0) break;
      try {
        const { payload } = await fetchJson(url, { headers: authHeaders(false), timeoutMs });
        lastPayload = payload;
        const task = getNestedData(payload);
        const status = String(task.status || task.task_status || "").toUpperCase();
        if (SUCCESS_STATUSES.has(status)) return payload;
        if (FAILURE_STATUSES.has(status)) {
          const error = task.error && typeof task.error === "object" ? (task.error as Record<string, unknown>).message : undefined;
          throw new Error(String(task.fail_reason || task.message || error || "Provider task failed"));
        }
      } catch (error) {
        lastError = error;
      }
    }
    await sleep(Math.min(clampPollMs(config.image.pollMs), remainingMs(deadline)));
  }
  throw new Error(`Image task timeout: ${taskId}. Last error: ${lastError instanceof Error ? lastError.message : JSON.stringify(lastPayload)}`);
}

async function generateImage(input: ImageProviderInput): Promise<ImageProviderResult> {
  const requestJson = imageRequestParams(input);

  if (providerMode() === "async-wrapper") {
    const { payload, providerTaskId } = await createAsyncWrapperJob({
      kind: "generations",
      requestBody: JSON.stringify(requestJson),
      contentType: "application/json"
    });
    const image = extractImage(payload);
    if (!image) throw new Error("Async wrapper generation finished without image");
    return { image, requestJson, responseJson: payload, providerTaskId };
  }

  const { payload } = await fetchJson(`${config.image.baseUrl}/images/generations`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify(requestJson),
    timeoutMs: config.image.requestTimeoutMs
  });

  const directImage = extractImage(payload);
  if (directImage) return { image: directImage, requestJson, responseJson: payload };

  const taskId = extractTaskId(payload);
  if (!taskId) throw new Error("Provider returned no image or task id");
  const taskPayload = await waitForProviderTask(taskId);
  const image = extractImage(taskPayload);
  if (!image) throw new Error("Provider task succeeded without image");
  return { image, requestJson, responseJson: taskPayload, providerTaskId: taskId };
}

async function editImage(input: ImageProviderInput): Promise<ImageProviderResult> {
  const form = new FormData();
  for (const [name, value] of Object.entries(imageRequestParams(input))) {
    form.append(name, String(value));
  }

  for (const asset of input.inputAssets.slice(0, 4)) {
    const fileBuffer = await fs.readFile(asset.path);
    const blob = new Blob([fileBuffer], { type: asset.mimeType });
    form.append("image[]", blob, path.basename(asset.path));
  }

  if (providerMode() === "async-wrapper") {
    const { payload, providerTaskId } = await createAsyncWrapperJob({
      kind: "edits",
      requestBody: await encodeFormDataForAsyncWrapper(form),
      contentType: "application/x.gia-formdata+json"
    });
    const image = extractImage(payload);
    if (!image) throw new Error("Async wrapper edit finished without image");
    return { image, requestJson: { multipart: true, prompt: input.prompt }, responseJson: payload, providerTaskId };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.image.requestTimeoutMs);
  const response = await fetch(`${config.image.baseUrl}/images/edits`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.image.apiKey}`
    },
    body: form,
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { rawText: text };
  }
  if (!response.ok) throw new Error(`Provider edit HTTP ${response.status}`);

  const directImage = extractImage(payload);
  if (directImage) return { image: directImage, requestJson: { multipart: true, prompt: input.prompt }, responseJson: payload };

  const taskId = extractTaskId(payload);
  if (!taskId) throw new Error("Provider returned no edit image or task id");
  const taskPayload = await waitForProviderTask(taskId);
  const image = extractImage(taskPayload);
  if (!image) throw new Error("Provider edit task succeeded without image");
  return { image, requestJson: { multipart: true, prompt: input.prompt }, responseJson: taskPayload, providerTaskId: taskId };
}

function mockSvg(input: ImageProviderInput): string {
  const title = input.type === "composed" ? "Environment Preview" : "Ad Original";
  const prompt = input.prompt.slice(0, 180).replace(/[<>&]/g, "");
  const brandName = input.prompt.match(/must read exactly "([^"]{2,40})"/)?.[1]?.trim() || "店名待确认";
  const safeBrandName = brandName.replace(/[<>&]/g, "");
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
    '<rect width="1024" height="1024" fill="#f8fafc"/>',
    '<rect x="96" y="180" width="832" height="520" rx="24" fill="#ffffff" stroke="#111827" stroke-width="6"/>',
    `<text x="512" y="330" text-anchor="middle" font-family="Arial, sans-serif" font-size="72" font-weight="700" fill="#111827">${safeBrandName}</text>`,
    `<text x="512" y="430" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" fill="#475569">${title}</text>`,
    `<text x="128" y="780" font-family="Arial, sans-serif" font-size="24" fill="#334155">${prompt}</text>`,
    "</svg>"
  ].join("");
}

async function mockImage(input: ImageProviderInput): Promise<ImageProviderResult> {
  return {
    image: {
      kind: "b64",
      value: Buffer.from(mockSvg(input)).toString("base64"),
      mimeType: "image/svg+xml"
    },
    requestJson: { mock: true, input },
    responseJson: { mock: true }
  };
}

export async function callImageProvider(input: ImageProviderInput): Promise<ImageProviderResult> {
  if (input.mock) return mockImage(input);
  if (!config.image.apiKey) throw new Error("Live image generation is unavailable because the provider API key is not configured");
  return input.inputAssets.length > 0 ? editImage(input) : generateImage(input);
}

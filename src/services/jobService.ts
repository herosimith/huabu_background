import { nanoid } from "nanoid";
import { config } from "../config.js";
import { errorMessage, HttpError } from "../lib/errors.js";
import { nowIso } from "../lib/time.js";
import { store } from "../store/jsonStore.js";
import type { AssetRecord, JobRecord, JobType } from "../types.js";
import { callImageProvider } from "./imageProvider.js";
import { saveBase64ImageAsset, saveRemoteImageAsset } from "./assetService.js";

interface CreateJobInput {
  type: string;
  promptId?: string;
  prompt?: string;
  negativePrompt?: string;
  size?: string;
  quality?: string;
  model?: string;
  inputAssetIds?: string[];
  mock?: boolean;
  userId: string;
}

function outputTypeForJob(type: JobType): AssetRecord["type"] {
  return type === "composed" ? "composed" : "original";
}

function promptWithNegative(prompt: string, negative?: string): string {
  if (!negative?.trim()) return prompt;
  return `${prompt}\n\nAvoid: ${negative.trim()}`;
}

async function executeJob(jobId: string): Promise<void> {
  let job = await store.getJob(jobId);
  if (!job) return;

  job = {
    ...job,
    status: "running",
    startedAt: nowIso(),
    updatedAt: nowIso()
  };
  await store.saveJob(job);

  try {
    const inputAssets = await store.getAssets(job.inputAssetIds);
    const result = await callImageProvider({
      type: job.type,
      prompt: promptWithNegative(job.prompt, job.negativePrompt),
      size: job.size,
      quality: job.quality,
      model: job.model,
      inputAssets,
      mock: job.mock
    });

    let asset: AssetRecord;
    try {
      asset = result.image.kind === "url"
        ? await saveRemoteImageAsset({
          type: outputTypeForJob(job.type),
          url: result.image.value,
          jobId: job.id,
          promptId: job.promptId,
          userId: job.userId
        })
        : await saveBase64ImageAsset({
          type: outputTypeForJob(job.type),
          b64: result.image.value,
          mimeType: result.image.mimeType,
          jobId: job.id,
          promptId: job.promptId,
          userId: job.userId
        });
    } catch (error) {
      await store.saveFailedJobAndRefund({
        ...job,
        status: "failed",
        providerTaskId: result.providerTaskId,
        requestJson: result.requestJson,
        responseJson: result.responseJson,
        error: `Image output storage failed: ${errorMessage(error)}`,
        finishedAt: nowIso(),
        updatedAt: nowIso()
      });
      return;
    }

    await store.saveJob({
      ...job,
      status: "succeeded",
      providerTaskId: result.providerTaskId,
      requestJson: result.requestJson,
      responseJson: result.responseJson,
      assets: [asset],
      finishedAt: nowIso(),
      updatedAt: nowIso()
    });
  } catch (error) {
    await store.saveFailedJobAndRefund({
      ...job,
      status: "failed",
      error: errorMessage(error),
      finishedAt: nowIso(),
      updatedAt: nowIso()
    });
  }
}

export async function createJob(input: CreateJobInput): Promise<JobRecord> {
  const type = input.type === "composed" ? "composed" : "original";
  let prompt = input.prompt?.trim() || "";
  let negativePrompt = input.negativePrompt?.trim() || "";
  let requiredVisibleTexts: string[] = [];
  if (input.promptId) {
    const promptRecord = await store.getPrompt(input.promptId);
    if (!promptRecord) throw new HttpError(404, "promptId not found");
    if (promptRecord.userId && promptRecord.userId !== input.userId) throw new HttpError(403, "promptId belongs to another user");
    prompt ||= promptRecord.imagePrompt;
    negativePrompt ||= promptRecord.negativePrompt;
    requiredVisibleTexts = promptRecord.requiredVisibleTexts || [];
  }
  if (!prompt) throw new HttpError(400, "prompt is required");
  if (type === "composed" && config.image.apiKey && !input.inputAssetIds?.length) {
    throw new HttpError(400, "composed jobs require at least one inputAssetId in live mode");
  }

  const now = nowIso();
  const job: JobRecord = {
    id: `job_${nanoid(12)}`,
    type,
    status: "queued",
    promptId: input.promptId,
    prompt,
    negativePrompt,
    size: input.size || config.image.size,
    quality: input.quality || config.image.quality,
    model: input.model || config.image.model,
    inputAssetIds: input.inputAssetIds || [],
    userId: input.userId,
    requiredVisibleTexts,
    mock: Boolean(input.mock),
    assets: [],
    createdAt: now,
    updatedAt: now
  };
  const creditCost = job.mock ? 0 : config.auth.generatedJobCost;
  try {
    await store.createJobForUser(job, creditCost);
  } catch (error) {
    if (error instanceof Error && error.message === "Insufficient credits") throw new HttpError(409, "积分不足，无法开始真实生图");
    if (error instanceof Error && error.message === "Active user not found") throw new HttpError(401, "账号不可用");
    throw error;
  }
  void executeJob(job.id);
  return job;
}

export async function cleanupStaleJobs(): Promise<void> {
  const jobs = await store.listJobs();
  await Promise.all(jobs
    .filter((job) => job.status === "queued" || job.status === "running")
    .map((job) => store.saveFailedJobAndRefund({
      ...job,
      status: "failed",
      error: "Server restarted before this job completed",
      finishedAt: job.finishedAt || nowIso(),
      updatedAt: nowIso()
    })));
}

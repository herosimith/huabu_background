import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { AssetRecord, JobRecord, OcrRegion, TextPoint, TextValidationCheck, TextValidationRecord } from "../types.js";

interface OcrSidecarResponse {
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
  regions: OcrRegion[];
}

let validationQueue = Promise.resolve();

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[\s·・.。,'"“”‘’\-_:：，,;；!?！？()（）\[\]【】]/g, "");
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const saved = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
      diagonal = saved;
    }
  }
  return previous[right.length];
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  return 1 - editDistance(left, right) / Math.max(left.length, right.length);
}

function isInsideStorage(asset: AssetRecord): boolean {
  const relative = path.relative(config.storageDir, asset.path);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function point(value: unknown): TextPoint | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const x = number(record.x);
  const y = number(record.y);
  return x === null || y === null ? null : { x, y };
}

function parseRegions(value: unknown): OcrRegion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    const confidence = number(record.confidence);
    const polygon = Array.isArray(record.polygon) ? record.polygon.map(point).filter((item): item is TextPoint => Boolean(item)) : [];
    if (!text || confidence === null || polygon.length < 4) return [];
    return [{
      id: typeof record.id === "string" && record.id ? record.id : `ocr_${index + 1}`,
      text,
      confidence: Math.max(0, Math.min(1, confidence)),
      polygon
    }];
  });
}

async function callOcrSidecar(asset: AssetRecord): Promise<OcrSidecarResponse> {
  const buffer = await fs.readFile(asset.path);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: asset.mimeType }), asset.filename);
  form.append("max_edge", String(config.ocr.maxInputEdge));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ocr.timeoutMs);
  try {
    const response = await fetch(`${config.ocr.serviceUrl}/ocr`, {
      method: "POST",
      body: form,
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`OCR sidecar returned HTTP ${response.status}`);
    const payload = await response.json() as Record<string, unknown>;
    const sourceWidth = number(payload.sourceWidth);
    const sourceHeight = number(payload.sourceHeight);
    const scale = number(payload.scale);
    if (!sourceWidth || !sourceHeight || !scale || scale <= 0) throw new Error("OCR sidecar returned an invalid image geometry payload");
    return { sourceWidth, sourceHeight, scale, regions: parseRegions(payload.regions) };
  } finally {
    clearTimeout(timeout);
  }
}

function checksFor(expectedTexts: string[], regions: OcrRegion[]): TextValidationCheck[] {
  const assigned = new Set<string>();
  return expectedTexts.map((expectedText) => {
    const normalizedExpected = normalizeText(expectedText);
    const candidate = regions
      .filter((region) => !assigned.has(region.id))
      .map((region) => ({ region, score: similarity(normalizedExpected, normalizeText(region.text)) }))
      .sort((left, right) => right.score - left.score)[0];
    if (!candidate) return { expectedText, matched: false };
    assigned.add(candidate.region.id);
    const matched = normalizeText(candidate.region.text) === normalizedExpected && candidate.region.confidence >= config.ocr.minConfidence;
    return {
      expectedText,
      detectedText: candidate.region.text,
      confidence: candidate.region.confidence,
      regionId: candidate.region.id,
      matched
    };
  });
}

async function validate(job: JobRecord): Promise<TextValidationRecord> {
  const timestamp = nowIso();
  const expectedTexts = job.requiredVisibleTexts || [];
  const sourceAsset = job.assets.find((asset) => asset.type === job.type);
  if (!expectedTexts.length) {
    return {
      status: "needs_review",
      expectedTexts,
      regions: [],
      checks: [],
      error: "No required display text is stored for this job. Add exact text before validation.",
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }
  if (!sourceAsset || sourceAsset.jobId !== job.id || !isInsideStorage(sourceAsset)) {
    return {
      status: "unavailable",
      expectedTexts,
      regions: [],
      checks: expectedTexts.map((expectedText) => ({ expectedText, matched: false })),
      error: "The generated image asset is unavailable for local OCR.",
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }
  try {
    const result = await callOcrSidecar(sourceAsset);
    const checks = checksFor(expectedTexts, result.regions);
    return {
      status: checks.every((check) => check.matched) ? "passed" : "needs_review",
      expectedTexts,
      regions: result.regions,
      checks,
      sourceWidth: result.sourceWidth,
      sourceHeight: result.sourceHeight,
      scale: result.scale,
      createdAt: timestamp,
      updatedAt: timestamp
    };
  } catch (error) {
    return {
      status: "unavailable",
      expectedTexts,
      regions: [],
      checks: expectedTexts.map((expectedText) => ({ expectedText, matched: false })),
      error: error instanceof Error ? error.message : "OCR sidecar is unavailable",
      createdAt: timestamp,
      updatedAt: timestamp
    };
  }
}

export function validateJobText(job: JobRecord): Promise<TextValidationRecord> {
  const next = validationQueue.then(() => validate(job));
  validationQueue = next.then(() => undefined, () => undefined);
  return next;
}

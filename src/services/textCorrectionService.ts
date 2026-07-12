import path from "node:path";
import sharp from "sharp";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import type { AssetRecord, JobRecord, TextCorrection } from "../types.js";
import { saveBufferAsset } from "./assetService.js";

interface TextCorrectionInput {
  expectedText?: unknown;
  regionId?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  fontSize?: unknown;
  textColor?: unknown;
  coverColor?: unknown;
}

interface ApplyTextCorrectionsInput {
  job: JobRecord;
  sourceAsset: AssetRecord;
  corrections: unknown[];
}

interface ApplyTextCorrectionsResult {
  asset: AssetRecord;
  corrections: TextCorrection[];
}

let renderQueue = Promise.resolve();

sharp.cache(false);
sharp.concurrency(1);

function isInsideStorage(asset: AssetRecord): boolean {
  const relative = path.relative(config.storageDir, asset.path);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function asFiniteNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, `${label} must be a finite number`);
  return parsed;
}

function color(value: unknown, fallback: string, label: string): string {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!/^#[0-9a-fA-F]{6}$/.test(candidate)) throw new HttpError(400, `${label} must be a six-digit hex color`);
  return candidate;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character] || character));
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s·・.。,'"“”‘’\-_:：，,;；!?！？()（）\[\]【】]/g, "");
}

function correctionFromInput(input: unknown, job: JobRecord, imageWidth: number, imageHeight: number): TextCorrection {
  if (!input || typeof input !== "object") throw new HttpError(400, "Each correction must be an object");
  const value = input as TextCorrectionInput;
  const expectedText = typeof value.expectedText === "string" ? value.expectedText.trim().replace(/\s+/g, " ") : "";
  if (!expectedText || expectedText.length > 80) throw new HttpError(400, "expectedText must contain 1 to 80 characters");
  const expected = job.requiredVisibleTexts || [];
  if (!expected.some((item) => normalizeText(item) === normalizeText(expectedText))) {
    throw new HttpError(400, "expectedText must be one of this job's required display texts");
  }
  const regionId = typeof value.regionId === "string" && value.regionId ? value.regionId : undefined;
  if (regionId && !job.textValidation?.regions.some((region) => region.id === regionId)) {
    throw new HttpError(400, "regionId does not belong to this job's OCR result");
  }
  const x = clamp(asFiniteNumber(value.x, "x"), 0, Math.max(0, imageWidth - 8));
  const y = clamp(asFiniteNumber(value.y, "y"), 0, Math.max(0, imageHeight - 8));
  const width = clamp(asFiniteNumber(value.width, "width"), 8, Math.max(8, imageWidth - x));
  const height = clamp(asFiniteNumber(value.height, "height"), 8, Math.max(8, imageHeight - y));
  const proposedFontSize = value.fontSize === undefined ? height * 0.68 : asFiniteNumber(value.fontSize, "fontSize");
  return {
    expectedText,
    regionId,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    fontSize: Math.round(clamp(proposedFontSize, 10, Math.max(12, height * 1.1))),
    textColor: color(value.textColor, "#111827", "textColor"),
    coverColor: color(value.coverColor, "#ffffff", "coverColor")
  };
}

function renderSvg(width: number, height: number, corrections: TextCorrection[]): Buffer {
  const fontFamily = escapeXml(config.textRender.fontFamily);
  const layers = corrections.map((correction) => {
    const padding = Math.min(28, Math.max(4, Math.round(correction.height * 0.1)));
    const coverX = clamp(correction.x - padding, 0, width);
    const coverY = clamp(correction.y - padding, 0, height);
    const coverWidth = clamp(correction.width + padding * 2, 1, width - coverX);
    const coverHeight = clamp(correction.height + padding * 2, 1, height - coverY);
    const maxFont = Math.max(10, Math.floor((correction.width - padding * 2) / Math.max(1, correction.expectedText.length) * 0.95));
    const fontSize = Math.min(correction.fontSize, maxFont);
    const centerX = correction.x + correction.width / 2;
    const centerY = correction.y + correction.height / 2;
    return [
      `<rect x="${coverX}" y="${coverY}" width="${coverWidth}" height="${coverHeight}" rx="${Math.min(12, coverHeight / 5)}" fill="${correction.coverColor}"/>`,
      `<text x="${centerX}" y="${centerY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamily}" font-size="${fontSize}" font-weight="700" fill="${correction.textColor}">${escapeXml(correction.expectedText)}</text>`
    ].join("");
  }).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${layers}</svg>`);
}

async function apply(input: ApplyTextCorrectionsInput): Promise<ApplyTextCorrectionsResult> {
  const { job, sourceAsset } = input;
  if (sourceAsset.jobId !== job.id || sourceAsset.type !== job.type || !isInsideStorage(sourceAsset)) {
    throw new HttpError(400, "Text corrections can only use this job's original local image asset");
  }
  if (!Array.isArray(input.corrections) || input.corrections.length < 1 || input.corrections.length > 8) {
    throw new HttpError(400, "Provide between 1 and 8 text corrections");
  }
  const inputImage = sharp(sourceAsset.path, {
    limitInputPixels: config.textRender.maxInputPixels,
    sequentialRead: true
  });
  const metadata = await inputImage.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new HttpError(422, "Unable to read source image dimensions");
  const corrections = input.corrections.map((correction) => correctionFromInput(correction, job, width, height));
  const unique = new Set(corrections.map((correction) => normalizeText(correction.expectedText)));
  if (unique.size !== corrections.length) throw new HttpError(400, "Only one correction per required text is allowed");
  const buffer = await sharp(sourceAsset.path, {
    limitInputPixels: config.textRender.maxInputPixels,
    sequentialRead: true
  })
    .composite([{ input: renderSvg(width, height, corrections), top: 0, left: 0 }])
    .png()
    .toBuffer();
  const asset = await saveBufferAsset({
    type: "corrected",
    buffer,
    mimeType: "image/png",
    jobId: job.id,
    promptId: job.promptId
  });
  return { asset, corrections };
}

export function applyTextCorrections(input: ApplyTextCorrectionsInput): Promise<ApplyTextCorrectionsResult> {
  const next = renderQueue.then(() => apply(input));
  renderQueue = next.then(() => undefined, () => undefined);
  return next;
}

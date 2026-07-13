import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { ensureDir } from "../lib/fs.js";
import { nowIso } from "../lib/time.js";
import { store } from "../store/jsonStore.js";
import type { AssetRecord, AssetType } from "../types.js";

function extensionFromMime(mimeType: string): string {
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("svg")) return "svg";
  return "png";
}

function safeExtension(params: { mimeType: string; filename?: string; type: AssetType }): string {
  if (params.type === "upload") return extensionFromMime(params.mimeType);
  const ext = params.filename?.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext || extensionFromMime(params.mimeType);
}

export async function saveBufferAsset(params: {
  type: AssetType;
  buffer: Buffer;
  mimeType: string;
  jobId?: string;
  promptId?: string;
  userId?: string;
  filename?: string;
}): Promise<AssetRecord> {
  const id = `asset_${nanoid(12)}`;
  const folder = params.type === "upload" ? "uploads" : params.type;
  const ext = safeExtension({ mimeType: params.mimeType, filename: params.filename, type: params.type });
  const filename = `${id}.${ext}`;
  const absDir = path.join(config.storageDir, folder);
  await ensureDir(absDir);
  const absPath = path.join(absDir, filename);
  await fs.writeFile(absPath, params.buffer);

  const record: AssetRecord = {
    id,
    type: params.type,
    filename,
    mimeType: params.mimeType,
    path: absPath,
    url: `/storage/${folder}/${filename}`,
    size: params.buffer.length,
    jobId: params.jobId,
    promptId: params.promptId,
    userId: params.userId,
    createdAt: nowIso()
  };
  await store.saveAsset(record);
  return record;
}

export async function saveRemoteImageAsset(params: {
  type: AssetType;
  url: string;
  jobId?: string;
  promptId?: string;
  userId?: string;
}): Promise<AssetRecord> {
  const response = await fetch(params.url);
  if (!response.ok) {
    throw new Error(`Image download failed: HTTP ${response.status}`);
  }
  const mimeType = response.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return saveBufferAsset({
    type: params.type,
    buffer,
    mimeType,
    jobId: params.jobId,
    promptId: params.promptId,
    userId: params.userId
  });
}

export async function saveBase64ImageAsset(params: {
  type: AssetType;
  b64: string;
  mimeType?: string;
  jobId?: string;
  promptId?: string;
  userId?: string;
}): Promise<AssetRecord> {
  const clean = params.b64.includes(",") ? params.b64.split(",", 2)[1] : params.b64;
  return saveBufferAsset({
    type: params.type,
    buffer: Buffer.from(clean, "base64"),
    mimeType: params.mimeType || "image/png",
    jobId: params.jobId,
    promptId: params.promptId,
    userId: params.userId
  });
}

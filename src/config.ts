import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, "..");

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function localServiceUrl(value: string): string {
  const url = new URL(value);
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (url.protocol !== "http:" || !localHosts.has(url.hostname)) {
    throw new Error("OCR_SERVICE_URL must point to a local http sidecar");
  }
  return value.replace(/\/+$/, "");
}

export const config = {
  rootDir,
  port: numberEnv("PORT", 4177),
  dataDir: path.join(rootDir, "data"),
  storageDir: path.join(rootDir, "storage"),
  promptLibrary: {
    dir: path.join(rootDir, "assets", "prompt-library"),
    dataPath: path.join(rootDir, "assets", "prompt-library", "data.full.json"),
    imagesDir: path.join(rootDir, "assets", "prompt-library", "images")
  },
  upload: {
    maxBytes: numberEnv("UPLOAD_MAX_BYTES", 10 * 1024 * 1024)
  },
  image: {
    providerMode: process.env.IMAGE_PROVIDER_MODE || "openai-compatible",
    baseUrl: (process.env.OPENAI_IMAGE_BASE_URL || "https://apic.aksearch.site/v1").replace(/\/+$/, ""),
    asyncBaseUrl: (process.env.IMAGE_ASYNC_BASE_URL || "https://apic.aksearch.site/image/async-api").replace(/\/+$/, ""),
    apiKey: process.env.OPENAI_IMAGE_API_KEY || "",
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    size: process.env.OPENAI_IMAGE_SIZE || "1024x1024",
    quality: process.env.OPENAI_IMAGE_QUALITY || "high",
    outputFormat: process.env.OPENAI_IMAGE_OUTPUT_FORMAT || "png",
    moderation: process.env.OPENAI_IMAGE_MODERATION || "auto",
    pollMs: numberEnv("IMAGE_JOB_POLL_MS", 2000),
    minPollMs: numberEnv("IMAGE_JOB_MIN_POLL_MS", 1000),
    requestTimeoutMs: numberEnv("IMAGE_REQUEST_TIMEOUT_MS", 30000),
    timeoutMs: numberEnv("IMAGE_JOB_TIMEOUT_MS", 600000)
  },
  chat: {
    baseUrl: (process.env.OPENAI_CHAT_BASE_URL || process.env.OPENAI_IMAGE_BASE_URL || "https://apic.aksearch.site/v1").replace(/\/+$/, ""),
    apiKey: process.env.OPENAI_CHAT_API_KEY || process.env.OPENAI_IMAGE_API_KEY || "",
    model: process.env.OPENAI_CHAT_MODEL || "gpt-5.5",
    timeoutMs: numberEnv("OPENAI_CHAT_TIMEOUT_MS", 30000)
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    baseUrl: (process.env.ANTHROPIC_BASE_URL || "https://apic.aksearch.site").replace(/\/+$/, ""),
    model: process.env.ANTHROPIC_MODEL || ""
  },
  ocr: {
    serviceUrl: localServiceUrl(process.env.OCR_SERVICE_URL || "http://127.0.0.1:4188"),
    timeoutMs: numberEnv("OCR_REQUEST_TIMEOUT_MS", 25_000),
    maxInputEdge: numberEnv("OCR_MAX_INPUT_EDGE", 2048),
    minConfidence: Math.min(1, Number(process.env.OCR_MIN_CONFIDENCE || 0.7) || 0.7)
  },
  textRender: {
    fontFamily: process.env.TEXT_RENDER_FONT_FAMILY || "Hiragino Sans GB, Noto Sans CJK SC, Microsoft YaHei, sans-serif",
    maxInputPixels: numberEnv("TEXT_RENDER_MAX_INPUT_PIXELS", 40_000_000)
  }
};

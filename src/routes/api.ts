import express from "express";
import multer from "multer";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { store } from "../store/jsonStore.js";
import { saveBufferAsset } from "../services/assetService.js";
import { createJob } from "../services/jobService.js";
import { createPrompt } from "../services/promptService.js";
import { resolvePromptLibraryImage } from "../services/promptLibrary.js";

const allowedJobTypes = new Set(["original", "composed"]);
const allowedImageSizes = new Set(["1024x1024", "1024x1536", "1536x1024", "1792x1024", "1024x1792", "auto"]);
const allowedImageQualities = new Set(["low", "medium", "high", "auto"]);
const allowedUploadTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxBytes
  }
});

export const apiRouter = express.Router();

apiRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    mode: config.image.apiKey ? "live" : "mock",
    imageBaseUrl: config.image.baseUrl,
    model: config.image.model
  });
});

apiRouter.post("/prompt", async (req, res, next) => {
  try {
    const customerText = String(req.body.customerText || "").trim();
    if (!customerText) throw new HttpError(400, "customerText is required");
    const prompt = await createPrompt({
      customerText,
      businessType: req.body.businessType,
      material: req.body.material,
      style: req.body.style
    });
    res.json({ prompt });
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/prompts/:id", async (req, res, next) => {
  try {
    const prompt = await store.getPrompt(req.params.id);
    if (!prompt) throw new HttpError(404, "Prompt not found");
    res.json({ prompt });
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/prompt-library/images/:filename", async (req, res, next) => {
  try {
    const imagePath = await resolvePromptLibraryImage(req.params.filename);
    if (!imagePath) throw new HttpError(404, "Prompt library image not found");
    res.setHeader("x-content-type-options", "nosniff");
    res.sendFile(imagePath);
  } catch (error) {
    next(error);
  }
});

apiRouter.post("/uploads", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, "file is required");
    if (!allowedUploadTypes.has(req.file.mimetype)) {
      throw new HttpError(400, `file type must be one of: ${Array.from(allowedUploadTypes).join(", ")}`);
    }
    const asset = await saveBufferAsset({
      type: "upload",
      buffer: req.file.buffer,
      mimeType: req.file.mimetype || "application/octet-stream",
      filename: req.file.originalname
    });
    res.json({ asset });
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/assets/:id", async (req, res, next) => {
  try {
    const asset = await store.getAsset(req.params.id);
    if (!asset) throw new HttpError(404, "Asset not found");
    res.json({ asset });
  } catch (error) {
    next(error);
  }
});

apiRouter.post("/jobs", async (req, res, next) => {
  try {
    const type = String(req.body.type || "");
    if (!allowedJobTypes.has(type)) {
      throw new HttpError(400, `type must be one of: ${Array.from(allowedJobTypes).join(", ")}`);
    }
    const size = String(req.body.size || config.image.size);
    if (!allowedImageSizes.has(size)) {
      throw new HttpError(400, `size must be one of: ${Array.from(allowedImageSizes).join(", ")}`);
    }
    const quality = String(req.body.quality || config.image.quality);
    if (!allowedImageQualities.has(quality)) {
      throw new HttpError(400, `quality must be one of: ${Array.from(allowedImageQualities).join(", ")}`);
    }
    const inputAssetIds: string[] = Array.isArray(req.body.inputAssetIds)
      ? Array.from(new Set(req.body.inputAssetIds.map((id: unknown) => String(id).trim()).filter(Boolean)))
      : [];
    if (inputAssetIds.length) {
      const assets = await store.getAssets(inputAssetIds);
      if (assets.length !== inputAssetIds.length) {
        throw new HttpError(400, "one or more inputAssetIds were not found");
      }
    }
    const job = await createJob({
      type,
      promptId: req.body.promptId,
      prompt: req.body.prompt,
      negativePrompt: req.body.negativePrompt,
      size,
      quality,
      model: req.body.model,
      inputAssetIds,
      mock: req.body.mock === true
    });
    res.status(202).json({ job });
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/jobs/:id", async (req, res, next) => {
  try {
    const job = await store.getJob(req.params.id);
    if (!job) throw new HttpError(404, "Job not found");
    res.json({ job });
  } catch (error) {
    next(error);
  }
});

apiRouter.post("/vector-assets", async (req, res, next) => {
  try {
    const svg = String(req.body.svg || "").trim();
    if (!svg.startsWith("<svg")) throw new HttpError(400, "svg is required");
    if (/<script[\s>]/i.test(svg) || /\son[a-z]+\s*=/i.test(svg) || /javascript:/i.test(svg)) {
      throw new HttpError(400, "svg contains unsafe content");
    }
    const asset = await saveBufferAsset({
      type: "vector",
      buffer: Buffer.from(svg, "utf8"),
      mimeType: "image/svg+xml",
      jobId: req.body.jobId,
      promptId: req.body.promptId
    });
    res.json({ asset });
  } catch (error) {
    next(error);
  }
});

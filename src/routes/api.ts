import express from "express";
import multer from "multer";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { imageSizeValidationError } from "../lib/imageSize.js";
import { store } from "../store/jsonStore.js";
import { saveBufferAsset } from "../services/assetService.js";
import { createJob } from "../services/jobService.js";
import { createPrompt } from "../services/promptService.js";
import { resolvePromptLibraryImage } from "../services/promptLibrary.js";
import { applyTextCorrections } from "../services/textCorrectionService.js";
import { validateJobText } from "../services/textValidationService.js";
import { authRouter } from "./auth.js";
import { adminRouter } from "./admin.js";
import { canAccessOwner, requireAuth, requireCanvasEditor } from "../middleware/auth.js";

const allowedJobTypes = new Set(["original", "composed"]);
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

apiRouter.use("/auth", authRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use(requireAuth);

apiRouter.post("/prompt", requireCanvasEditor, async (req, res, next) => {
  try {
    const customerText = String(req.body.customerText || "").trim();
    if (!customerText) throw new HttpError(400, "customerText is required");
    const prompt = await createPrompt({
      customerText,
      businessType: req.body.businessType,
      material: req.body.material,
      style: req.body.style,
      requiredVisibleTexts: Array.isArray(req.body.requiredVisibleTexts)
        ? req.body.requiredVisibleTexts.map((value: unknown) => String(value || ""))
        : undefined,
      userId: req.authUser!.id
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
    if (!canAccessOwner(req, prompt.userId)) throw new HttpError(403, "无权访问此提示词");
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

apiRouter.post("/uploads", requireCanvasEditor, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, "file is required");
    if (!allowedUploadTypes.has(req.file.mimetype)) {
      throw new HttpError(400, `file type must be one of: ${Array.from(allowedUploadTypes).join(", ")}`);
    }
    const asset = await saveBufferAsset({
      type: "upload",
      buffer: req.file.buffer,
      mimeType: req.file.mimetype || "application/octet-stream",
      filename: req.file.originalname,
      userId: req.authUser!.id
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
    if (!canAccessOwner(req, asset.userId)) throw new HttpError(403, "无权访问此素材");
    res.json({ asset });
  } catch (error) {
    next(error);
  }
});

apiRouter.post("/jobs", requireCanvasEditor, async (req, res, next) => {
  try {
    const type = String(req.body.type || "");
    if (!allowedJobTypes.has(type)) {
      throw new HttpError(400, `type must be one of: ${Array.from(allowedJobTypes).join(", ")}`);
    }
    const size = String(req.body.size || config.image.size).trim();
    const sizeError = imageSizeValidationError(size);
    if (sizeError) throw new HttpError(400, sizeError);
    const quality = String(req.body.quality || config.image.quality);
    if (!allowedImageQualities.has(quality)) {
      throw new HttpError(400, `quality must be one of: ${Array.from(allowedImageQualities).join(", ")}`);
    }
    const mock = req.body.mock === true;
    if (!mock && !config.image.apiKey) {
      throw new HttpError(503, "Live image generation is unavailable because the provider API key is not configured");
    }
    const inputAssetIds: string[] = Array.isArray(req.body.inputAssetIds)
      ? Array.from(new Set(req.body.inputAssetIds.map((id: unknown) => String(id).trim()).filter(Boolean)))
      : [];
    if (inputAssetIds.length) {
      const assets = await store.getAssets(inputAssetIds);
      if (assets.length !== inputAssetIds.length) {
        throw new HttpError(400, "one or more inputAssetIds were not found");
      }
      if (assets.some((asset) => !canAccessOwner(req, asset.userId))) throw new HttpError(403, "无权使用一个或多个素材");
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
      mock,
      userId: req.authUser!.id
    });
    res.status(202).json({ job });
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/jobs/:id", async (req, res, next) => {
  try {
    const job = await store.getJob(String(req.params.id));
    if (!job) throw new HttpError(404, "Job not found");
    if (!canAccessOwner(req, job.userId)) throw new HttpError(403, "无权访问此任务");
    res.json({ job });
  } catch (error) {
    next(error);
  }
});

apiRouter.post("/jobs/:id/text-validation", requireCanvasEditor, async (req, res, next) => {
  try {
    const job = await store.getJob(String(req.params.id));
    if (!job) throw new HttpError(404, "Job not found");
    if (!canAccessOwner(req, job.userId)) throw new HttpError(403, "无权访问此任务");
    if (job.status !== "succeeded") throw new HttpError(409, "Text validation requires a completed job");
    const textValidation = await validateJobText(job);
    const updatedJob = await store.saveJob({ ...job, textValidation, updatedAt: new Date().toISOString() });
    res.json({ job: updatedJob });
  } catch (error) {
    next(error);
  }
});

apiRouter.post("/jobs/:id/text-corrections", requireCanvasEditor, async (req, res, next) => {
  try {
    const job = await store.getJob(String(req.params.id));
    if (!job) throw new HttpError(404, "Job not found");
    if (!canAccessOwner(req, job.userId)) throw new HttpError(403, "无权访问此任务");
    if (job.status !== "succeeded") throw new HttpError(409, "Text correction requires a completed job");
    const sourceAsset = job.assets.find((asset) => asset.type === job.type);
    if (!sourceAsset) throw new HttpError(409, "Job has no correctable source asset");
    const corrections = Array.isArray(req.body.corrections) ? req.body.corrections : [];
    const result = await applyTextCorrections({ job, sourceAsset, corrections });
    const updatedJob = await store.saveJob({
      ...job,
      textCorrections: result.corrections,
      correctedAssets: [...(job.correctedAssets || []), result.asset].slice(-5),
      updatedAt: new Date().toISOString()
    });
    res.json({ job: updatedJob, asset: result.asset });
  } catch (error) {
    next(error);
  }
});

apiRouter.post("/vector-assets", requireCanvasEditor, async (req, res, next) => {
  try {
    const svg = String(req.body.svg || "").trim();
    if (!svg.startsWith("<svg")) throw new HttpError(400, "svg is required");
    if (/<script[\s>]/i.test(svg) || /\son[a-z]+\s*=/i.test(svg) || /javascript:/i.test(svg)) {
      throw new HttpError(400, "svg contains unsafe content");
    }
    if (req.body.jobId) {
      const job = await store.getJob(String(req.body.jobId));
      if (!job || !canAccessOwner(req, job.userId)) throw new HttpError(403, "无权关联此任务");
    }
    if (req.body.promptId) {
      const prompt = await store.getPrompt(String(req.body.promptId));
      if (!prompt || !canAccessOwner(req, prompt.userId)) throw new HttpError(403, "无权关联此提示词");
    }
    const asset = await saveBufferAsset({
      type: "vector",
      buffer: Buffer.from(svg, "utf8"),
      mimeType: "image/svg+xml",
      jobId: req.body.jobId,
      promptId: req.body.promptId,
      userId: req.authUser!.id
    });
    res.json({ asset });
  } catch (error) {
    next(error);
  }
});

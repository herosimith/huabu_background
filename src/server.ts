import path from "node:path";
import express from "express";
import { config } from "./config.js";
import { HttpError, errorMessage } from "./lib/errors.js";
import { ensureDir } from "./lib/fs.js";
import { apiRouter } from "./routes/api.js";
import { cleanupStaleJobs } from "./services/jobService.js";
import { bootstrapAdmin } from "./services/authService.js";
import { canAccessOwner, requireAuth } from "./middleware/auth.js";
import { store } from "./store/jsonStore.js";

await ensureDir(config.dataDir);
await ensureDir(config.storageDir);
await bootstrapAdmin();
await cleanupStaleJobs();

const app = express();

app.set("trust proxy", 1);
app.use(express.json({ limit: "20mb" }));
app.use("/storage", requireAuth, async (req, res, next) => {
  const filename = path.basename(req.path);
  const asset = await store.getAssetByFilename(filename);
  if (!asset) return res.status(404).json({ error: { message: "Asset not found" } });
  if (!canAccessOwner(req, asset.userId)) return res.status(403).json({ error: { message: "无权访问此素材" } });
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'none'; script-src 'none'; sandbox");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
}, express.static(path.join(config.storageDir)));
app.use("/api", apiRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = error instanceof HttpError ? error.status : 500;
  res.status(status).json({
    error: {
      message: errorMessage(error)
    }
  });
});

app.listen(config.port, config.host, () => {
  console.log(`AdCraft AI MVP backend listening on http://${config.host}:${config.port}`);
  console.log(`Image provider mode: ${config.image.apiKey ? "live" : "mock"}`);
});

import path from "node:path";
import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { HttpError, errorMessage } from "./lib/errors.js";
import { ensureDir } from "./lib/fs.js";
import { apiRouter } from "./routes/api.js";
import { cleanupStaleJobs } from "./services/jobService.js";

await ensureDir(config.dataDir);
await ensureDir(config.storageDir);
await cleanupStaleJobs();

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use("/storage", (_req, res, next) => {
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

app.listen(config.port, () => {
  console.log(`AdCraft AI MVP backend listening on http://127.0.0.1:${config.port}`);
  console.log(`Image provider mode: ${config.image.apiKey ? "live" : "mock"}`);
});

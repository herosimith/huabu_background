import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import type { AssetRecord, DatabaseShape, JobRecord, PromptRecord } from "../types.js";
import { ensureDir } from "../lib/fs.js";

const dbPath = path.join(config.dataDir, "db.json");

const emptyDb: DatabaseShape = {
  prompts: [],
  jobs: [],
  assets: []
};

let writeQueue = Promise.resolve();

async function readDb(): Promise<DatabaseShape> {
  await ensureDir(config.dataDir);
  try {
    const raw = await fs.readFile(dbPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<DatabaseShape>;
    return {
      prompts: Array.isArray(parsed.prompts) ? parsed.prompts : [],
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      assets: Array.isArray(parsed.assets) ? parsed.assets : []
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await writeDb(emptyDb);
      return structuredClone(emptyDb);
    }
    throw error;
  }
}

async function writeDb(db: DatabaseShape): Promise<void> {
  await ensureDir(config.dataDir);
  const temp = `${dbPath}.${nanoid(8)}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await fs.rename(temp, dbPath);
}

async function updateDb<T>(fn: (db: DatabaseShape) => T | Promise<T>): Promise<T> {
  const next = writeQueue.then(async () => {
    const db = await readDb();
    const result = await fn(db);
    await writeDb(db);
    return result;
  });
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}

export const store = {
  async listJobs(): Promise<JobRecord[]> {
    return (await readDb()).jobs;
  },

  async getJob(id: string): Promise<JobRecord | undefined> {
    return (await readDb()).jobs.find((job) => job.id === id);
  },

  async saveJob(job: JobRecord): Promise<JobRecord> {
    return updateDb((db) => {
      const index = db.jobs.findIndex((item) => item.id === job.id);
      if (index >= 0) db.jobs[index] = job;
      else db.jobs.unshift(job);
      return job;
    });
  },

  async savePrompt(prompt: PromptRecord): Promise<PromptRecord> {
    return updateDb((db) => {
      const index = db.prompts.findIndex((item) => item.id === prompt.id);
      if (index >= 0) db.prompts[index] = prompt;
      else db.prompts.unshift(prompt);
      return prompt;
    });
  },

  async getPrompt(id: string): Promise<PromptRecord | undefined> {
    return (await readDb()).prompts.find((prompt) => prompt.id === id);
  },

  async saveAsset(asset: AssetRecord): Promise<AssetRecord> {
    return updateDb((db) => {
      const index = db.assets.findIndex((item) => item.id === asset.id);
      if (index >= 0) db.assets[index] = asset;
      else db.assets.unshift(asset);
      return asset;
    });
  },

  async getAsset(id: string): Promise<AssetRecord | undefined> {
    return (await readDb()).assets.find((asset) => asset.id === id);
  },

  async getAssets(ids: string[]): Promise<AssetRecord[]> {
    const wanted = new Set(ids);
    return (await readDb()).assets.filter((asset) => wanted.has(asset.id));
  }
};

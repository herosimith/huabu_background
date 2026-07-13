import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import type { AssetRecord, CreditTransactionRecord, DatabaseShape, JobRecord, PromptRecord, UserRecord } from "../types.js";
import { ensureDir } from "../lib/fs.js";

const dbPath = path.join(config.dataDir, "db.json");

const emptyDb: DatabaseShape = {
  prompts: [],
  jobs: [],
  assets: [],
  users: [],
  creditTransactions: []
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
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
      users: Array.isArray(parsed.users) ? parsed.users : [],
      creditTransactions: Array.isArray(parsed.creditTransactions) ? parsed.creditTransactions : []
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
  async readSnapshot(): Promise<DatabaseShape> {
    return readDb();
  },

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

  async createJobForUser(job: JobRecord, creditCost: number): Promise<JobRecord> {
    return updateDb((db) => {
      const user = db.users.find((item) => item.id === job.userId);
      if (!user || user.status !== "active") throw new Error("Active user not found");
      if (creditCost > user.creditBalance) throw new Error("Insufficient credits");
      const now = new Date().toISOString();
      user.creditBalance -= creditCost;
      user.generationCount += 1;
      user.lastActiveAt = now;
      user.updatedAt = now;
      if (creditCost > 0) {
        db.creditTransactions.unshift({
          id: `credit_${nanoid(12)}`,
          userId: user.id,
          type: "generation",
          amount: -creditCost,
          balanceAfter: user.creditBalance,
          reason: "AI 图片生成",
          relatedJobId: job.id,
          createdAt: now
        });
      }
      job.creditsConsumed = creditCost;
      db.jobs.unshift(job);
      return job;
    });
  },

  async saveFailedJobAndRefund(job: JobRecord): Promise<JobRecord> {
    return updateDb((db) => {
      const index = db.jobs.findIndex((item) => item.id === job.id);
      const previous = index >= 0 ? db.jobs[index] : undefined;
      const refundable = previous?.creditsConsumed || 0;
      if (previous?.creditsRefundedAt && !job.creditsRefundedAt) job.creditsRefundedAt = previous.creditsRefundedAt;
      if (refundable > 0 && !previous?.creditsRefundedAt && previous?.userId) {
        const user = db.users.find((item) => item.id === previous.userId);
        if (user) {
          const now = new Date().toISOString();
          user.creditBalance += refundable;
          user.updatedAt = now;
          db.creditTransactions.unshift({
            id: `credit_${nanoid(12)}`,
            userId: user.id,
            type: "refund",
            amount: refundable,
            balanceAfter: user.creditBalance,
            reason: "生成失败自动退回",
            relatedJobId: job.id,
            createdAt: now
          });
          job.creditsRefundedAt = now;
        }
      }
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

  async getAssetByFilename(filename: string): Promise<AssetRecord | undefined> {
    return (await readDb()).assets.find((asset) => asset.filename === filename);
  },

  async getAssets(ids: string[]): Promise<AssetRecord[]> {
    const wanted = new Set(ids);
    return (await readDb()).assets.filter((asset) => wanted.has(asset.id));
  },

  async listUsers(): Promise<UserRecord[]> {
    return (await readDb()).users;
  },

  async getUser(id: string): Promise<UserRecord | undefined> {
    return (await readDb()).users.find((user) => user.id === id);
  },

  async getUserByEmail(email: string): Promise<UserRecord | undefined> {
    const normalized = email.trim().toLowerCase();
    return (await readDb()).users.find((user) => user.email === normalized);
  },

  async createUser(user: UserRecord, initialTransaction?: CreditTransactionRecord): Promise<UserRecord> {
    return updateDb((db) => {
      if (db.users.some((item) => item.email === user.email)) throw new Error("Email already exists");
      if (user.phone && db.users.some((item) => item.phone === user.phone)) throw new Error("Phone already exists");
      db.users.unshift(user);
      if (initialTransaction) db.creditTransactions.unshift(initialTransaction);
      return user;
    });
  },

  async updateUser(id: string, mutate: (user: UserRecord, db: DatabaseShape) => void): Promise<UserRecord> {
    return updateDb((db) => {
      const user = db.users.find((item) => item.id === id);
      if (!user) throw new Error("User not found");
      mutate(user, db);
      return user;
    });
  },

  async adjustUserCredits(params: {
    userId: string;
    amount: number;
    reason: string;
    operatorId: string;
  }): Promise<{ user: UserRecord; transaction: CreditTransactionRecord }> {
    return updateDb((db) => {
      const user = db.users.find((item) => item.id === params.userId);
      if (!user) throw new Error("User not found");
      const balanceAfter = user.creditBalance + params.amount;
      if (balanceAfter < 0) throw new Error("Insufficient credits");
      const now = new Date().toISOString();
      user.creditBalance = balanceAfter;
      user.updatedAt = now;
      const transaction: CreditTransactionRecord = {
        id: `credit_${nanoid(12)}`,
        userId: user.id,
        type: "admin_adjust",
        amount: params.amount,
        balanceAfter,
        reason: params.reason,
        operatorId: params.operatorId,
        createdAt: now
      };
      db.creditTransactions.unshift(transaction);
      return { user, transaction };
    });
  },

  async listCreditTransactions(userId: string): Promise<CreditTransactionRecord[]> {
    return (await readDb()).creditTransactions.filter((item) => item.userId === userId);
  }
};

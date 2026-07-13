import crypto from "node:crypto";
import { promisify } from "node:util";
import { nanoid } from "nanoid";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { nowIso } from "../lib/time.js";
import { store } from "../store/jsonStore.js";
import type { CreditTransactionRecord, UserRecord } from "../types.js";

const scrypt = promisify(crypto.scrypt);
const dummySalt = "adcraft-unknown-user";
export const dummyPasswordHash = `scrypt$${dummySalt}$${crypto.scryptSync("invalid-login-password", dummySalt, 64).toString("base64url")}`;

interface SessionPayload {
  userId: string;
  expiresAt: number;
}

function signature(value: string): string {
  return crypto.createHmac("sha256", config.auth.secret).update(value).digest("base64url");
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10) throw new HttpError(400, "密码至少需要 10 个字符");
  const salt = crypto.randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, expected] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const derived = await scrypt(password, salt, 64) as Buffer;
  const expectedBuffer = Buffer.from(expected, "base64url");
  return derived.length === expectedBuffer.length && crypto.timingSafeEqual(derived, expectedBuffer);
}

export function createSessionToken(userId: string): string {
  const payload: SessionPayload = {
    userId,
    expiresAt: Date.now() + config.auth.sessionHours * 60 * 60 * 1000
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signature(body)}`;
}

export function readSessionToken(token: string): SessionPayload | undefined {
  const [body, suppliedSignature] = token.split(".");
  if (!body || !suppliedSignature) return undefined;
  const expected = Buffer.from(signature(body));
  const supplied = Buffer.from(suppliedSignature);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.userId || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

export async function bootstrapAdmin(): Promise<void> {
  const users = await store.listUsers();
  if (users.some((user) => user.role === "admin")) return;
  if (!config.auth.bootstrapEmail || !config.auth.bootstrapPassword) {
    console.warn("No administrator exists. Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD, then restart once.");
    return;
  }
  const now = nowIso();
  const user: UserRecord = {
    id: `user_${nanoid(12)}`,
    nickname: config.auth.bootstrapNickname || "系统管理员",
    email: config.auth.bootstrapEmail,
    passwordHash: await hashPassword(config.auth.bootstrapPassword),
    role: "admin",
    status: "active",
    creditBalance: 100,
    generationCount: 0,
    createdAt: now,
    updatedAt: now
  };
  const transaction: CreditTransactionRecord = {
    id: `credit_${nanoid(12)}`,
    userId: user.id,
    type: "initial",
    amount: 100,
    balanceAfter: 100,
    reason: "管理员初始额度",
    createdAt: now
  };
  await store.createUser(user, transaction);
  console.log(`Bootstrapped administrator account: ${user.email}`);
}

export function publicUser(user: UserRecord): Omit<UserRecord, "passwordHash"> {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

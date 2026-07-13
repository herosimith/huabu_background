import express from "express";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { nowIso } from "../lib/time.js";
import { requireAuth } from "../middleware/auth.js";
import { createSessionToken, dummyPasswordHash, publicUser, verifyPassword } from "../services/authService.js";
import { store } from "../store/jsonStore.js";

export const authRouter = express.Router();

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function registerFailedLogin(key: string) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  const next = !current || current.resetAt <= now ? { count: 1, resetAt: now + 15 * 60_000 } : { ...current, count: current.count + 1 };
  loginAttempts.set(key, next);
}

function assertLoginAllowed(key: string) {
  const attempt = loginAttempts.get(key);
  if (!attempt) return;
  if (attempt.resetAt <= Date.now()) {
    loginAttempts.delete(key);
    return;
  }
  if (attempt.count >= 8) throw new HttpError(429, "登录尝试过多，请 15 分钟后重试");
}

authRouter.post("/login", async (req, res) => {
  const attemptKey = req.ip || req.socket.remoteAddress || "unknown";
  assertLoginAllowed(attemptKey);
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = await store.getUserByEmail(email);
  const passwordMatches = await verifyPassword(password, user?.passwordHash || dummyPasswordHash);
  if (!user || !passwordMatches) {
    registerFailedLogin(attemptKey);
    throw new HttpError(401, "邮箱或密码错误");
  }
  if (user.status !== "active") throw new HttpError(403, "账号已停用，请联系管理员");
  const now = nowIso();
  await store.updateUser(user.id, (record) => {
    record.lastActiveAt = now;
    record.updatedAt = now;
  });
  loginAttempts.delete(attemptKey);
  res.cookie(config.auth.cookieName, createSessionToken(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    path: "/",
    maxAge: config.auth.sessionHours * 60 * 60 * 1000
  });
  res.json({ user: publicUser({ ...user, lastActiveAt: now, updatedAt: now }) });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(config.auth.cookieName, { httpOnly: true, sameSite: "lax", path: "/" });
  res.status(204).end();
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.authUser!) });
});

import type express from "express";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { store } from "../store/jsonStore.js";
import type { UserRecord } from "../types.js";
import { readSessionToken } from "../services/authService.js";

declare global {
  namespace Express {
    interface Request {
      authUser?: UserRecord;
    }
  }
}

function cookieValue(req: express.Request, name: string): string | undefined {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export async function requireAuth(req: express.Request, _res: express.Response, next: express.NextFunction) {
  try {
    const token = cookieValue(req, config.auth.cookieName);
    const session = token ? readSessionToken(token) : undefined;
    if (!session) throw new HttpError(401, "请先登录");
    const user = await store.getUser(session.userId);
    if (!user || user.status !== "active") throw new HttpError(401, "账号不可用，请联系管理员");
    req.authUser = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAdmin(req: express.Request, _res: express.Response, next: express.NextFunction) {
  if (req.authUser?.role !== "admin") return next(new HttpError(403, "需要管理员权限"));
  next();
}

export function requireCanvasEditor(req: express.Request, _res: express.Response, next: express.NextFunction) {
  if (req.authUser?.role === "reviewer") return next(new HttpError(403, "审稿员仅可查看，不能创建或修改画布内容"));
  next();
}

export function canAccessOwner(req: express.Request, ownerId?: string): boolean {
  return Boolean(req.authUser && (req.authUser.role === "admin" || ownerId === req.authUser.id));
}

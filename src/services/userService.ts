import { nanoid } from "nanoid";
import { HttpError } from "../lib/errors.js";
import { nowIso } from "../lib/time.js";
import { store } from "../store/jsonStore.js";
import type { DatabaseShape, UserRecord, UserRole, UserStatus } from "../types.js";
import { hashPassword, publicUser } from "./authService.js";

const roles = new Set<UserRole>(["admin", "designer", "reviewer"]);
const statuses = new Set<UserStatus>(["active", "disabled"]);

function normalizeEmail(value: unknown): string {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "请输入有效邮箱");
  return email;
}

function normalizePhone(value: unknown): string | undefined {
  const phone = String(value || "").trim();
  if (!phone) return undefined;
  if (!/^[+\d][\d -]{5,24}$/.test(phone)) throw new HttpError(400, "请输入有效手机号");
  return phone.replace(/[ -]/g, "");
}

function parseRole(value: unknown): UserRole {
  const role = String(value || "designer") as UserRole;
  if (!roles.has(role)) throw new HttpError(400, "非法角色");
  return role;
}

function parseStatus(value: unknown): UserStatus {
  const status = String(value || "active") as UserStatus;
  if (!statuses.has(status)) throw new HttpError(400, "非法账号状态");
  return status;
}

function publicRows(users: UserRecord[]) {
  return users.map(publicUser);
}

export async function listManagedUsers(params: Record<string, unknown>) {
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(50, Math.max(5, Number(params.pageSize) || 10));
  const search = String(params.search || "").trim().toLocaleLowerCase();
  const status = params.status ? parseStatus(params.status) : undefined;
  const role = params.role ? parseRole(params.role) : undefined;
  const all = await store.listUsers();
  const filtered = all.filter((user) => {
    if (status && user.status !== status) return false;
    if (role && user.role !== role) return false;
    if (!search) return true;
    return [user.nickname, user.email, user.phone || "", user.id].some((value) => value.toLocaleLowerCase().includes(search));
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const start = (page - 1) * pageSize;
  return {
    users: publicRows(filtered.slice(start, start + pageSize)),
    pagination: { page, pageSize, total: filtered.length, pages: Math.max(1, Math.ceil(filtered.length / pageSize)) },
    stats: {
      total: all.length,
      active: all.filter((user) => user.status === "active").length,
      disabled: all.filter((user) => user.status === "disabled").length,
      totalCredits: all.reduce((sum, user) => sum + user.creditBalance, 0)
    }
  };
}

export async function createManagedUser(input: Record<string, unknown>, operatorId: string) {
  const nickname = String(input.nickname || "").trim();
  if (nickname.length < 2 || nickname.length > 40) throw new HttpError(400, "昵称需为 2-40 个字符");
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const creditBalance = Math.max(0, Math.floor(Number(input.creditBalance) || 0));
  const now = nowIso();
  const user: UserRecord = {
    id: `user_${nanoid(12)}`,
    nickname,
    email,
    phone,
    passwordHash: await hashPassword(String(input.password || "")),
    role: parseRole(input.role),
    status: parseStatus(input.status),
    creditBalance,
    generationCount: 0,
    createdAt: now,
    updatedAt: now
  };
  try {
    await store.createUser(user, creditBalance > 0 ? {
      id: `credit_${nanoid(12)}`,
      userId: user.id,
      type: "initial",
      amount: creditBalance,
      balanceAfter: creditBalance,
      reason: "管理员创建账号初始额度",
      operatorId,
      createdAt: now
    } : undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Email")) throw new HttpError(409, "邮箱已存在");
    if (message.includes("Phone")) throw new HttpError(409, "手机号已存在");
    throw error;
  }
  return publicUser(user);
}

function assertAdminContinuity(db: DatabaseShape, target: UserRecord, nextRole: UserRole, nextStatus: UserStatus) {
  if (target.role !== "admin" || (nextRole === "admin" && nextStatus === "active")) return;
  const otherActiveAdmins = db.users.filter((user) => user.id !== target.id && user.role === "admin" && user.status === "active");
  if (otherActiveAdmins.length === 0) throw new HttpError(409, "必须至少保留一个启用的管理员");
}

export async function updateManagedUser(id: string, input: Record<string, unknown>, operatorId: string) {
  const passwordHash = input.password ? await hashPassword(String(input.password)) : undefined;
  try {
    const updated = await store.updateUser(id, (user, db) => {
      const nextRole = input.role === undefined ? user.role : parseRole(input.role);
      const nextStatus = input.status === undefined ? user.status : parseStatus(input.status);
      if (user.id === operatorId && (nextRole !== "admin" || nextStatus !== "active")) {
        throw new HttpError(409, "不能停用或降级当前登录管理员");
      }
      assertAdminContinuity(db, user, nextRole, nextStatus);
      if (input.email !== undefined) {
        const email = normalizeEmail(input.email);
        if (db.users.some((item) => item.id !== id && item.email === email)) throw new HttpError(409, "邮箱已存在");
        user.email = email;
      }
      if (input.phone !== undefined) {
        const phone = normalizePhone(input.phone);
        if (phone && db.users.some((item) => item.id !== id && item.phone === phone)) throw new HttpError(409, "手机号已存在");
        user.phone = phone;
      }
      if (input.nickname !== undefined) {
        const nickname = String(input.nickname || "").trim();
        if (nickname.length < 2 || nickname.length > 40) throw new HttpError(400, "昵称需为 2-40 个字符");
        user.nickname = nickname;
      }
      user.role = nextRole;
      user.status = nextStatus;
      if (passwordHash) user.passwordHash = passwordHash;
      user.updatedAt = nowIso();
    });
    return publicUser(updated);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && error.message === "User not found") throw new HttpError(404, "用户不存在");
    throw error;
  }
}

export async function getManagedUserDetail(id: string) {
  const user = await store.getUser(id);
  if (!user) throw new HttpError(404, "用户不存在");
  return { user: publicUser(user), transactions: (await store.listCreditTransactions(id)).slice(0, 30) };
}

export async function adjustManagedCredits(id: string, input: Record<string, unknown>, operatorId: string) {
  const amount = Math.trunc(Number(input.amount));
  const reason = String(input.reason || "").trim();
  if (!Number.isFinite(amount) || amount === 0) throw new HttpError(400, "积分调整必须为非零整数");
  if (Math.abs(amount) > 1_000_000) throw new HttpError(400, "单次积分调整过大");
  if (reason.length < 2 || reason.length > 120) throw new HttpError(400, "请填写 2-120 个字符的调整原因");
  try {
    const result = await store.adjustUserCredits({ userId: id, amount, reason, operatorId });
    return { user: publicUser(result.user), transaction: result.transaction };
  } catch (error) {
    if (error instanceof Error && error.message === "User not found") throw new HttpError(404, "用户不存在");
    if (error instanceof Error && error.message === "Insufficient credits") throw new HttpError(409, "积分余额不能小于 0");
    throw error;
  }
}

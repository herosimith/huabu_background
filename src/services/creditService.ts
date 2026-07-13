import { nanoid } from "nanoid";
import { config } from "../config.js";
import { HttpError } from "../lib/errors.js";
import { nowIso } from "../lib/time.js";
import { store } from "../store/jsonStore.js";
import type { CreditRuleRecord, CreditTransactionRecord, CreditTransactionType, TopupIntentRecord } from "../types.js";

const transactionTypes = new Set<CreditTransactionType>(["initial", "admin_adjust", "generation", "refund"]);

function intField(value: unknown, label: string, minimum = 0, maximum = 100_000): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new HttpError(400, `${label}必须是 ${minimum}-${maximum} 的整数`);
  }
  return number;
}

function defaultRule(): CreditRuleRecord {
  return {
    id: "credit_rule_v1",
    version: 1,
    active: true,
    signupGrant: 20,
    costs: {
      standardGeneration: config.auth.generatedJobCost,
      highQualitySurcharge: 1,
      highResolutionSurcharge: 2
    },
    createdBy: "system",
    createdAt: nowIso()
  };
}

export async function ensureDefaultCreditRule(): Promise<CreditRuleRecord> {
  return store.ensureCreditRule(defaultRule());
}

export async function getActiveCreditRule(): Promise<CreditRuleRecord> {
  const rules = await store.listCreditRules();
  return rules.find((rule) => rule.active) || ensureDefaultCreditRule();
}

export function calculateCreditCost(rule: CreditRuleRecord, input: { size: string; quality: string; mock?: boolean }): number {
  if (input.mock) return 0;
  const match = input.size.match(/^(\d+)x(\d+)$/);
  const pixels = match ? Number(match[1]) * Number(match[2]) : 0;
  return rule.costs.standardGeneration
    + (input.quality === "high" ? rule.costs.highQualitySurcharge : 0)
    + (pixels > 2560 * 1440 ? rule.costs.highResolutionSurcharge : 0);
}

export async function getCreditRuleSettings() {
  const activeRule = await getActiveCreditRule();
  const versions = (await store.listCreditRules()).sort((a, b) => b.version - a.version);
  return { activeRule, versions: versions.slice(0, 20) };
}

export async function publishCreditRule(input: Record<string, unknown>, operatorId: string) {
  const next: CreditRuleRecord = {
    id: `credit_rule_${nanoid(10)}`,
    version: 0,
    active: true,
    signupGrant: intField(input.signupGrant, "注册赠送积分"),
    costs: {
      standardGeneration: intField(input.standardGeneration, "标准生图积分", 1, 10_000),
      highQualitySurcharge: intField(input.highQualitySurcharge, "高质量附加积分", 0, 10_000),
      highResolutionSurcharge: intField(input.highResolutionSurcharge, "高分辨率附加积分", 0, 10_000)
    },
    createdBy: operatorId,
    createdAt: nowIso()
  };
  return store.publishCreditRule(next);
}

function dateBoundary(value: unknown, endOfDay = false): number | undefined {
  if (!value) return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "日期格式无效");
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function paginate<T>(items: T[], pageValue: unknown, pageSizeValue: unknown) {
  const page = Math.max(1, Number(pageValue) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(pageSizeValue) || 20));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pagination: { page, pageSize, total: items.length, pages: Math.max(1, Math.ceil(items.length / pageSize)) }
  };
}

export async function listAdminCreditTransactions(params: Record<string, unknown>) {
  const users = await store.listUsers();
  const userMap = new Map(users.map((user) => [user.id, user]));
  const type = params.type ? String(params.type) as CreditTransactionType : undefined;
  if (type && !transactionTypes.has(type)) throw new HttpError(400, "非法流水类型");
  const from = dateBoundary(params.dateFrom);
  const to = dateBoundary(params.dateTo, true);
  const search = String(params.search || "").trim().toLocaleLowerCase();
  const filtered = (await store.listAllCreditTransactions()).filter((transaction) => {
    const user = userMap.get(transaction.userId);
    const createdAt = new Date(transaction.createdAt).getTime();
    if (params.userId && transaction.userId !== String(params.userId)) return false;
    if (type && transaction.type !== type) return false;
    if (from && createdAt < from) return false;
    if (to && createdAt > to) return false;
    if (search && ![transaction.id, transaction.reason, user?.nickname || "", user?.email || ""].some((value) => value.toLocaleLowerCase().includes(search))) return false;
    return true;
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const summary = filtered.reduce((result, transaction) => {
    if (transaction.amount > 0) result.creditsIn += transaction.amount;
    if (transaction.amount < 0) result.creditsOut += Math.abs(transaction.amount);
    result.net += transaction.amount;
    return result;
  }, { creditsIn: 0, creditsOut: 0, net: 0, count: filtered.length });
  const page = paginate(filtered, params.page, params.pageSize);
  return {
    transactions: page.items.map((transaction) => ({
      ...transaction,
      user: userMap.has(transaction.userId) ? {
        id: transaction.userId,
        nickname: userMap.get(transaction.userId)!.nickname,
        email: userMap.get(transaction.userId)!.email
      } : undefined
    })),
    pagination: page.pagination,
    summary
  };
}

export async function getUserCredits(userId: string, params: Record<string, unknown> = {}) {
  const user = await store.getUser(userId);
  if (!user) throw new HttpError(404, "用户不存在");
  const transactions = (await store.listCreditTransactions(userId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const page = paginate(transactions, params.page, params.pageSize);
  const activeRule = await getActiveCreditRule();
  const intents = (await store.listTopupIntents()).filter((intent) => intent.userId === userId).slice(0, 10);
  return {
    balance: user.creditBalance,
    generationCount: user.generationCount,
    activeRule: {
      version: activeRule.version,
      costs: activeRule.costs
    },
    transactions: page.items,
    pagination: page.pagination,
    topupIntents: intents
  };
}

export async function createTopupIntent(userId: string, input: Record<string, unknown>): Promise<TopupIntentRecord> {
  const requestedCredits = intField(input.requestedCredits, "充值积分", 10, 100_000);
  const note = String(input.note || "").trim();
  if (note.length > 120) throw new HttpError(400, "备注不能超过 120 个字符");
  const now = nowIso();
  const intent: TopupIntentRecord = {
    id: `topup_${nanoid(12)}`,
    userId,
    requestedCredits,
    status: "pending",
    note: note || undefined,
    createdAt: now,
    updatedAt: now
  };
  return store.createTopupIntent(intent);
}

export async function listAdminTopupIntents(params: Record<string, unknown>) {
  const users = await store.listUsers();
  const userMap = new Map(users.map((user) => [user.id, user]));
  const search = String(params.search || "").trim().toLocaleLowerCase();
  const status = params.status ? String(params.status) : undefined;
  if (status && status !== "pending" && status !== "closed") throw new HttpError(400, "非法充值意向状态");
  const filtered = (await store.listTopupIntents()).filter((intent) => {
    const user = userMap.get(intent.userId);
    if (status && intent.status !== status) return false;
    if (search && ![intent.id, user?.nickname || "", user?.email || "", intent.note || ""].some((value) => value.toLocaleLowerCase().includes(search))) return false;
    return true;
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const page = paginate(filtered, params.page, params.pageSize);
  return {
    intents: page.items.map((intent) => ({
      ...intent,
      user: userMap.has(intent.userId) ? { id: intent.userId, nickname: userMap.get(intent.userId)!.nickname, email: userMap.get(intent.userId)!.email } : undefined
    })),
    pagination: page.pagination,
    summary: {
      total: filtered.length,
      pending: filtered.filter((intent) => intent.status === "pending").length,
      requestedCredits: filtered.reduce((sum, intent) => sum + intent.requestedCredits, 0)
    }
  };
}

export async function getAdminOverview() {
  const snapshot = await store.readSnapshot();
  const today = new Date().toISOString().slice(0, 10);
  const todayTransactions = snapshot.creditTransactions.filter((item) => item.createdAt.startsWith(today));
  return {
    totalUsers: snapshot.users.length,
    activeUsers: snapshot.users.filter((user) => user.status === "active").length,
    todayGenerations: snapshot.jobs.filter((job) => job.createdAt.startsWith(today)).length,
    todayNetCredits: todayTransactions.reduce((sum, item) => sum + item.amount, 0),
    pendingTopups: snapshot.topupIntents.filter((intent) => intent.status === "pending").length,
    totalCreditBalance: snapshot.users.reduce((sum, user) => sum + user.creditBalance, 0),
    recentTransactions: snapshot.creditTransactions.slice(0, 8)
  };
}

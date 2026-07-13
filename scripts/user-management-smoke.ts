const baseUrl = process.env.ADCRAFT_BASE_URL || "http://127.0.0.1:4199";
const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL || "admin@adcraft.test";
const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD || "AdminPassword123";
let cookie = "";

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";", 1)[0];
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  return { response, body };
}

async function expectStatus(path: string, status: number, init: RequestInit = {}) {
  const result = await request(path, init);
  if (result.response.status !== status) {
    throw new Error(`${path}: expected ${status}, received ${result.response.status} ${JSON.stringify(result.body)}`);
  }
  return result.body as any;
}

cookie = "";
await expectStatus("/api/admin/users", 401);

const login = await expectStatus("/api/auth/login", 200, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: adminEmail, password: adminPassword })
});
if (login.user.role !== "admin" || !cookie) throw new Error("Admin login did not create an authenticated session");
const adminCookie = cookie;

const rulesBefore = await expectStatus("/api/admin/credit-rules", 200);
const publishedRule = await expectStatus("/api/admin/credit-rules", 200, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ signupGrant: 20, standardGeneration: 2, highQualitySurcharge: 1, highResolutionSurcharge: 3 })
});
if (publishedRule.activeRule.version <= rulesBefore.activeRule.version || publishedRule.activeRule.costs.highResolutionSurcharge !== 3) {
  throw new Error("Credit rule publishing did not create a new active version");
}
const rulesAfter = await expectStatus("/api/admin/credit-rules", 200);
if (rulesAfter.versions.filter((rule: any) => rule.active).length !== 1) {
  throw new Error("Credit rule publishing did not preserve exactly one active version");
}

const unique = Date.now();
const memberEmail = `designer-${unique}@adcraft.test`;
const created = await expectStatus("/api/admin/users", 201, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    nickname: "海报设计师",
    email: memberEmail,
    phone: `138${String(unique).slice(-8)}`,
    password: "DesignerPassword123",
    role: "designer",
    status: "active",
    creditBalance: 25
  })
});
const memberId = created.user.id;
const reviewerEmail = `reviewer-${unique}@adcraft.test`;
await expectStatus("/api/admin/users", 201, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ nickname: "交付审稿员", email: reviewerEmail, password: "ReviewerPassword123", role: "reviewer", status: "active", creditBalance: 5 })
});

await expectStatus("/api/admin/users", 409, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ nickname: "重复用户", email: memberEmail, password: "DesignerPassword123", role: "designer" })
});

const list = await expectStatus(`/api/admin/users?search=${encodeURIComponent(memberEmail)}&status=active&role=designer`, 200);
if (list.users.length !== 1 || list.users[0].id !== memberId || list.stats.total < 2) throw new Error("Search/filter/stats response is incorrect");

const adjusted = await expectStatus(`/api/admin/users/${memberId}/credits`, 200, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ amount: -5, reason: "联调扣减" })
});
if (adjusted.user.creditBalance !== 20 || adjusted.transaction.balanceAfter !== 20) throw new Error("Credit adjustment was not atomic");

await expectStatus(`/api/admin/users/${memberId}/credits`, 409, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ amount: -21, reason: "禁止负余额" })
});

const detail = await expectStatus(`/api/admin/users/${memberId}`, 200);
if (detail.transactions.length < 2 || detail.transactions[0].reason !== "联调扣减") throw new Error("Credit ledger is missing entries");

await expectStatus(`/api/admin/users/${login.user.id}`, 409, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ status: "disabled" })
});

const prompt = await expectStatus("/api/prompt", 200, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ customerText: "设计一个测试门头，店名“登录验证”", businessType: "门头招牌" })
});
if (prompt.prompt.userId !== login.user.id) throw new Error("Prompt ownership was not assigned by the server session");

const job = await expectStatus("/api/jobs", 202, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "original", promptId: prompt.prompt.id, size: "1024x1024", quality: "low", mock: true, userId: memberId })
});
if (job.job.userId !== login.user.id) throw new Error("Job trusted a client-supplied userId");

cookie = "";
await expectStatus("/api/auth/login", 200, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: memberEmail, password: "DesignerPassword123" })
});
await expectStatus("/api/admin/users", 403);
await expectStatus("/api/admin/credit-rules", 403);
await expectStatus(`/api/jobs/${job.job.id}`, 403);
await expectStatus(`/api/prompts/${prompt.prompt.id}`, 403);
const memberCreditsBefore = await expectStatus("/api/credits/summary", 200);
if (memberCreditsBefore.balance !== 20 || memberCreditsBefore.transactions.some((item: any) => item.userId !== memberId)) {
  throw new Error("Personal credit summary leaked another user or returned a stale balance");
}
const topup = await expectStatus("/api/credits/topup-intents", 202, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ requestedCredits: 300, note: "联调充值意向" })
});
const memberCreditsAfter = await expectStatus("/api/credits/summary", 200);
if (topup.intent.status !== "pending" || memberCreditsAfter.balance !== memberCreditsBefore.balance || memberCreditsAfter.transactions.length !== memberCreditsBefore.transactions.length) {
  throw new Error("Topup intent changed balance or wrote a credit transaction");
}

cookie = "";
await expectStatus("/api/auth/login", 200, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: reviewerEmail, password: "ReviewerPassword123" })
});
await expectStatus("/api/prompt", 403, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ customerText: "审稿员不得创建内容" })
});

cookie = adminCookie;
const globalLedger = await expectStatus(`/api/admin/credit-transactions?userId=${memberId}`, 200);
if (!globalLedger.transactions.length || globalLedger.transactions.some((item: any) => item.userId !== memberId) || globalLedger.summary.net !== 20) {
  throw new Error("Admin global ledger filter or summary is incorrect");
}
const topups = await expectStatus(`/api/admin/topup-intents?search=${encodeURIComponent(memberEmail)}`, 200);
if (!topups.intents.some((item: any) => item.id === topup.intent.id) || topups.summary.requestedCredits < 300) {
  throw new Error("Admin topup intent view did not expose the pending intent");
}
const overview = await expectStatus("/api/admin/overview", 200);
if (overview.pendingTopups < 1 || overview.totalUsers < 3) throw new Error("Admin overview did not include credits and topups");
await expectStatus(`/api/admin/users/${memberId}`, 200, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ status: "disabled" })
});

cookie = "";
await expectStatus("/api/auth/login", 403, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: memberEmail, password: "DesignerPassword123" })
});

console.log(JSON.stringify({ ok: true, adminId: login.user.id, memberId, checked: ["auth", "admin-guard", "role-guard", "reviewer-read-only", "create", "duplicate", "search", "filters", "stats", "credit-rules", "personal-ledger", "global-ledger", "topup-no-balance-mutation", "admin-overview", "credits", "self-protection", "ownership", "cross-user-denial", "disable"] }, null, 2));

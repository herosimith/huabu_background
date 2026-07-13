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
await expectStatus(`/api/jobs/${job.job.id}`, 403);
await expectStatus(`/api/prompts/${prompt.prompt.id}`, 403);

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

console.log(JSON.stringify({ ok: true, adminId: login.user.id, memberId, checked: ["auth", "admin-guard", "role-guard", "reviewer-read-only", "create", "duplicate", "search", "filters", "stats", "credits", "ledger", "self-protection", "ownership", "cross-user-denial", "disable"] }, null, 2));

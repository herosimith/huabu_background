const baseUrl = process.env.ADCRAFT_BASE_URL || "http://127.0.0.1:5173";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body as T;
}

async function pollJob(id: string): Promise<any> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { job } = await json<{ job: any }>(`/api/jobs/${id}`);
    if (job.status === "succeeded" || job.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Job ${id} timed out`);
}

const health = await json<{ ok: boolean; mode: string }>("/api/health");
if (!health.ok) throw new Error("Health check failed");

const { prompt } = await json<{ prompt: { id: string; imagePrompt: string; matchedPromptIds?: string[]; source?: string } }>("/api/prompt", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    customerText: "给一家咖啡店设计门头，店名“春山 COFFEE”，白色墙面，黑色发光字。",
    businessType: "门头招牌",
    material: "白色墙面、黑色发光字、灯箱",
    style: "高级、干净、真实商业街"
  })
});
if (!prompt.imagePrompt.includes("春山 COFFEE") || prompt.imagePrompt.includes("不晚 STUDIO")) {
  throw new Error("Prompt did not preserve the requested store name cleanly");
}
if (!prompt.matchedPromptIds?.length) {
  throw new Error("Prompt library did not return matched prompt references");
}

const { prompt: clothingPrompt } = await json<{ prompt: { matchedPromptIds?: string[]; imagePrompt: string } }>("/api/prompt", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    customerText: "给一家服装工作室设计门头，店名“不晚 STUDIO”，白色墙面，黑色发光字，风格高级、干净，适合夜间亮灯展示。",
    businessType: "门头招牌",
    material: "白色墙面、黑色发光字、灯箱",
    style: "高级、干净、真实商业街、夜间亮灯"
  })
});
if (!clothingPrompt.matchedPromptIds?.includes("019") || !clothingPrompt.imagePrompt.includes("不晚 STUDIO")) {
  throw new Error("Clothing storefront prompt did not match library item 019 cleanly");
}

const uploadPng = new Blob([
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64")
], { type: "image/png" });
const form = new FormData();
form.append("file", uploadPng, "site.png");
const { asset: uploadAsset } = await json<{ asset: { id: string } }>("/api/uploads", {
  method: "POST",
  body: form
});

const { job: originalQueued } = await json<{ job: { id: string } }>("/api/jobs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "original", promptId: prompt.id, mock: true })
});
const original = await pollJob(originalQueued.id);
if (original.status !== "succeeded" || !original.requestJson?.mock || !original.assets?.[0]?.url) {
  throw new Error("Original mock job did not succeed");
}
if (!original.prompt.includes("春山 COFFEE") || original.prompt.includes("不晚 STUDIO")) {
  throw new Error("Original job prompt was polluted by a stale store name");
}

const { job: composedQueued } = await json<{ job: { id: string } }>("/api/jobs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "composed", promptId: prompt.id, inputAssetIds: [uploadAsset.id], mock: true })
});
const composed = await pollJob(composedQueued.id);
if (composed.status !== "succeeded" || !composed.requestJson?.mock || !composed.assets?.[0]?.url) {
  throw new Error("Composed mock job did not succeed");
}
if (!composed.prompt.includes("春山 COFFEE") || composed.prompt.includes("不晚 STUDIO")) {
  throw new Error("Composed job prompt was polluted by a stale store name");
}

const { asset: vector } = await json<{ asset: { url: string; type: string } }>("/api/vector-assets", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    promptId: prompt.id,
    jobId: original.id,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120"><text x="20" y="70">春山 COFFEE</text></svg>'
  })
});
if (vector.type !== "vector" || !vector.url) throw new Error("Vector asset not created");

console.log(JSON.stringify({
  ok: true,
  mode: health.mode,
  promptId: prompt.id,
  uploadAssetId: uploadAsset.id,
  originalJobId: original.id,
  composedJobId: composed.id,
  vectorUrl: vector.url
}, null, 2));

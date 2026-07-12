const baseUrl = process.env.ADCRAFT_BASE_URL || "http://127.0.0.1:5173";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body as T;
}

async function expectStatus(path: string, expectedStatus: number, init?: RequestInit): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`${path} expected ${expectedStatus}, received ${response.status}: ${body}`);
  }
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
if (health.mode === "mock") {
  await expectStatus("/api/jobs", 503, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "original",
      prompt: "Live generation must not silently fall back to an SVG mock.",
      size: "1024x1024",
      quality: "high",
      mock: false
    })
  });
}

const { prompt } = await json<{ prompt: { id: string; imagePrompt: string; requiredVisibleTexts?: string[]; matchedPromptIds?: string[]; source?: string } }>("/api/prompt", {
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
if (!prompt.imagePrompt.includes("必须原样显示以下文字") || !prompt.imagePrompt.includes("不得改写、翻译、增删或重复")) {
  throw new Error("Prompt did not include the exact visible-text contract");
}
if (!prompt.matchedPromptIds?.length) {
  throw new Error("Prompt library did not return matched prompt references");
}
if (!prompt.requiredVisibleTexts?.includes("春山 COFFEE")) {
  throw new Error("Prompt did not persist the required visible-text contract");
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

const enterpriseTimelineRequirement = [
  "企业历程",
  "来时之路",
  "从1934到2026，九十余载薪火相传，每一步都有迹可循。",
  "年份 里程碑事件",
  "1934 国立西北农林专科学校创建，以“兴农兴学、开发西北”为使命，开设栽桑、养蚕、制丝专业，播下蚕桑科研种子",
  "1938 学校正式建立蚕桑研究室，开启系统性蚕桑研究，成为国内桑蚕科研核心力量",
  "1958 陕西省蚕桑研究所成立，深耕桑蚕育种与技术研发，积淀深厚底蕴",
  "1984 蚕桑研究所创办康乐果汁饮料厂，“圣桑”品牌正式诞生，实现桑蚕从“丝用”到“食用”的跨界创新",
  "1995 更名为陕西省蚕桑丝绸研究所，进一步拓展桑蚕综合利用研究",
  "1999 依托西北农林科技大学科研优势，杨凌圣桑绿色食品有限公司改制成立，产业化全面启航",
  "2015 投产全国最大野刺梨果汁罐装生产线，产能与品类迈上新台阶",
  "2019 经国家林业和草原局批复，获批组建国家桑树产业工程技术研究中心，成为全国桑树产业唯一国家级研发平台",
  "2023 荣登西安·中亚峰会国宴，成为峰会指定饮品，代表中国桑蚕健康饮品亮相世界舞台",
  "2026 启航新征程，扬帆再出发，剑指百亿产业集群，奇迹仍在持续创造"
].join("\n");
const { prompt: timelinePrompt } = await json<{ prompt: { imagePrompt: string; requiredVisibleTexts?: string[] } }>("/api/prompt", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    customerText: enterpriseTimelineRequirement,
    businessType: "墙体文化",
    material: "PVC异形、暖白灯带、浮雕纹理",
    style: "简约大气、上档次、突出时间节点"
  })
});
for (const requiredFragment of [
  "企业历程墙内容规则（最高优先级）",
  "企业历程",
  "来时之路",
  "1934：国立西北农林专科学校创建",
  "1938：学校正式建立蚕桑研究室",
  "1958：陕西省蚕桑研究所成立",
  "1984：蚕桑研究所创办康乐果汁饮料厂",
  "1995：更名为陕西省蚕桑丝绸研究所",
  "1999：依托西北农林科技大学科研优势",
  "2015：投产全国最大野刺梨果汁罐装生产线",
  "2019：经国家林业和草原局批复",
  "2023：荣登西安·中亚峰会国宴",
  "2026：启航新征程"
]) {
  if (!timelinePrompt.imagePrompt.includes(requiredFragment)) {
    throw new Error(`Enterprise timeline prompt omitted required content: ${requiredFragment}`);
  }
}
if (timelinePrompt.imagePrompt.includes("画面最多四个信息模块") || !timelinePrompt.imagePrompt.includes("每条里程碑都是必需内容")) {
  throw new Error("Enterprise timeline prompt kept the generic content-limit contract");
}
if (timelinePrompt.requiredVisibleTexts?.includes("兴农兴学、开发西北")) {
  throw new Error("Embedded timeline copy must not be treated as a standalone OCR truth");
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
  body: JSON.stringify({ type: "original", promptId: prompt.id, size: "3840x2160", quality: "high", mock: true })
});
const original = await pollJob(originalQueued.id);
if (original.status !== "succeeded" || !original.requestJson?.mock || !original.assets?.[0]?.url) {
  throw new Error("Original mock job did not succeed");
}
if (!original.prompt.includes("春山 COFFEE") || original.prompt.includes("不晚 STUDIO")) {
  throw new Error("Original job prompt was polluted by a stale store name");
}
if (original.size !== "3840x2160" || original.quality !== "high") {
  throw new Error("Original job did not preserve the requested 4K output settings");
}

const { job: textValidation } = await json<{ job: any }>(`/api/jobs/${original.id}/text-validation`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}"
});
if (!textValidation.textValidation || textValidation.textValidation.status === "passed") {
  throw new Error("Unavailable OCR must not mark a mock SVG image as text-verified");
}

const { asset: corrected, job: correctedJob } = await json<{ asset: { type: string; url: string }; job: any }>(`/api/jobs/${original.id}/text-corrections`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    corrections: [{
      expectedText: "春山 COFFEE",
      x: 80,
      y: 80,
      width: 460,
      height: 120,
      fontSize: 72,
      textColor: "#111827",
      coverColor: "#ffffff"
    }]
  })
});
if (corrected.type !== "corrected" || !corrected.url || !correctedJob.correctedAssets?.length || !correctedJob.assets?.[0]?.url) {
  throw new Error("Text correction did not create a separate corrected asset while preserving the original");
}
const correctedImage = await fetch(`${baseUrl}${corrected.url}`);
if (!correctedImage.ok || !correctedImage.headers.get("content-type")?.includes("image/png")) {
  throw new Error("Corrected asset is not a readable PNG");
}

const { job: composedQueued } = await json<{ job: { id: string } }>("/api/jobs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "composed", promptId: prompt.id, size: "2560x3200", quality: "high", inputAssetIds: [uploadAsset.id], mock: true })
});
const composed = await pollJob(composedQueued.id);
if (composed.status !== "succeeded" || !composed.requestJson?.mock || !composed.assets?.[0]?.url) {
  throw new Error("Composed mock job did not succeed");
}
if (!composed.prompt.includes("春山 COFFEE") || composed.prompt.includes("不晚 STUDIO")) {
  throw new Error("Composed job prompt was polluted by a stale store name");
}
if (composed.size !== "2560x3200") {
  throw new Error("Composed job did not preserve the requested 4:5 output size");
}

const { job: portraitQueued } = await json<{ job: { id: string } }>("/api/jobs", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "original", promptId: prompt.id, size: "2160x3840", quality: "high", mock: true })
});
const portrait = await pollJob(portraitQueued.id);
if (portrait.status !== "succeeded" || portrait.size !== "2160x3840") {
  throw new Error("Portrait 4K mock job did not succeed");
}

await expectStatus("/api/jobs", 400, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "original", promptId: prompt.id, size: "2161x3840", quality: "high", mock: true })
});

await expectStatus("/api/jobs", 400, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "original", promptId: prompt.id, size: "3856x2144", quality: "high", mock: true })
});

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
  portraitJobId: portrait.id,
  vectorUrl: vector.url
}, null, 2));

import { Copy, Download, Expand, ImagePlus, Loader2, Palette, RotateCcw, Send, Sparkles, Upload, Wand2, X } from "lucide-react";
import { ChangeEvent, useMemo, useState } from "react";

type JobStatus = "queued" | "running" | "succeeded" | "failed";
type JobType = "original" | "composed";
type AssetType = "upload" | "original" | "composed" | "vector";

interface PromptRecord {
  id: string;
  customerText: string;
  businessType: string;
  material?: string;
  style?: string;
  brief: string;
  imagePrompt: string;
  negativePrompt: string;
  source: "template" | "openai-chat" | "anthropic";
  matchedPromptIds?: string[];
  matchedPrompts?: Array<{
    id: string;
    index: number;
    title: string;
    category: string;
    promptText: string;
    imageUrl?: string;
    score?: number;
  }>;
  createdAt: string;
}

interface AssetRecord {
  id: string;
  type: AssetType;
  filename: string;
  mimeType: string;
  url: string;
  size: number;
}

interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  error?: string;
  assets: AssetRecord[];
}

interface StepState {
  label: string;
  detail: string;
  state: "idle" | "queued" | "working" | "done" | "failed";
}

const businessTypes = [
  { id: "门头招牌", title: "门头招牌", desc: "发光字、底板、灯箱" },
  { id: "墙体文化", title: "墙体文化", desc: "文化墙、展板、美陈" },
  { id: "广告物料", title: "广告物料", desc: "海报、喷绘、易拉宝" },
  { id: "品牌 VI", title: "品牌 VI", desc: "Logo、辅助图形、物料" },
  { id: "施工输出", title: "施工输出", desc: "尺寸、材质、安装说明" }
];

const defaultNeed = "给一家服装工作室设计门头，店名“不晚 STUDIO”，白色墙面，黑色发光字，风格高级、干净，适合夜间亮灯展示。";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

async function pollJob(id: string, onUpdate: (job: JobRecord) => void): Promise<JobRecord> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error("任务轮询超时，请稍后重试");
    }
    const { job } = await requestJson<{ job: JobRecord }>(`/api/jobs/${id}`);
    onUpdate(job);
    if (job.status === "succeeded" || job.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 1600));
  }
}

function createVectorSvg(text: string) {
  const safeText = text.replace(/[<>&"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420"><rect width="1200" height="420" fill="#ffffff"/><text x="600" y="230" text-anchor="middle" font-family="Arial, sans-serif" font-size="96" font-weight="700" fill="#111827">${safeText}</text><text x="600" y="310" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" fill="#4b5563">illuminated sign vector draft</text></svg>`;
}

function extractStoreName(input: string) {
  const quoted = input.match(/[“"']([^”"']{2,40})[”"']/)?.[1]?.trim();
  if (quoted) return quoted;
  const named = input.match(/店名\s*[：:为叫]?\s*([\u4e00-\u9fa5A-Za-z0-9·.\-\s]{2,40})/)?.[1]?.trim();
  if (named) return named.replace(/[，。,；;].*$/, "").trim();
  return "店名待确认";
}

function activeImage(job?: JobRecord | null) {
  return job?.assets?.[0]?.url;
}

export function App() {
  const [customerText, setCustomerText] = useState(defaultNeed);
  const [businessType, setBusinessType] = useState("门头招牌");
  const [material, setMaterial] = useState("白色墙面、黑色发光字、灯箱");
  const [style, setStyle] = useState("高级、干净、真实商业街、夜间亮灯");
  const [prompt, setPrompt] = useState<PromptRecord | null>(null);
  const [uploadAsset, setUploadAsset] = useState<AssetRecord | null>(null);
  const [uploadPreview, setUploadPreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const [originalJob, setOriginalJob] = useState<JobRecord | null>(null);
  const [composedJob, setComposedJob] = useState<JobRecord | null>(null);
  const [vectorAsset, setVectorAsset] = useState<AssetRecord | null>(null);
  const [activeTab, setActiveTab] = useState<"composed" | "original" | "vector">("composed");
  const [runMode, setRunMode] = useState<"mock" | "live">("mock");
  const [polishedPromptText, setPolishedPromptText] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const steps: StepState[] = useMemo(() => [
    { label: "AE 需求整理", detail: prompt ? "已生成标准 brief" : "把客户口述转成标准 brief", state: prompt ? "done" : busy ? "working" : "idle" },
    { label: "策略判断", detail: "行业、客群、风格与预算", state: prompt ? "done" : "idle" },
    { label: "创意方向", detail: "生成广告原图与环境图路径", state: originalJob ? "done" : busy ? "working" : "idle" },
    { label: "视觉生成", detail: originalJob?.status || "GPT-image-2 异步主图", state: originalJob?.status === "failed" ? "failed" : originalJob?.status === "succeeded" ? "done" : originalJob?.status === "queued" ? "queued" : originalJob ? "working" : "idle" },
    { label: "环境合成", detail: composedJob?.status || (uploadAsset ? "套入门头或墙体照片" : "需先上传客户环境图"), state: composedJob?.status === "failed" ? "failed" : composedJob?.status === "succeeded" ? "done" : composedJob?.status === "queued" ? "queued" : composedJob ? "working" : "idle" },
    { label: "工厂输出", detail: vectorAsset ? "SVG 已生成" : "矢量稿待生成", state: vectorAsset ? "done" : "idle" }
  ], [prompt, busy, originalJob, composedJob, vectorAsset, uploadAsset]);

  const selectedImage = activeTab === "composed"
    ? activeImage(composedJob) || uploadPreview
    : activeTab === "original"
      ? activeImage(originalJob)
      : vectorAsset?.url;
  const storeName = useMemo(() => extractStoreName(customerText), [customerText]);
  const canGenerate = !busy && !uploading && Boolean(customerText.trim());
  const jobPrompt = polishedPromptText?.trim() || undefined;
  const previewStatus = useMemo(() => {
    if (uploading) return "环境图上传中";
    if (busy) return "AI 设计方案生成中";
    if (activeTab === "original") {
      return originalJob?.status === "succeeded" ? "广告原图已生成" : "等待广告原图生成";
    }
    if (activeTab === "vector") {
      return vectorAsset ? "矢量稿已生成" : "矢量稿待生成";
    }
    if (composedJob?.status === "succeeded") return "真实环境效果图已生成";
    return uploadAsset ? "等待套入 AI 设计方案" : "未上传环境图，可先查看广告原图";
  }, [activeTab, busy, composedJob, originalJob, uploadAsset, uploading, vectorAsset]);
  const promptSourceText = prompt?.source === "openai-chat"
    ? "gpt-5.5 润色"
    : prompt?.source === "template"
      ? "本地模板增强"
      : "历史 Anthropic";

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    setUploadAsset(null);
    const previewUrl = URL.createObjectURL(file);
    setUploadPreview(previewUrl);
    const form = new FormData();
    form.append("file", file);
    try {
      const { asset } = await requestJson<{ asset: AssetRecord }>("/api/uploads", {
        method: "POST",
        body: form
      });
      setUploadAsset(asset);
      setActiveTab("composed");
    } catch (err) {
      URL.revokeObjectURL(previewUrl);
      setUploadPreview("");
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  function handleDownload() {
    if (!selectedImage) return;
    const link = document.createElement("a");
    link.href = selectedImage;
    link.download = `adcraft-${activeTab}-${storeName}-${Date.now()}.${activeTab === "vector" ? "svg" : "png"}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function handleCopyPrompt() {
    if (!polishedPromptText?.trim()) return;
    await navigator.clipboard.writeText(polishedPromptText);
    setPromptCopied(true);
    window.setTimeout(() => setPromptCopied(false), 1400);
  }

  function handleResetPrompt() {
    if (!prompt) return;
    setPolishedPromptText(prompt.imagePrompt);
  }

  async function handleGenerate() {
    setBusy(true);
    setError("");
    setPrompt(null);
    setPolishedPromptText(null);
    setPromptCopied(false);
    setOriginalJob(null);
    setComposedJob(null);
    setVectorAsset(null);
    setActiveTab(uploadAsset ? "composed" : "original");

    try {
      const promptResponse = await requestJson<{ prompt: PromptRecord }>("/api/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerText, businessType, material, style })
      });
      setPrompt(promptResponse.prompt);
      setPolishedPromptText(promptResponse.prompt.imagePrompt);
      const generatedPrompt = promptResponse.prompt.imagePrompt;

      const originalResponse = await requestJson<{ job: JobRecord }>("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "original", promptId: promptResponse.prompt.id, prompt: generatedPrompt, mock: runMode === "mock" })
      });
      setOriginalJob(originalResponse.job);
      const finalOriginal = await pollJob(originalResponse.job.id, setOriginalJob);
      if (finalOriginal.status === "failed") throw new Error(finalOriginal.error || "广告原图生成失败");

      if (uploadAsset) {
        const composedResponse = await requestJson<{ job: JobRecord }>("/api/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "composed", promptId: promptResponse.prompt.id, prompt: generatedPrompt, inputAssetIds: [uploadAsset.id], mock: runMode === "mock" })
        });
        setComposedJob(composedResponse.job);
        const finalComposed = await pollJob(composedResponse.job.id, setComposedJob);
        if (finalComposed.status === "failed") throw new Error(finalComposed.error || "环境效果图生成失败");
      }

      const vectorResponse = await requestJson<{ asset: AssetRecord }>("/api/vector-assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          promptId: promptResponse.prompt.id,
          jobId: finalOriginal.id,
          svg: createVectorSvg(storeName)
        })
      });
      setVectorAsset(vectorResponse.asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerateWithCurrentPrompt() {
    if (!prompt || !jobPrompt) {
      await handleGenerate();
      return;
    }
    setBusy(true);
    setError("");
    setOriginalJob(null);
    setComposedJob(null);
    setVectorAsset(null);
    setActiveTab(uploadAsset ? "composed" : "original");

    try {
      const originalResponse = await requestJson<{ job: JobRecord }>("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "original", promptId: prompt.id, prompt: jobPrompt, mock: runMode === "mock" })
      });
      setOriginalJob(originalResponse.job);
      const finalOriginal = await pollJob(originalResponse.job.id, setOriginalJob);
      if (finalOriginal.status === "failed") throw new Error(finalOriginal.error || "广告原图生成失败");

      if (uploadAsset) {
        const composedResponse = await requestJson<{ job: JobRecord }>("/api/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "composed", promptId: prompt.id, prompt: jobPrompt, inputAssetIds: [uploadAsset.id], mock: runMode === "mock" })
        });
        setComposedJob(composedResponse.job);
        const finalComposed = await pollJob(composedResponse.job.id, setComposedJob);
        if (finalComposed.status === "failed") throw new Error(finalComposed.error || "环境效果图生成失败");
      }

      const vectorResponse = await requestJson<{ asset: AssetRecord }>("/api/vector-assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          promptId: prompt.id,
          jobId: finalOriginal.id,
          svg: createVectorSvg(storeName)
        })
      });
      setVectorAsset(vectorResponse.asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="mark">A</div>
          <span>AdCraft AI 广告工作台</span>
        </div>
        <nav className="nav">
          <button className="active">首页生成</button>
          <button>模板库</button>
          <button>工作流库</button>
          <button>案例库</button>
        </nav>
      </header>

      <div className="layout">
        <aside className="rail">
          {["首页", "项目", "画布", "导出", "客服"].map((item, index) => (
            <button key={item} className={index === 0 ? "active" : ""}>{item}</button>
          ))}
        </aside>

        <main className="main">
          <section className="workspace">
            <div className="left-pane">
              <div className="intro">
                <h1>从客户一句需求，生成可交付的广告效果图</h1>
                <p>专为门头招牌、文化墙、灯箱、喷绘、菜单海报和品牌 VI 设计的 AI 生产系统。</p>
              </div>

              <div className="generator-panel">
                <label className="field">
                  <span>客户需求</span>
                  <textarea aria-label="客户需求" data-testid="customer-text" value={customerText} onChange={(event) => setCustomerText(event.target.value)} />
                </label>

                <div className="mode-row" role="group" aria-label="生成模式">
                  <button className={runMode === "mock" ? "active" : ""} onClick={() => setRunMode("mock")} disabled={busy}>联调预览</button>
                  <button className={runMode === "live" ? "active live" : ""} onClick={() => setRunMode("live")} disabled={busy}>真实生图</button>
                  <span>{runMode === "mock" ? "完整跑通后端链路，不消耗 image2。" : "会调用真实 image2 接口，请确认需求和环境图。"}</span>
                </div>

                <div className="meta-row">
                  <label>
                    <span>业务</span>
                    <select aria-label="业务" data-testid="business-type" value={businessType} onChange={(event) => setBusinessType(event.target.value)}>
                      {businessTypes.map((item) => <option key={item.id}>{item.id}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>材质</span>
                    <input aria-label="材质" data-testid="material" value={material} onChange={(event) => setMaterial(event.target.value)} />
                  </label>
                  <label>
                    <span>风格</span>
                    <input aria-label="风格" data-testid="style" value={style} onChange={(event) => setStyle(event.target.value)} />
                  </label>
                  <button className="primary" data-testid="generate" onClick={handleGenerate} disabled={!canGenerate}>
                    {busy ? <Loader2 className="spin" size={18} /> : <Wand2 size={18} />}
                    生成方案
                  </button>
                </div>

                <div className="type-grid">
                  {businessTypes.map((item) => (
                    <button
                      key={item.id}
                      className={businessType === item.id ? "type-card selected" : "type-card"}
                      onClick={() => setBusinessType(item.id)}
                    >
                      <strong>{item.title}</strong>
                      <span>{item.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {prompt && (
                <section className="polished-panel">
                  <div className="section-heading">
                    <div>
                      <h2>AI 润色提示词</h2>
                      <p>{promptSourceText}，可编辑后用于下一次生图。</p>
                    </div>
                    {prompt.matchedPromptIds?.length ? <span>{prompt.matchedPromptIds.join(" / ")}</span> : null}
                  </div>
                  <textarea
                    aria-label="AI 润色提示词"
                    data-testid="polished-prompt"
                    value={polishedPromptText ?? ""}
                    onChange={(event) => setPolishedPromptText(event.target.value)}
                  />
                  {prompt.matchedPrompts?.length ? (
                    <div className="prompt-tags">
                      {prompt.matchedPrompts.slice(0, 3).map((item) => (
                        <span key={item.id}>{item.id} {item.title}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="prompt-actions">
                    <button onClick={handleCopyPrompt} disabled={!polishedPromptText?.trim()}>
                      <Copy size={16} />
                      {promptCopied ? "已复制" : "复制提示词"}
                    </button>
                    <button onClick={handleResetPrompt} disabled={!prompt}>
                      <RotateCcw size={16} />
                      重置为 AI 原版
                    </button>
                    <button className="accent" onClick={handleRegenerateWithCurrentPrompt} disabled={!canGenerate || !jobPrompt}>
                      <Send size={16} />
                      用当前提示词生图
                    </button>
                  </div>
                </section>
              )}

              <div className="steps">
                {steps.map((step) => (
                  <div className={`step ${step.state}`} key={step.label}>
                    <div className="step-icon">
                      {step.state === "working" ? <Loader2 className="spin" size={16} /> : step.state === "done" ? <Sparkles size={16} /> : <Palette size={16} />}
                    </div>
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </div>
                ))}
              </div>
            </div>

            <aside className="result-panel">
              <div className="upload-card">
                <div>
                  <h2>上传客户环境图</h2>
                  <p>系统识别门头区域、透视和灯光，生成真实环境效果图。</p>
                </div>
                <label className="upload-button">
                  <Upload size={18} />
                  {uploading ? "上传中" : "选择图片"}
                  <input data-testid="upload" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} disabled={busy || uploading} />
                </label>
              </div>

              <div className="preview-card">
                {selectedImage ? (
                  <button className="image-preview-button" onClick={() => setImageModalOpen(true)} aria-label="查看大图">
                    <img src={selectedImage} alt="生成结果" />
                    <span><Expand size={16} /> 查看大图</span>
                  </button>
                ) : (
                  <div className="empty-preview">
                    <ImagePlus size={48} />
                    <span>等待生成效果图</span>
                  </div>
                )}
                <div className="preview-caption">
                  <strong>{prompt ? `${storeName} 门头项目` : storeName}</strong>
                  <span>{previewStatus}</span>
                </div>
              </div>

              <div className={runMode === "live" ? "mode-badge live" : "mode-badge"}>
                {runMode === "live" ? "真实生图模式" : "联调预览模式"}
              </div>

              {prompt && (
                <div className="prompt-meta">
                  <div className="prompt-meta-head">
                    <strong>{promptSourceText}</strong>
                    {prompt.matchedPromptIds?.length ? <span>{prompt.matchedPromptIds.join(" / ")}</span> : null}
                  </div>
                  {prompt.matchedPrompts?.length ? (
                    <div className="prompt-tags">
                      {prompt.matchedPrompts.slice(0, 3).map((item) => (
                        <span key={item.id}>{item.id} {item.title}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}

              <div className="tabs">
                <button className={activeTab === "composed" ? "active" : ""} onClick={() => setActiveTab("composed")} disabled={!uploadPreview && !composedJob}>真实环境图</button>
                <button className={activeTab === "original" ? "active" : ""} onClick={() => setActiveTab("original")}>广告原图</button>
                <button className={activeTab === "vector" ? "active" : ""} onClick={() => setActiveTab("vector")}>矢量图</button>
              </div>

              <div className="actions-row">
                <button disabled={!selectedImage} onClick={handleDownload}>
                  <Download size={17} />
                  下载当前图
                </button>
                <button onClick={handleRegenerateWithCurrentPrompt} disabled={!canGenerate}>
                  <Send size={17} />
                  重新生成
                </button>
              </div>

              {error && <div className="error-box">{error}</div>}
            </aside>
          </section>
        </main>
      </div>

      {imageModalOpen && selectedImage && (
        <div className="image-modal" role="dialog" aria-modal="true" aria-label="生成结果大图" onClick={() => setImageModalOpen(false)}>
          <div className="image-modal-content" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setImageModalOpen(false)} aria-label="关闭大图">
              <X size={18} />
            </button>
            <img src={selectedImage} alt="生成结果大图" />
            <div className="modal-actions">
              <strong>{prompt ? `${storeName} 门头项目` : storeName}</strong>
              <button onClick={handleDownload}>
                <Download size={17} />
                下载当前图
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { AlertTriangle, CheckCircle2, Copy, Download, Expand, Eye, EyeOff, ImagePlus, Loader2, LogOut, Palette, RotateCcw, ScanText, Send, Sparkles, Type, Upload, Users, Wand2, X } from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { AdminUsers } from "./AdminUsers";
import { appUrl, requestJson } from "./api";
import { AuthUser, LoginView } from "./LoginView";

type JobStatus = "queued" | "running" | "succeeded" | "failed";
type JobType = "original" | "composed";
type AssetType = "upload" | "original" | "composed" | "vector" | "corrected";
type TextValidationStatus = "pending" | "passed" | "needs_review" | "unavailable";

interface TextPoint {
  x: number;
  y: number;
}

interface OcrRegion {
  id: string;
  text: string;
  confidence: number;
  polygon: TextPoint[];
}

interface TextValidationCheck {
  expectedText: string;
  detectedText?: string;
  confidence?: number;
  regionId?: string;
  matched: boolean;
}

interface TextValidationRecord {
  status: TextValidationStatus;
  expectedTexts: string[];
  regions: OcrRegion[];
  checks: TextValidationCheck[];
  error?: string;
}

interface TextCorrection {
  expectedText: string;
  regionId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  textColor: string;
  coverColor: string;
}

interface CorrectionDraft extends TextCorrection {
  jobId: string;
}

interface PromptRecord {
  id: string;
  customerText: string;
  businessType: string;
  material?: string;
  style?: string;
  brief: string;
  imagePrompt: string;
  negativePrompt: string;
  requiredVisibleTexts: string[];
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
  size: string;
  quality: string;
  error?: string;
  assets: AssetRecord[];
  requiredVisibleTexts?: string[];
  textValidation?: TextValidationRecord;
  textCorrections?: TextCorrection[];
  correctedAssets?: AssetRecord[];
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

const imageSizePresets = [
  { value: "3840x2160", label: "4K 横版" },
  { value: "2160x3840", label: "4K 竖版" },
  { value: "2560x3200", label: "4:5 海报" },
  { value: "1536x1024", label: "标准横版" },
  { value: "1024x1536", label: "标准竖版" },
  { value: "1024x1024", label: "标准方图" }
];

const imageQualityOptions = [
  { value: "high", label: "高质量" },
  { value: "medium", label: "标准质量" },
  { value: "low", label: "快速草图" },
  { value: "auto", label: "自动" }
];

const defaultNeed = "给一家服装工作室设计门头，店名“不晚 STUDIO”，白色墙面，黑色发光字，风格高级、干净，适合夜间亮灯展示。";

async function pollJob(id: string, onUpdate: (job: JobRecord) => void): Promise<JobRecord> {
  const deadline = Date.now() + 720_000;
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

function activeImage(job?: JobRecord | null, sourceOnly = false) {
  const url = (!sourceOnly ? job?.correctedAssets?.at(-1)?.url : undefined) || job?.assets?.[0]?.url;
  return url ? appUrl(url) : undefined;
}

function correctionKey(text: string): string {
  return text.toLocaleLowerCase().replace(/[\s·・.。,'"“”‘’\-_:：，,;；!?！？()（）\[\]【】]/g, "");
}

function rectangleForRegion(region?: OcrRegion): Omit<TextCorrection, "expectedText" | "regionId"> {
  if (!region?.polygon?.length) {
    return { x: 80, y: 80, width: 460, height: 120, fontSize: 72, textColor: "#111827", coverColor: "#ffffff" };
  }
  const xs = region.polygon.map((point) => point.x);
  const ys = region.polygon.map((point) => point.y);
  const x = Math.max(0, Math.floor(Math.min(...xs)));
  const y = Math.max(0, Math.floor(Math.min(...ys)));
  const width = Math.max(8, Math.ceil(Math.max(...xs) - Math.min(...xs)));
  const height = Math.max(8, Math.ceil(Math.max(...ys) - Math.min(...ys)));
  return { x, y, width, height, fontSize: Math.max(18, Math.round(height * 0.68)), textColor: "#111827", coverColor: "#ffffff" };
}

function isExperimentalResolution(size: string): boolean {
  const match = size.match(/^(\d+)x(\d+)$/);
  return Boolean(match && Number(match[1]) * Number(match[2]) > 2560 * 1440);
}

function GenerationLoading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="generation-loading" data-testid="generation-loading" role="status" aria-live="polite">
      <div className="loading-character-scene" aria-hidden="true">
        <div className="loading-halo" />
        <span className="loading-swatch swatch-blue" />
        <span className="loading-swatch swatch-green" />
        <span className="loading-swatch swatch-gold" />
        <div className="creative-operator">
          <div className="operator-head">
            <span className="operator-hair" />
            <span className="operator-ear" />
            <span className="operator-eye eye-left" />
            <span className="operator-eye eye-right" />
            <span className="operator-smile" />
          </div>
          <div className="operator-body">
            <span className="operator-collar collar-left" />
            <span className="operator-collar collar-right" />
          </div>
          <span className="operator-arm" />
          <span className="operator-hand" />
          <span className="operator-stylus" />
        </div>
        <div className="drawing-tablet">
          <span className="drawing-stroke" />
        </div>
      </div>
      <strong>{title}</strong>
      <span>{detail}</span>
      <div className="loading-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

export function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeView, setActiveView] = useState<"canvas" | "users">("canvas");
  const [customerText, setCustomerText] = useState(defaultNeed);
  const [requiredVisibleTextInput, setRequiredVisibleTextInput] = useState("");
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
  const [imageSize, setImageSize] = useState("3840x2160");
  const [imageQuality, setImageQuality] = useState("high");
  const [polishedPromptText, setPolishedPromptText] = useState<string | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [showSourceImage, setShowSourceImage] = useState(false);
  const [validatingText, setValidatingText] = useState(false);
  const [correctingText, setCorrectingText] = useState(false);
  const [correctionDraft, setCorrectionDraft] = useState<CorrectionDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void requestJson<{ user: AuthUser }>("/api/auth/me")
      .then((response) => setAuthUser(response.user))
      .catch(() => setAuthUser(null))
      .finally(() => setAuthLoading(false));
  }, []);

  const steps: StepState[] = useMemo(() => [
    { label: "AE 需求整理", detail: prompt ? "已生成标准 brief" : "把客户口述转成标准 brief", state: prompt ? "done" : busy ? "working" : "idle" },
    { label: "策略判断", detail: "行业、客群、风格与预算", state: prompt ? "done" : "idle" },
    { label: "创意方向", detail: "生成广告原图与环境图路径", state: originalJob ? "done" : busy ? "working" : "idle" },
    { label: "视觉生成", detail: originalJob?.status || "GPT-image-2 异步主图", state: originalJob?.status === "failed" ? "failed" : originalJob?.status === "succeeded" ? "done" : originalJob?.status === "queued" ? "queued" : originalJob ? "working" : "idle" },
    { label: "环境合成", detail: composedJob?.status || (uploadAsset ? "套入门头或墙体照片" : "需先上传客户环境图"), state: composedJob?.status === "failed" ? "failed" : composedJob?.status === "succeeded" ? "done" : composedJob?.status === "queued" ? "queued" : composedJob ? "working" : "idle" },
    { label: "工厂输出", detail: vectorAsset ? "SVG 已生成" : "矢量稿待生成", state: vectorAsset ? "done" : "idle" }
  ], [prompt, busy, originalJob, composedJob, vectorAsset, uploadAsset]);

  const activeImageJob = activeTab === "composed" ? composedJob : activeTab === "original" ? originalJob : null;
  const selectedImage = activeTab === "composed"
    ? activeImage(composedJob, showSourceImage) || uploadPreview
    : activeTab === "original"
      ? activeImage(originalJob, showSourceImage)
      : vectorAsset?.url ? appUrl(vectorAsset.url) : undefined;
  const textValidation = activeImageJob?.textValidation;
  const showingCorrectedImage = Boolean(activeImageJob?.correctedAssets?.length) && !showSourceImage;
  const visibleTextChecks = textValidation?.checks || (activeImageJob?.requiredVisibleTexts || []).map((expectedText) => ({ expectedText, matched: false }));
  const storeName = useMemo(() => extractStoreName(customerText), [customerText]);
  const canGenerate = authUser?.role !== "reviewer" && !busy && !uploading && Boolean(customerText.trim());
  const jobPrompt = polishedPromptText?.trim() || undefined;
  const generationLoading = useMemo(() => {
    if (!prompt) {
      return {
        title: "创意操作员正在整理需求",
        detail: "分析业务、材质与视觉方向"
      };
    }
    if (originalJob?.status !== "succeeded") {
      return {
        title: "正在绘制广告原图",
        detail: "构图、材质与文字细节正在成形"
      };
    }
    if (uploadAsset && composedJob?.status !== "succeeded") {
      return {
        title: "正在合成真实环境",
        detail: "匹配现场透视、光线与招牌位置"
      };
    }
    return {
      title: "正在整理交付图层",
      detail: "准备预览图与矢量输出"
    };
  }, [composedJob, originalJob, prompt, uploadAsset]);
  const previewStatus = useMemo(() => {
    if (uploading) return "环境图上传中";
    if (busy) return "AI 设计方案生成中";
    if (activeTab === "original") {
      if (showingCorrectedImage) return "文字校正图已生成，原图仍保留";
      return originalJob?.status === "succeeded" ? "广告原图已生成" : "等待广告原图生成";
    }
    if (activeTab === "vector") {
      return vectorAsset ? "矢量稿已生成" : "矢量稿待生成";
    }
    if (showingCorrectedImage) return "文字校正图已生成，原图仍保留";
    if (composedJob?.status === "succeeded") return "真实环境效果图已生成";
    return uploadAsset ? "等待套入 AI 设计方案" : "未上传环境图，可先查看广告原图";
  }, [activeTab, busy, composedJob, originalJob, showSourceImage, showingCorrectedImage, uploadAsset, uploading, vectorAsset]);
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

  function handleRunModeChange(mode: "mock" | "live") {
    if (mode === runMode) return;
    setRunMode(mode);
    setOriginalJob(null);
    setComposedJob(null);
    setVectorAsset(null);
    setShowSourceImage(false);
    setCorrectionDraft(null);
    setActiveTab(uploadAsset ? "composed" : "original");
    setError("");
  }

  function requestedVisibleTexts(): string[] {
    return requiredVisibleTextInput
      .split(/\n|,/)
      .map((value) => value.trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .slice(0, 8);
  }

  function updateJobState(job: JobRecord) {
    if (job.type === "composed") setComposedJob(job);
    else setOriginalJob(job);
  }

  async function requestTextValidation(job: JobRecord, silent = false) {
    if (job.status !== "succeeded") return;
    if (!silent) {
      setValidatingText(true);
      setError("");
    }
    try {
      const response = await requestJson<{ job: JobRecord }>(`/api/jobs/${job.id}/text-validation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      updateJobState(response.job);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : "文字校验失败");
    } finally {
      if (!silent) setValidatingText(false);
    }
  }

  function startCorrection(check: TextValidationCheck) {
    if (!activeImageJob) return;
    const existing = activeImageJob.textCorrections?.find((item) => correctionKey(item.expectedText) === correctionKey(check.expectedText));
    const region = activeImageJob.textValidation?.regions.find((item) => item.id === check.regionId);
    const rectangle = existing || rectangleForRegion(region);
    setCorrectionDraft({
      jobId: activeImageJob.id,
      expectedText: check.expectedText,
      regionId: existing?.regionId || check.regionId,
      ...rectangle
    });
  }

  async function applyCorrection() {
    if (!activeImageJob || !correctionDraft || correctionDraft.jobId !== activeImageJob.id) return;
    setCorrectingText(true);
    setError("");
    const nextCorrections = [
      ...(activeImageJob.textCorrections || []).filter((item) => correctionKey(item.expectedText) !== correctionKey(correctionDraft.expectedText)),
      {
        expectedText: correctionDraft.expectedText,
        regionId: correctionDraft.regionId,
        x: Number(correctionDraft.x),
        y: Number(correctionDraft.y),
        width: Number(correctionDraft.width),
        height: Number(correctionDraft.height),
        fontSize: Number(correctionDraft.fontSize),
        textColor: correctionDraft.textColor,
        coverColor: correctionDraft.coverColor
      }
    ];
    try {
      const response = await requestJson<{ job: JobRecord }>(`/api/jobs/${activeImageJob.id}/text-corrections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ corrections: nextCorrections })
      });
      updateJobState(response.job);
      setShowSourceImage(false);
      setCorrectionDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "文字重绘失败");
    } finally {
      setCorrectingText(false);
    }
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
    setShowSourceImage(false);
    setCorrectionDraft(null);
    setActiveTab(uploadAsset ? "composed" : "original");

    try {
      const promptResponse = await requestJson<{ prompt: PromptRecord }>("/api/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerText, businessType, material, style, requiredVisibleTexts: requestedVisibleTexts() })
      });
      setPrompt(promptResponse.prompt);
      setPolishedPromptText(promptResponse.prompt.imagePrompt);
      const generatedPrompt = promptResponse.prompt.imagePrompt;

      const originalResponse = await requestJson<{ job: JobRecord }>("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "original",
          promptId: promptResponse.prompt.id,
          prompt: generatedPrompt,
          size: imageSize,
          quality: imageQuality,
          mock: runMode === "mock"
        })
      });
      setOriginalJob(originalResponse.job);
      const finalOriginal = await pollJob(originalResponse.job.id, setOriginalJob);
      if (finalOriginal.status === "failed") throw new Error(finalOriginal.error || "广告原图生成失败");
      void requestTextValidation(finalOriginal, true);

      if (uploadAsset) {
        const composedResponse = await requestJson<{ job: JobRecord }>("/api/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "composed",
            promptId: promptResponse.prompt.id,
            prompt: generatedPrompt,
            size: imageSize,
            quality: imageQuality,
            inputAssetIds: [uploadAsset.id],
            mock: runMode === "mock"
          })
        });
        setComposedJob(composedResponse.job);
        const finalComposed = await pollJob(composedResponse.job.id, setComposedJob);
        if (finalComposed.status === "failed") throw new Error(finalComposed.error || "环境效果图生成失败");
        void requestTextValidation(finalComposed, true);
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
    setShowSourceImage(false);
    setCorrectionDraft(null);
    setActiveTab(uploadAsset ? "composed" : "original");

    try {
      const originalResponse = await requestJson<{ job: JobRecord }>("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "original",
          promptId: prompt.id,
          prompt: jobPrompt,
          size: imageSize,
          quality: imageQuality,
          mock: runMode === "mock"
        })
      });
      setOriginalJob(originalResponse.job);
      const finalOriginal = await pollJob(originalResponse.job.id, setOriginalJob);
      if (finalOriginal.status === "failed") throw new Error(finalOriginal.error || "广告原图生成失败");
      void requestTextValidation(finalOriginal, true);

      if (uploadAsset) {
        const composedResponse = await requestJson<{ job: JobRecord }>("/api/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "composed",
            promptId: prompt.id,
            prompt: jobPrompt,
            size: imageSize,
            quality: imageQuality,
            inputAssetIds: [uploadAsset.id],
            mock: runMode === "mock"
          })
        });
        setComposedJob(composedResponse.job);
        const finalComposed = await pollJob(composedResponse.job.id, setComposedJob);
        if (finalComposed.status === "failed") throw new Error(finalComposed.error || "环境效果图生成失败");
        void requestTextValidation(finalComposed, true);
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

  async function handleLogout() {
    await requestJson("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setAuthUser(null);
    setActiveView("canvas");
  }

  if (authLoading) {
    return <div className="auth-loading" role="status"><Loader2 className="spin" size={24} /><span>正在连接广告工作台</span></div>;
  }
  if (!authUser) return <LoginView onLogin={setAuthUser} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="mark">A</div>
          <span>AdCraft AI 广告工作台</span>
        </div>
        <div className="topbar-right">
          <nav className="nav">
            <button className={activeView === "canvas" ? "active" : ""} onClick={() => setActiveView("canvas")}>首页生成</button>
            {authUser.role === "admin" ? <button className={activeView === "users" ? "active" : ""} onClick={() => setActiveView("users")}>用户管理</button> : null}
          </nav>
          <div className="account-menu"><span className="account-avatar">{authUser.nickname.slice(0, 1)}</span><div><strong>{authUser.nickname}</strong><small>{authUser.creditBalance} 积分</small></div><button title="退出登录" onClick={() => void handleLogout()}><LogOut size={17} /></button></div>
        </div>
      </header>

      <div className="layout">
        <aside className="rail">
          <button className={activeView === "canvas" ? "active" : ""} onClick={() => setActiveView("canvas")}>画布</button>
          {authUser.role === "admin" ? <button className={activeView === "users" ? "active" : ""} onClick={() => setActiveView("users")}><Users size={17} />用户</button> : null}
        </aside>

        {activeView === "users" && authUser.role === "admin" ? (
          <main className="main admin-main"><AdminUsers currentUserId={authUser.id} /></main>
        ) : (
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

                <label className="field required-text-field">
                  <span>需原样显示的文字</span>
                  <textarea
                    aria-label="需原样显示的文字"
                    data-testid="required-visible-texts"
                    value={requiredVisibleTextInput}
                    onChange={(event) => setRequiredVisibleTextInput(event.target.value)}
                    placeholder="每行一条，例如：不晚 STUDIO"
                  />
                  <small>这组文字会作为 OCR 校验真值；一行一条，最多 8 条。留空时从客户需求中的引号文字推断。企业历程的长事件会写入时间轴提示词，需人工目检，不会自动作为 OCR 真值。</small>
                </label>

                <div className="mode-row" role="group" aria-label="生成模式">
                  <button className={runMode === "mock" ? "active" : ""} onClick={() => handleRunModeChange("mock")} disabled={busy}>联调预览</button>
                  <button className={runMode === "live" ? "active live" : ""} onClick={() => handleRunModeChange("live")} disabled={busy}>真实生图</button>
                  <span>{runMode === "mock" ? "完整跑通后端链路，不消耗 image2。" : "会调用真实 image2 接口，请确认需求和环境图。"}</span>
                </div>

                <div className="output-row">
                  <label>
                    <span>输出尺寸</span>
                    <select aria-label="输出尺寸" value={imageSize} onChange={(event) => setImageSize(event.target.value)} disabled={busy}>
                      {imageSizePresets.map((item) => <option key={item.value} value={item.value}>{item.label} · {item.value}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>生成质量</span>
                    <select aria-label="生成质量" value={imageQuality} onChange={(event) => setImageQuality(event.target.value)} disabled={busy}>
                      {imageQualityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                  </label>
                  <p className={isExperimentalResolution(imageSize) ? "resolution-note experimental" : "resolution-note"}>
                    {isExperimentalResolution(imageSize)
                      ? "高分辨率输出仍属实验性能力，会增加费用和等待时间；中文文字生成后仍需逐字复核。"
                      : "标准尺寸适合快速出稿；中文文字生成后仍需逐字复核。"}
                  </p>
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
                  <input data-testid="upload" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} disabled={authUser.role === "reviewer" || busy || uploading} />
                </label>
              </div>

              <div className="preview-card">
                {busy ? (
                  <GenerationLoading title={generationLoading.title} detail={generationLoading.detail} />
                ) : selectedImage ? (
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
                <button className={activeTab === "composed" ? "active" : ""} onClick={() => { setActiveTab("composed"); setShowSourceImage(false); setCorrectionDraft(null); }} disabled={!uploadPreview && !composedJob}>真实环境图</button>
                <button className={activeTab === "original" ? "active" : ""} onClick={() => { setActiveTab("original"); setShowSourceImage(false); setCorrectionDraft(null); }}>广告原图</button>
                <button className={activeTab === "vector" ? "active" : ""} onClick={() => { setActiveTab("vector"); setCorrectionDraft(null); }}>矢量图</button>
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

              {activeImageJob && activeTab !== "vector" && (
                <section className="text-validation-panel" aria-label="文字校验与重绘">
                  <div className="text-validation-head">
                    <div>
                      <strong>文字校验与重绘</strong>
                      <span aria-live="polite">
                        {textValidation?.status === "passed" ? "已逐字通过 OCR 校验" : textValidation?.status === "needs_review" ? "发现待复核文字" : textValidation?.status === "unavailable" ? "OCR 服务未就绪，未标记为通过" : "等待 OCR 校验"}
                      </span>
                    </div>
                    <div className="text-validation-tools">
                      {activeImageJob.correctedAssets?.length ? (
                        <button onClick={() => setShowSourceImage((value) => !value)}>
                          {showSourceImage ? <Eye size={15} /> : <EyeOff size={15} />}
                          {showSourceImage ? "查看校正图" : "查看原图"}
                        </button>
                      ) : null}
                      <button onClick={() => void requestTextValidation(activeImageJob)} disabled={validatingText || activeImageJob.status !== "succeeded"}>
                        {validatingText ? <Loader2 className="spin" size={15} /> : <ScanText size={15} />}
                        {validatingText ? "校验中" : textValidation ? "重新校验" : "校验文字"}
                      </button>
                    </div>
                  </div>

                  {textValidation?.error ? <p className="text-validation-note"><AlertTriangle size={15} />{textValidation.error}</p> : null}
                  {visibleTextChecks.length ? (
                    <div className="text-check-list">
                      {visibleTextChecks.map((check) => (
                        <div className={check.matched ? "text-check passed" : "text-check needs-review"} key={check.expectedText}>
                          <div>
                            <strong>{check.expectedText}</strong>
                            <span>{check.detectedText ? `OCR：${check.detectedText}${check.confidence === undefined ? "" : ` · ${Math.round(check.confidence * 100)}%`}` : "未检测到可确认文字"}</span>
                          </div>
                          <div className="text-check-actions">
                            <span>{check.matched ? <><CheckCircle2 size={15} />通过</> : <><AlertTriangle size={15} />待复核</>}</span>
                            <button onClick={() => startCorrection(check)} disabled={correctingText}>
                              <Type size={15} />
                              {check.matched ? "重绘清晰" : "重绘纠正"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-validation-empty">先在左侧填写“需原样显示的文字”，再生成或重新校验。</p>
                  )}

                  {correctionDraft && correctionDraft.jobId === activeImageJob.id ? (
                    <div className="correction-editor">
                      <div className="correction-editor-head">
                        <div>
                          <strong>重绘「{correctionDraft.expectedText}」</strong>
                          <span>以原图像素坐标覆盖旧字后，用真实字体输出新的清晰文字。</span>
                        </div>
                        <button className="icon-button" onClick={() => setCorrectionDraft(null)} aria-label="关闭文字重绘设置"><X size={16} /></button>
                      </div>
                      <div className="correction-grid">
                        {(["x", "y", "width", "height", "fontSize"] as const).map((key) => (
                          <label key={key}>
                            <span>{key === "fontSize" ? "字号" : key.toUpperCase()}</span>
                            <input type="number" min="0" value={correctionDraft[key]} onChange={(event) => setCorrectionDraft({ ...correctionDraft, [key]: Number(event.target.value) })} />
                          </label>
                        ))}
                        <label>
                          <span>文字色</span>
                          <input type="color" value={correctionDraft.textColor} onChange={(event) => setCorrectionDraft({ ...correctionDraft, textColor: event.target.value })} />
                        </label>
                        <label>
                          <span>覆盖底色</span>
                          <input type="color" value={correctionDraft.coverColor} onChange={(event) => setCorrectionDraft({ ...correctionDraft, coverColor: event.target.value })} />
                        </label>
                      </div>
                      <div className="correction-actions">
                        <button onClick={() => setCorrectionDraft(null)} disabled={correctingText}>取消</button>
                        <button className="accent" onClick={() => void applyCorrection()} disabled={correctingText}>
                          {correctingText ? <Loader2 className="spin" size={16} /> : <Type size={16} />}
                          {correctingText ? "正在生成校正图" : "应用清晰重绘"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              )}

              {error && <div className="error-box">{error}</div>}
            </aside>
          </section>
        </main>
        )}
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

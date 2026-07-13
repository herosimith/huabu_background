import { nanoid } from "nanoid";
import { config } from "../config.js";
import { nowIso } from "../lib/time.js";
import { store } from "../store/jsonStore.js";
import type { PromptRecord } from "../types.js";
import { matchPromptLibrary, toMatchedPromptSummary, type PromptLibraryMatch } from "./promptLibrary.js";

interface PromptInput {
  customerText: string;
  businessType?: string;
  material?: string;
  style?: string;
  requiredVisibleTexts?: string[];
  userId?: string;
}

interface TimelineRow {
  year: string;
  event: string;
}

interface EnterpriseTimeline {
  heading?: string;
  subtitle?: string;
  rows: TimelineRow[];
}

const DEFAULT_NEGATIVE_PROMPT = [
  "software interface",
  "screenshot",
  "red annotations",
  "grid overlay",
  "comparison layout",
  "vector graphics",
  "logo presentation board",
  "blurred text",
  "garbled Chinese text",
  "incorrect characters",
  "wrong Chinese characters",
  "missing character strokes",
  "duplicated text",
  "random English words",
  "random numbers",
  "dense small text",
  "low-contrast text",
  "text occlusion",
  "complex background behind text",
  "neon signs",
  "cluttered street",
  "overexposed lighting",
  "tilted perspective",
  "people blocking view",
  "watermarks"
].join(", ");

function normalizeCustomerText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function parseEnterpriseTimeline(value: string): EnterpriseTimeline | null {
  const lines = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const rows: TimelineRow[] = [];
  const years = new Set<string>();
  let firstRowIndex = -1;

  for (const [index, line] of lines.entries()) {
    const match = line.match(/^(?:[-*•]\s*)?((?:19|20)\d{2})(?:年)?(?:\s+|[：:]\s*|[—–-]\s*)(.+?)\s*$/);
    if (!match) continue;
    const year = match[1];
    const event = match[2].trim();
    if (event.length < 4 || event.length > 240 || years.has(year)) continue;
    if (firstRowIndex < 0) firstRowIndex = index;
    years.add(year);
    rows.push({ year, event });
  }

  if (rows.length < 3 || firstRowIndex < 0) return null;
  const headingLines = lines.slice(0, firstRowIndex).filter((line) => (
    line.length <= 36
    && !/^年份/.test(line)
    && !/^从(?:19|20)\d{2}/.test(line)
    && !/(?:关键事实|生成一个|材质|尺寸)/.test(line)
  ));
  const heading = headingLines.find((line) => /(?:企业|公司|品牌).*(?:历程|大事记)|(?:发展|历史).*(?:历程|大事记)/.test(line));
  const subtitle = headingLines.find((line) => line !== heading && /(?:来时之路|薪火|新征程|发展之路)/.test(line));

  return { heading, subtitle, rows: rows.slice(0, 12) };
}

function extractStoreName(value: string): string | undefined {
  const quoted = value.match(/[“"']([^”"']{2,40})[”"']/)?.[1]?.trim();
  if (quoted) return quoted;
  const named = value.match(/(?:店名|品牌名|招牌名|名称)\s*[：:为叫]?\s*([\u4e00-\u9fa5A-Za-z0-9·.\-\s]{2,40})/)?.[1]?.trim();
  return named?.replace(/[，。,；;].*$/, "").trim() || undefined;
}

function normalizeSignText(value: string): string {
  return value.toLowerCase().replace(/[\s·・.。"'“”‘’\-_:：,，;；]/g, "");
}

function extractRequestedVisibleTexts(value: string): string[] {
  const texts: string[] = [];
  const storeName = extractStoreName(value);
  if (storeName) texts.push(storeName);

  const quotedText = /(?:“([^”]{1,80})”|"([^"]{1,80})"|「([^」]{1,80})」|『([^』]{1,80})』)/g;
  for (const match of value.matchAll(quotedText)) {
    const text = match.slice(1).find(Boolean)?.trim();
    if (text) texts.push(text);
  }

  const seen = new Set<string>();
  return texts.filter((text) => {
    const normalized = normalizeSignText(text);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, 8);
}

function normalizeRequiredVisibleTexts(values?: string[]): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  return values
    .map((value) => String(value || "").trim().replace(/\s+/g, " "))
    .filter((value) => value.length > 0 && value.length <= 80)
    .filter((value) => {
      const normalized = normalizeSignText(value);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 8);
}

function requiredVisibleTexts(input: PromptInput, customerText: string, timeline?: EnterpriseTimeline | null): string[] {
  const explicit = normalizeRequiredVisibleTexts(input.requiredVisibleTexts);
  if (explicit.length) return explicit;
  return extractRequestedVisibleTexts(customerText).filter((text) => {
    const normalized = normalizeSignText(text);
    return !timeline?.rows.some((row) => normalizeSignText(row.event).includes(normalized));
  });
}

function timelineWallContract(timeline?: EnterpriseTimeline | null): string {
  if (!timeline) return "";
  const rows = timeline.rows
    .map((row, index) => `${index + 1}. ${row.year}：${row.event}`)
    .join("\n");
  return [
    "企业历程墙内容规则（最高优先级）：",
    `这是一块横向企业历程文化墙，不是只标年份的装饰画。必须按时间顺序呈现下面 ${timeline.rows.length} 个节点，年份与里程碑事件一一对应、完整可见。`,
    timeline.heading ? `主标题必须原样显示为「${timeline.heading}」。` : "",
    timeline.subtitle ? `副标题必须原样显示为「${timeline.subtitle}」。` : "",
    "每个节点都必须同时保留年份和对应的完整中文事件。禁止将事件替换成图标、圆点、空白吊牌、缩略词或占位文字；不得遗漏、合并、改写或重排任何节点。",
    "采用横向 3.1m × 1.4m PVC 异形企业文化墙的正视设计，可使用双层时间轴和紧凑的两至三行事件说明。空间不足时优先减少装饰、留白和背景纹样，不得删减事件文字；所有事件文字必须清晰、可读、对比度高。",
    "以下企业历程数据必须逐条原样呈现：",
    rows
  ].filter(Boolean).join("\n");
}

function visibleTextContract(texts: string[], timeline?: EnterpriseTimeline | null): string {
  if (!texts.length && !timeline) {
    return "The customer supplied no exact display text. Do not invent readable words, letters, numbers, placeholder copy, or random logos.";
  }

  const exactTextList = texts
    .map((text, index) => `${index + 1}. 「${text.replace(/[「」]/g, "")}」`)
    .join(" ");
  return [
    texts.length ? `必须原样显示以下文字，不得改写、翻译、增删或重复：${exactTextList}` : "不设置独立的品牌或招牌文字；可读文字必须来自下方企业历程数据。",
    timeline
      ? "除上述文字和下方企业历程数据外，不生成任何额外文字、英文、数字、占位符或随机 Logo。"
      : "只显示以上客户指定文字，不生成任何额外文字、英文、数字、占位符或随机 Logo。",
    "文字排版要求：主要文字使用清晰粗体和足够大的字号，字符笔画完整，字间距宽松，对比度强。",
    "把文字放在干净、低纹理的留白区域，不得被人物、装饰、反光或建筑结构遮挡。",
    timeline
      ? "企业历程允许使用紧凑的多节点版式；每条里程碑都是必需内容，不套用最多四个信息模块的限制。"
      : "画面最多四个信息模块，装饰元素不得遮挡文字。"
  ].join(" ");
}

function ensureVisibleTextContract(prompt: string, texts: string[], timeline?: EnterpriseTimeline | null): string {
  return [prompt.trim(), visibleTextContract(texts, timeline), timelineWallContract(timeline)].filter(Boolean).join("\n\n");
}

function mergeNegativePrompt(value?: string): string {
  const supplied = value?.trim();
  return supplied ? `${supplied}, ${DEFAULT_NEGATIVE_PROMPT}` : DEFAULT_NEGATIVE_PROMPT;
}

function extractReferenceSignTexts(matches: PromptLibraryMatch[]): string[] {
  const values = matches.flatMap((match) => {
    const promptText = match.promptText;
    const candidates: string[] = [];
    for (const regex of [
      /内容[：:]\s*[“"']([^”"']{2,60})[”"']/g,
      /店名[：:为叫]?\s*[“"']?([\u4e00-\u9fa5A-Za-z0-9·・.\-\s]{2,40})[”"']?/g,
      /品牌名[：:为叫]?\s*[“"']?([\u4e00-\u9fa5A-Za-z0-9·・.\-\s]{2,40})[”"']?/g
    ]) {
      for (const matchResult of promptText.matchAll(regex)) {
        const value = matchResult[1]?.replace(/[，。,；;\n].*$/, "").trim();
        if (value) candidates.push(value);
      }
    }
    return candidates;
  });
  return Array.from(new Set(values));
}

function replaceUnrequestedReferenceText(text: string, input: PromptInput, matches: PromptLibraryMatch[]): string {
  const customerText = normalizeCustomerText(input.customerText);
  const storeName = parseEnterpriseTimeline(input.customerText) ? undefined : extractStoreName(customerText);
  let output = text;
  for (const referenceText of extractReferenceSignTexts(matches)) {
    const referenceNormalized = normalizeSignText(referenceText);
    if (!referenceNormalized) continue;
    const requested = normalizeSignText(customerText).includes(referenceNormalized);
    const replacement = storeName ? `"${storeName}"` : "the requested customer sign text";
    if (!requested && !normalizeSignText(storeName || "").includes(referenceNormalized)) {
      output = output.split(referenceText).join(replacement);
      output = output.split(referenceText.replace(/・/g, " ")).join(replacement);
      output = output.split(referenceText.replace(/·/g, " ")).join(replacement);
    } else if (storeName && referenceText !== storeName) {
      output = output.split(referenceText).join(storeName);
    }
  }
  return output;
}

function referenceSummary(matches: PromptLibraryMatch[]): string {
  if (!matches.length) return "";
  return [
    "Use these local advertising prompt-library matches only for craft language, camera direction, material detail, and composition logic; do not copy unrequested names from them.",
    ...matches.map((match) => {
      const compactText = match.sanitizedPromptText
        .replace(/\s+/g, " ")
        .replace(/[“"']([^”"']{2,60})[”"']/g, "指定客户文案")
        .slice(0, 360);
      return `[${match.id}] ${match.category}/${match.title}: ${compactText}`;
    })
  ].join(" ");
}

function buildTemplatePrompt(input: PromptInput, matches: PromptLibraryMatch[] = []): Omit<PromptRecord, "id" | "createdAt"> {
  const customerText = normalizeCustomerText(input.customerText);
  const businessType = input.businessType?.trim() || "门头招牌";
  const material = input.material?.trim() || "白色墙面、黑色发光字";
  const style = input.style?.trim() || "高级、干净、适合夜间亮灯展示";
  const timeline = parseEnterpriseTimeline(input.customerText);
  const storeName = timeline ? undefined : extractStoreName(customerText);
  const requestedVisibleTexts = requiredVisibleTexts(input, customerText, timeline);
  const references = referenceSummary(matches);
  const signText = timeline
    ? "This is an enterprise history wall. Treat the supplied timeline data as the primary readable content, not as decorative dates or a storefront sign."
    : storeName
    ? `The sign text must read exactly "${storeName}", with no extra words, no misspellings, and no invented brand text.`
    : "If the customer did not provide a brand name, avoid inventing random readable brand text; keep any signage abstract or unreadable.";
  const brief = [
    `业务类型：${businessType}`,
    `客户需求：${customerText}`,
    `材质方向：${material}`,
    `视觉风格：${style}`,
    matches.length ? `参考模板：${matches.map((match) => `${match.id} ${match.title}`).join("、")}` : "",
    "交付目标：广告原图、真实环境效果图、可导出 SVG 图层。"
  ].filter(Boolean).join("\n");

  const imagePrompt = [
    `Create one finished commercial advertising effect image for "${businessType}", based on the customer brief.`,
    "Use realistic architectural/commercial photography, front-facing perspective, eye-level camera, 35mm lens feel, clean composition, credible scale, and commercial-grade finish quality.",
    signText,
    `Visible materials and craft direction: ${material}.`,
    `Visual style direction: ${style}.`,
    "For storefront or signage work, show the sign integrated into a real facade with believable perspective, shadows, reflections, wall texture, and lighting; avoid looking like a flat UI mockup.",
    "Warm practical lighting and subtle environmental light should reveal the structure and material details without overexposure.",
    "Single final image only, no software interface, no annotation marks, no comparison board, no prompt text, no process sheet.",
    references,
    `Customer requirement context: ${customerText}`
  ].filter(Boolean).join(" ");
  const matchedPrompts = matches.map(toMatchedPromptSummary);

  return {
    customerText,
    businessType,
    material,
    style,
    brief,
    imagePrompt: ensureVisibleTextContract(replaceUnrequestedReferenceText(imagePrompt, input, matches), requestedVisibleTexts, timeline),
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    requiredVisibleTexts: requestedVisibleTexts,
    source: "template",
    matchedPromptIds: matchedPrompts.map((match) => match.id),
    matchedPrompts
  };
}

function chatCompletionsUrl(): string {
  if (config.chat.baseUrl.endsWith("/chat/completions")) return config.chat.baseUrl;
  return `${config.chat.baseUrl}/chat/completions`;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const cleaned = value.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function tryOpenAIChatPrompt(input: PromptInput, matches: PromptLibraryMatch[]): Promise<Omit<PromptRecord, "id" | "createdAt"> | null> {
  if (!config.chat.apiKey || !config.chat.model) return null;

  const customerText = normalizeCustomerText(input.customerText);
  const timeline = parseEnterpriseTimeline(input.customerText);
  const storeName = timeline ? undefined : extractStoreName(customerText);
  const requestedVisibleTexts = requiredVisibleTexts(input, customerText, timeline);
  const matchedPrompts = matches.map(toMatchedPromptSummary);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.chat.timeoutMs);
  const body = {
    model: config.chat.model,
    messages: [
      {
        role: "system",
        content: [
          "You are an advertising design prompt director for image generation.",
          "Rewrite a customer requirement into a stronger prompt for a GPT-image-2/image2 workflow.",
          "Use local prompt-library references for structure, craft terms, camera language, material detail, and composition, but never copy reference brand names or text unless the customer also requested them.",
          "Return only strict JSON. Do not wrap in markdown.",
          "Required JSON keys: brief, imagePrompt, negativePrompt, businessType, material, style.",
          "brief must be Chinese and operational for an advertising designer.",
          "imagePrompt should be precise, visual, production-ready, and generate one final deliverable advertising image, not a UI screenshot, prompt board, grid, or comparison image.",
          timeline
            ? "When enterpriseTimelineRows are supplied, treat every year-event pair as mandatory readable content. Preserve all rows in chronological order, never replace events with icons or placeholders, and do not apply a four-module limit."
            : storeName ? `The primary sign or brand text must be exactly: ${storeName}` : "If no brand text is provided, do not invent readable brand text.",
          "Keep customer-supplied visible text short, large, high-contrast, and isolated from complex textures. Never invent extra readable text.",
          "Preserve the customer's business type, material constraints, and style direction."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          customerRequirement: customerText,
          businessType: input.businessType,
          material: input.material,
          style: input.style,
          requiredVisibleTexts: requestedVisibleTexts,
          enterpriseTimelineRows: timeline?.rows || [],
          enterpriseTimelineHeading: timeline?.heading,
          enterpriseTimelineSubtitle: timeline?.subtitle,
          selectedAdvertisingPromptReferences: matches.map((match) => ({
            id: match.id,
            title: match.title,
            category: match.category,
            score: match.score,
            promptText: match.sanitizedPromptText
          }))
        }, null, 2)
      }
    ]
  };

  try {
    const response = await fetch(chatCompletionsUrl(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${config.chat.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) return null;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = payload.choices?.map((choice) => choice.message?.content || "").join("\n").trim() || "";
    const parsed = parseJsonObject(text);
    if (!parsed) return null;

    const brief = stringField(parsed.brief);
    const rawImagePrompt = stringField(parsed.imagePrompt);
    if (!brief || !rawImagePrompt) return null;
    const imagePrompt = ensureVisibleTextContract(replaceUnrequestedReferenceText(rawImagePrompt, input, matches), requestedVisibleTexts, timeline);

    return {
      customerText,
      businessType: stringField(parsed.businessType) || input.businessType?.trim() || "门头招牌",
      material: stringField(parsed.material) || input.material?.trim(),
      style: stringField(parsed.style) || input.style?.trim(),
      brief,
      imagePrompt,
      negativePrompt: mergeNegativePrompt(stringField(parsed.negativePrompt)),
      requiredVisibleTexts: requestedVisibleTexts,
      source: "openai-chat",
      matchedPromptIds: matchedPrompts.map((match) => match.id),
      matchedPrompts
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function createPrompt(input: PromptInput): Promise<PromptRecord> {
  const matches = await matchPromptLibrary(input, 3);
  const promptBase = await tryOpenAIChatPrompt(input, matches).catch(() => null) ?? buildTemplatePrompt(input, matches);
  const record: PromptRecord = {
    id: `prompt_${nanoid(12)}`,
    ...promptBase,
    userId: input.userId,
    createdAt: nowIso()
  };
  await store.savePrompt(record);
  return record;
}

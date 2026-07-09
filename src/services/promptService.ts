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
  "incorrect characters",
  "random English words",
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

function extractStoreName(value: string): string | undefined {
  const quoted = value.match(/[“"']([^”"']{2,40})[”"']/)?.[1]?.trim();
  if (quoted) return quoted;
  const named = value.match(/(?:店名|品牌名|招牌名|名称)\s*[：:为叫]?\s*([\u4e00-\u9fa5A-Za-z0-9·.\-\s]{2,40})/)?.[1]?.trim();
  return named?.replace(/[，。,；;].*$/, "").trim() || undefined;
}

function normalizeSignText(value: string): string {
  return value.toLowerCase().replace(/[\s·・.。"'“”‘’\-_:：,，;；]/g, "");
}

function ensureStoreName(prompt: string, storeName?: string): string {
  if (!storeName) return prompt;
  if (normalizeSignText(prompt).includes(normalizeSignText(storeName))) return prompt;
  return `${prompt} The primary sign text must read exactly "${storeName}" and must not invent or copy any other brand name.`;
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
  const storeName = extractStoreName(customerText);
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
  const storeName = extractStoreName(customerText);
  const references = referenceSummary(matches);
  const signText = storeName
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
    imagePrompt: replaceUnrequestedReferenceText(ensureStoreName(imagePrompt, storeName), input, matches),
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
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
  const storeName = extractStoreName(customerText);
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
          storeName ? `The primary sign or brand text must be exactly: ${storeName}` : "If no brand text is provided, do not invent readable brand text.",
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
    const imagePrompt = replaceUnrequestedReferenceText(ensureStoreName(rawImagePrompt, storeName), input, matches);

    return {
      customerText,
      businessType: stringField(parsed.businessType) || input.businessType?.trim() || "门头招牌",
      material: stringField(parsed.material) || input.material?.trim(),
      style: stringField(parsed.style) || input.style?.trim(),
      brief,
      imagePrompt,
      negativePrompt: stringField(parsed.negativePrompt) || DEFAULT_NEGATIVE_PROMPT,
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
    createdAt: nowIso()
  };
  await store.savePrompt(record);
  return record;
}

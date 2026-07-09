import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { MatchedPromptSummary } from "../types.js";

export interface PromptLibraryInput {
  customerText: string;
  businessType?: string;
  material?: string;
  style?: string;
}

interface PromptLibraryData {
  items?: PromptLibraryItem[];
}

export interface PromptLibraryItem {
  index: number;
  title: string;
  category: string;
  promptText: string;
  promptTextPath?: string;
  localImagePath?: string;
  sourceLabel?: string;
}

export interface PromptLibraryMatch extends PromptLibraryItem {
  id: string;
  score: number;
  imageUrl?: string;
  sanitizedPromptText: string;
}

const categoryAliases: Record<string, string[]> = {
  "门头招牌": ["门头", "招牌", "店招", "店面", "店铺", "发光字", "灯箱", "立体字", "门脸", "入口"],
  "文化墙": ["文化墙", "党建", "校园文化", "企业文化", "墙面文化"],
  "展板": ["展板", "宣传栏", "看板"],
  "美陈": ["美陈", "打卡", "景观小品", "公共空间", "装置"],
  "海报": ["海报", "宣传海报", "活动海报", "竖版", "横版", "促销"],
  "餐饮海报": ["餐饮海报", "菜单", "菜品", "炒鸡", "米线", "凉皮", "啤酒", "汉堡", "炸鸡", "餐饮"],
  "品牌物料": ["品牌物料", "物料", "vi", "包装", "手提袋", "纸杯", "菜单", "名片"],
  "LOGO": ["logo", "标志", "商标", "品牌标识", "字体设计"],
  "标识牌": ["标识牌", "导视", "指示牌", "标牌"],
  "图形设计": ["辅助图形", "图形设计", "品牌图形"]
};

const businessAliases: Record<string, string[]> = {
  "服装": ["服装", "女装", "男装", "衣服", "穿搭", "时装", "工作室", "studio"],
  "餐饮": ["餐饮", "饭店", "小吃", "火锅", "串串", "米线", "凉皮", "炒鸡", "炸鸡", "汉堡", "奶茶", "咖啡", "面包", "烘焙"],
  "校园": ["学校", "校园", "小学", "中学", "学生", "科技", "安全"],
  "城市": ["城市", "成都", "文旅", "公共空间"],
  "科技": ["科技", "ai", "智能", "未来", "数字"],
  "节日": ["中秋", "节日", "月饼", "国庆"]
};

let cachedItems: PromptLibraryItem[] | null = null;

function promptId(index: number): string {
  return String(index).padStart(3, "0");
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function combinedInput(input: PromptLibraryInput): string {
  return [input.customerText, input.businessType, input.material, input.style]
    .filter(Boolean)
    .join(" ");
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function inferCategories(inputText: string): string[] {
  const normalized = normalizeText(inputText);
  const categories = Object.entries(categoryAliases)
    .filter(([, aliases]) => aliases.some((alias) => normalized.includes(alias.toLowerCase())))
    .map(([category]) => category);
  return unique(categories);
}

function inferBusinessTags(inputText: string): string[] {
  const normalized = normalizeText(inputText);
  return Object.entries(businessAliases)
    .filter(([, aliases]) => aliases.some((alias) => normalized.includes(alias.toLowerCase())))
    .map(([tag]) => tag);
}

function extractKeywords(inputText: string): string[] {
  const normalized = normalizeText(inputText);
  const asciiWords = normalized.match(/[a-z0-9][a-z0-9.+-]{1,}/g) || [];
  const chinesePhrases = normalized.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const phraseTokens = chinesePhrases.flatMap((phrase) => {
    const tokens: string[] = [phrase];
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= phrase.length - size; index += 1) {
        tokens.push(phrase.slice(index, index + size));
      }
    }
    return tokens;
  });
  return unique([...asciiWords, ...phraseTokens])
    .filter((token) => token.length >= 2)
    .filter((token) => !["一家", "设计", "风格", "适合", "客户", "需求", "真实", "高级", "干净"].includes(token))
    .slice(0, 80);
}

function basenameFromLibraryPath(value?: string): string | undefined {
  if (!value) return undefined;
  return path.basename(value);
}

export function promptLibraryImageUrl(localImagePath?: string): string | undefined {
  const filename = basenameFromLibraryPath(localImagePath);
  return filename ? `/api/prompt-library/images/${encodeURIComponent(filename)}` : undefined;
}

export async function loadPromptLibraryItems(): Promise<PromptLibraryItem[]> {
  if (cachedItems) return cachedItems;
  try {
    const raw = await fs.readFile(config.promptLibrary.dataPath, "utf8");
    const parsed = JSON.parse(raw) as PromptLibraryData;
    cachedItems = (parsed.items || [])
      .filter((item) => item.index && item.title && item.category && item.promptText)
      .map((item) => ({
        index: item.index,
        title: item.title,
        category: item.category,
        promptText: item.promptText,
        promptTextPath: item.promptTextPath,
        localImagePath: item.localImagePath,
        sourceLabel: item.sourceLabel
      }));
    return cachedItems;
  } catch {
    cachedItems = [];
    return cachedItems;
  }
}

function sanitizeReferenceText(promptText: string, customerText: string): string {
  const compact = promptText.replace(/\s+/g, " ").trim();
  return compact
    .replace(/[“"']([^”"']{2,60})[”"']/g, (match, inner: string) => {
      return customerText.includes(inner) ? match : "指定客户文案";
    })
    .slice(0, 900);
}

function scoreItem(item: PromptLibraryItem, input: PromptLibraryInput, categories: string[], tags: string[], keywords: string[]): number {
  const inputText = combinedInput(input);
  const normalizedInput = normalizeText(inputText);
  const haystack = normalizeText([item.title, item.category, item.promptText].join(" "));
  let score = 0;

  if (input.businessType && item.category === input.businessType.trim()) score += 160;
  if (categories.includes(item.category)) score += 120;
  if (normalizedInput.includes(normalizeText(item.title))) score += 80;

  for (const [category, aliases] of Object.entries(categoryAliases)) {
    if (category !== item.category) continue;
    const matchedAliases = aliases.filter((alias) => normalizedInput.includes(alias.toLowerCase()));
    score += Math.min(matchedAliases.length * 18, 72);
  }

  for (const tag of tags) {
    const aliases = businessAliases[tag] || [];
    const matchedInItem = aliases.filter((alias) => haystack.includes(alias.toLowerCase()));
    score += Math.min(matchedInItem.length * 22, 88);
  }

  for (const keyword of keywords) {
    if (haystack.includes(keyword)) {
      score += keyword.length >= 4 ? 10 : 4;
    }
  }

  if (item.title.includes("门头") && categories.includes("门头招牌")) score += 25;
  if (item.title.includes("海报") && (categories.includes("海报") || categories.includes("餐饮海报"))) score += 25;
  if (item.title.toLowerCase().includes("logo") && categories.includes("LOGO")) score += 25;

  return score;
}

export async function matchPromptLibrary(input: PromptLibraryInput, limit = 3): Promise<PromptLibraryMatch[]> {
  const items = await loadPromptLibraryItems();
  if (!items.length) return [];

  const inputText = combinedInput(input);
  const categories = inferCategories(inputText);
  const tags = inferBusinessTags(inputText);
  const keywords = extractKeywords(inputText);

  return items
    .map((item) => ({
      ...item,
      id: promptId(item.index),
      score: scoreItem(item, input, categories, tags, keywords),
      imageUrl: promptLibraryImageUrl(item.localImagePath),
      sanitizedPromptText: sanitizeReferenceText(item.promptText, input.customerText)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit);
}

export function toMatchedPromptSummary(match: PromptLibraryMatch): MatchedPromptSummary {
  return {
    id: match.id,
    index: match.index,
    title: match.title,
    category: match.category,
    promptText: match.sanitizedPromptText,
    imageUrl: match.imageUrl,
    score: match.score
  };
}

export async function resolvePromptLibraryImage(filename: string): Promise<string | null> {
  const safeFilename = path.basename(filename);
  if (!safeFilename || safeFilename !== filename) return null;
  if (!/\.(jpe?g|png|webp)$/i.test(safeFilename)) return null;

  const imagePath = path.join(config.promptLibrary.imagesDir, safeFilename);
  const relative = path.relative(config.promptLibrary.imagesDir, imagePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;

  try {
    const stat = await fs.stat(imagePath);
    return stat.isFile() ? imagePath : null;
  } catch {
    return null;
  }
}

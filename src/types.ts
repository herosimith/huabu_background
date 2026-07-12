export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type JobType = "original" | "composed";
export type AssetType = "upload" | "original" | "composed" | "vector" | "corrected";
export type PromptSource = "template" | "openai-chat" | "anthropic";
export type TextValidationStatus = "pending" | "passed" | "needs_review" | "unavailable";

export interface TextPoint {
  x: number;
  y: number;
}

export interface OcrRegion {
  id: string;
  text: string;
  confidence: number;
  polygon: TextPoint[];
}

export interface TextValidationCheck {
  expectedText: string;
  detectedText?: string;
  confidence?: number;
  regionId?: string;
  matched: boolean;
}

export interface TextValidationRecord {
  status: TextValidationStatus;
  expectedTexts: string[];
  regions: OcrRegion[];
  checks: TextValidationCheck[];
  sourceWidth?: number;
  sourceHeight?: number;
  scale?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TextCorrection {
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

export interface MatchedPromptSummary {
  id: string;
  index: number;
  title: string;
  category: string;
  promptText: string;
  imageUrl?: string;
  score?: number;
}

export interface PromptRecord {
  id: string;
  customerText: string;
  businessType: string;
  material?: string;
  style?: string;
  brief: string;
  imagePrompt: string;
  negativePrompt: string;
  requiredVisibleTexts: string[];
  source: PromptSource;
  matchedPromptIds?: string[];
  matchedPrompts?: MatchedPromptSummary[];
  createdAt: string;
}

export interface AssetRecord {
  id: string;
  type: AssetType;
  filename: string;
  mimeType: string;
  path: string;
  url: string;
  size: number;
  jobId?: string;
  promptId?: string;
  createdAt: string;
}

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  promptId?: string;
  prompt: string;
  negativePrompt?: string;
  size: string;
  quality: string;
  model: string;
  inputAssetIds: string[];
  requiredVisibleTexts?: string[];
  textValidation?: TextValidationRecord;
  textCorrections?: TextCorrection[];
  correctedAssets?: AssetRecord[];
  mock?: boolean;
  providerTaskId?: string;
  requestJson?: unknown;
  responseJson?: unknown;
  error?: string;
  assets: AssetRecord[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
}

export interface DatabaseShape {
  prompts: PromptRecord[];
  jobs: JobRecord[];
  assets: AssetRecord[];
}

export interface ImageProviderInput {
  type: JobType;
  prompt: string;
  size: string;
  quality: string;
  model: string;
  inputAssets: AssetRecord[];
  mock?: boolean;
}

export interface ImageProviderResult {
  image: {
    kind: "url" | "b64";
    value: string;
    mimeType?: string;
  };
  requestJson: unknown;
  responseJson: unknown;
  providerTaskId?: string;
}

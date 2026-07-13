export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type JobType = "original" | "composed";
export type AssetType = "upload" | "original" | "composed" | "vector" | "corrected";
export type PromptSource = "template" | "openai-chat" | "anthropic";
export type TextValidationStatus = "pending" | "passed" | "needs_review" | "unavailable";
export type UserRole = "admin" | "designer" | "reviewer";
export type UserStatus = "active" | "disabled";
export type CreditTransactionType = "initial" | "admin_adjust" | "generation" | "refund";
export type TopupIntentStatus = "pending" | "closed";

export interface CreditCosts {
  standardGeneration: number;
  highQualitySurcharge: number;
  highResolutionSurcharge: number;
}

export interface CreditRuleRecord {
  id: string;
  version: number;
  active: boolean;
  signupGrant: number;
  costs: CreditCosts;
  createdBy: string;
  createdAt: string;
}

export interface TopupIntentRecord {
  id: string;
  userId: string;
  requestedCredits: number;
  status: TopupIntentStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserRecord {
  id: string;
  nickname: string;
  email: string;
  phone?: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  creditBalance: number;
  generationCount: number;
  lastActiveAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreditTransactionRecord {
  id: string;
  userId: string;
  type: CreditTransactionType;
  amount: number;
  balanceAfter: number;
  reason: string;
  operatorId?: string;
  relatedJobId?: string;
  createdAt: string;
}

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
  userId?: string;
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
  userId?: string;
  createdAt: string;
}

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  promptId?: string;
  userId?: string;
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
  creditsConsumed?: number;
  creditRuleVersion?: number;
  creditsRefundedAt?: string;
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
  users: UserRecord[];
  creditTransactions: CreditTransactionRecord[];
  creditRules: CreditRuleRecord[];
  topupIntents: TopupIntentRecord[];
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

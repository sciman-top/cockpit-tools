export type CodexLocalAccessAddressKind = 'local' | 'lan';
export type CodexLocalAccessScope = 'localhost' | 'lan';
export type CodexLocalAccessImageGenerationMode =
  | 'enabled'
  | 'images_only'
  | 'disabled';
export type CodexLocalAccessRequestKind =
  | 'text'
  | 'image_generation'
  | 'image_edit'
  | 'other';
export type CodexLocalAccessImageGenerationStatus =
  | 'unknown'
  | 'available'
  | 'unavailable'
  | 'disabled';

export type CodexLocalAccessRoutingStrategy =
  | 'auto'
  | 'quota_high_first'
  | 'quota_low_first'
  | 'plan_high_first'
  | 'plan_low_first'
  | 'expiry_soon_first'
  | 'custom';

export interface CodexLocalAccessCustomRoutingRule {
  accountId: string;
  priority: number;
  weight: number;
}

export type CodexRuntimeIntegrationMode =
  | 'direct_projection'
  | 'cockpit_api_service';

export type CodexRuntimeAccountKind = 'oauth' | 'api' | 'unknown';
export type CodexLocalApiFallbackMode = 'disabled' | 'next_request_only' | 'unknown';
export type CodexLocalApiSafetyPresetId =
  | 'maximum_safety'
  | 'balanced_self_use'
  | 'quota_drain_careful';

export interface CodexRuntimeModeState {
  mode: CodexRuntimeIntegrationMode;
  accountKind: CodexRuntimeAccountKind;
  currentAccountId?: string | null;
  updatedAt: number;
}

export interface CodexLocalApiLoggingConfig {
  redactSensitiveValues: boolean;
  includeRequestId: boolean;
  includeAccountHash: boolean;
  includeRoute: boolean;
  includeModel: boolean;
  includeLatency: boolean;
  includePromptResponse: boolean;
  includeRawUpstreamBody: boolean;
}

export interface CodexLocalApiSafetyConfig {
  schemaVersion: number;
  hardenedLocalMode: boolean;
  maxConcurrentRequests: number;
  minRequestIntervalSeconds: number;
  maxQueueWaitSeconds: number;
  requestTimeoutSeconds: number;
  maxRequestBodyMb: number;
  maxRetries: number;
  maxRetryAccounts: number;
  fallbackMode: CodexLocalApiFallbackMode;
  logging: CodexLocalApiLoggingConfig;
}

export interface CodexLocalAccessModelAlias {
  sourceModel: string;
  alias: string;
  fork: boolean;
}

export interface CodexLocalAccessApiKey {
  id: string;
  label: string;
  key: string;
  modelPrefix?: string | null;
  allowedModels: string[];
  excludedModels: string[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number | null;
}

export interface CodexLocalAccessCollection {
  enabled: boolean;
  port: number;
  apiKey: string;
  safetyConfig: CodexLocalApiSafetyConfig;
  apiKeys: CodexLocalAccessApiKey[];
  accessScope: CodexLocalAccessScope;
  imageGenerationMode: CodexLocalAccessImageGenerationMode;
  upstreamProxyUrl?: string | null;
  routingStrategy: CodexLocalAccessRoutingStrategy;
  customRoutingRules: CodexLocalAccessCustomRoutingRule[];
  modelAliases: CodexLocalAccessModelAlias[];
  excludedModels: string[];
  sessionAffinity: boolean;
  sessionAffinityTtlMs: number;
  maxRetryCredentials: number;
  maxRetryIntervalMs: number;
  disableCooling: boolean;
  restrictFreeAccounts: boolean;
  followCurrentAccount: boolean;
  boundOauthAccountId?: string | null;
  accountIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CodexLocalAccessUsageStats {
  requestCount: number;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  textRequestCount: number;
  imageRequestCount: number;
  imageGenerationRequestCount: number;
  imageEditRequestCount: number;
  imageGenerationCapabilityFailureCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
}

export interface CodexLocalAccessAccountStats {
  accountId: string;
  email: string;
  usage: CodexLocalAccessUsageStats;
  updatedAt: number;
}

export interface CodexLocalAccessModelStats {
  modelId: string;
  usage: CodexLocalAccessUsageStats;
  updatedAt: number;
}

export interface CodexLocalAccessApiKeyStats {
  apiKeyId: string;
  label: string;
  usage: CodexLocalAccessUsageStats;
  updatedAt: number;
}

export interface CodexLocalAccessStatsWindow {
  since: number;
  updatedAt: number;
  totals: CodexLocalAccessUsageStats;
  accounts: CodexLocalAccessAccountStats[];
  models: CodexLocalAccessModelStats[];
  apiKeys: CodexLocalAccessApiKeyStats[];
}

export interface CodexLocalAccessUsageEvent {
  timestamp: number;
  accountId: string;
  email: string;
  apiKeyId: string;
  apiKeyLabel: string;
  modelId: string;
  requestKind: CodexLocalAccessRequestKind;
  success: boolean;
  errorCategory: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
}

export interface CodexLocalAccessStats {
  since: number;
  updatedAt: number;
  totals: CodexLocalAccessUsageStats;
  accounts: CodexLocalAccessAccountStats[];
  models: CodexLocalAccessModelStats[];
  apiKeys: CodexLocalAccessApiKeyStats[];
  daily: CodexLocalAccessStatsWindow;
  weekly: CodexLocalAccessStatsWindow;
  monthly: CodexLocalAccessStatsWindow;
  events: CodexLocalAccessUsageEvent[];
}

export interface CodexLocalAccessUsageEventPage {
  events: CodexLocalAccessUsageEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CodexLocalAccessRequestLogQuery {
  page: number;
  pageSize: number;
  statsRange?: 'daily' | 'weekly' | 'monthly' | null;
  modelQuery?: string | null;
  accountQuery?: string | null;
  apiKeyQuery?: string | null;
  requestKind?: CodexLocalAccessRequestKind | null;
  success?: boolean | null;
  errorCategory?: string | null;
}

export interface CodexLocalAccessAccountCooldown {
  modelId: string;
  nextRetryAt: number;
  remainingMs: number;
  reason: string;
}

export interface CodexLocalAccessAccountHealth {
  accountId: string;
  email: string;
  available: boolean;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureStatus: number | null;
  lastFailureCategory: string | null;
  lastFailureMessage: string | null;
  imageGenerationStatus: CodexLocalAccessImageGenerationStatus;
  imageGenerationCheckedAt: number | null;
  cooldowns: CodexLocalAccessAccountCooldown[];
}

export type CodexLocalAccessAccountHealthStatus =
  | 'healthy'
  | 'estimated_available'
  | 'cooling_down'
  | 'exhausted'
  | 'auth_suspect'
  | 'manual_required'
  | 'disabled';

export interface CodexLocalAccessAccountHealthView {
  accountId: string;
  status: CodexLocalAccessAccountHealthStatus;
  manualRequired: boolean;
  cooldownUntilMs: number | null;
  exhaustedAtMs: number | null;
  estimatedResetAtMs: number | null;
  lastStatus: number | null;
  lastErrorType: string | null;
  lastProviderCode: string | null;
  updatedAt: number;
  activeModelCooldownCount: number;
  nearestModelCooldownUntilMs: number | null;
}

export interface CodexLocalAccessHealthSummary {
  schemaVersion: number;
  updatedAt: number;
  unavailable: boolean;
  loadError: string | null;
  accounts?: CodexLocalAccessAccountHealthView[];
  healthyCount: number;
  estimatedAvailableCount: number;
  coolingCount: number;
  exhaustedCount: number;
  authSuspectCount: number;
  manualRequiredCount: number;
  disabledCount: number;
  activeModelCooldownCount: number;
  stickyAccountHash: string | null;
  stickyReason: string | null;
  stickyExpiresAtMs: number | null;
  nearestCooldownUntilMs: number | null;
  lastErrorType: string | null;
  lastStatus: number | null;
  lastRequestId: string | null;
  auditDegraded: boolean;
  auditError: string | null;
  auditDegradedAtMs: number | null;
}

export interface CodexLocalAccessConcurrencyDiagnostics {
  updatedAt: number;
  maxConcurrentRequests: number;
  activeRequestCount: number;
  activeStreamCount: number;
  requestCapacity: number;
  minRequestIntervalSeconds: number;
  maxQueueWaitSeconds: number;
  startIntervalRemainingMs: number;
  auditWindowMs: number;
  recentAuditEventCount: number;
  recentRequestCount: number;
  recentLocalBackpressureCount: number;
  recentPoolWaitCount: number;
  recentUpstreamLimitCount: number;
  recentStreamErrorCount: number;
  lastProblemAtMs: number | null;
  lastProblemKind: string | null;
  auditLoadError: string | null;
}

export interface CodexLocalAccessState {
  collection: CodexLocalAccessCollection | null;
  running: boolean;
  apiPortUrl: string | null;
  baseUrl: string | null;
  lanBaseUrl: string | null;
  modelIds: string[];
  lastError: string | null;
  memberCount: number;
  effectiveAccountIds: string[];
  stats: CodexLocalAccessStats;
  health: CodexLocalAccessHealthSummary;
  concurrencyDiagnostics: CodexLocalAccessConcurrencyDiagnostics;
  accountHealth: CodexLocalAccessAccountHealth[];
}

export interface CodexLocalAccessTestResult {
  modelId: string | null;
  latencyMs: number | null;
  output: string | null;
  failure: CodexLocalAccessTestFailure | null;
}

export interface CodexLocalAccessTestFailure {
  title: string;
  stage: string;
  cause: string;
  suggestion: string;
  status: number | null;
  modelId: string | null;
  detail: string | null;
  cliOutput: string | null;
  gatewayOutput: string | null;
}

export interface CodexLocalAccessPortCleanupResult {
  killedCount: number;
  state: CodexLocalAccessState;
}

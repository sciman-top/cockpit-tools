import type { CodexAccount } from "../types/codex";
import {
  getCodexEffectiveQuotaPercentages,
  getCodexPlanFilterKey,
  isCodexApiKeyAccount,
  isCodexNewApiAccount,
  isCodexQuotaCooldownError,
  isCodexQuotaLimitError,
} from "../types/codex";

export const CODEX_RECOMMENDED_SORT_BY = "recommended";

export type CodexNumericSortDirection = "asc" | "desc";

export type CodexGroupSortMeta = {
  sortOrder: number;
};

type CodexQuotaAvailabilityRank = {
  bottleneck: number;
  total: number;
  hourly: number | null;
  weekly: number | null;
};

type CodexQuotaMetric = "weekly" | "hourly";
type CodexQuotaResetMetric = "weekly_reset" | "hourly_reset";

type CodexAccountSortCacheEntry = {
  quotaAvailabilityRankResolved?: boolean;
  quotaAvailabilityRank?: CodexQuotaAvailabilityRank | null;
  quotaSortValues: Partial<Record<CodexQuotaMetric, number | null>>;
  quotaResetSortValues: Partial<Record<CodexQuotaResetMetric, number | null>>;
  earliestQuotaResetSortValueResolved?: boolean;
  earliestQuotaResetSortValue?: number | null;
  earliestQuotaResetMsResolved?: boolean;
  earliestQuotaResetMs?: number | null;
  planKey?: string;
  subscriptionTimestampMsResolved?: boolean;
  subscriptionTimestampMs?: number | null;
};

type CodexAccountSortCache = WeakMap<CodexAccount, CodexAccountSortCacheEntry>;

export interface CodexAccountSortOptions {
  sortBy: string;
  sortDirection: CodexNumericSortDirection;
  apiServiceSortMeta?: Map<string, number>;
  apiServiceHealthSortMeta?: Map<string, number>;
  groupSortMeta?: Map<string, CodexGroupSortMeta>;
  currentAccountId?: string | null;
  getSubscriptionTimestampMs?: (account: CodexAccount) => number | null | undefined;
}

export interface CodexLocalAccessRefreshSortOptions {
  nowMs?: number;
}

function createCodexAccountSortCache(): CodexAccountSortCache {
  return new WeakMap<CodexAccount, CodexAccountSortCacheEntry>();
}

function getCodexAccountSortCacheEntry(
  cache: CodexAccountSortCache,
  account: CodexAccount,
): CodexAccountSortCacheEntry {
  const current = cache.get(account);
  if (current) return current;

  const next: CodexAccountSortCacheEntry = {
    quotaResetSortValues: {},
    quotaSortValues: {},
  };
  cache.set(account, next);
  return next;
}

export function buildCodexAccountIdSortMeta(
  accountIds: readonly string[] | null | undefined,
  options: { allowedAccountIds?: ReadonlySet<string> | null } = {},
): Map<string, number> {
  const map = new Map<string, number>();
  const allowedAccountIds = options.allowedAccountIds ?? null;
  for (const accountId of accountIds ?? []) {
    if (!accountId || map.has(accountId)) continue;
    if (allowedAccountIds && !allowedAccountIds.has(accountId)) continue;
    map.set(accountId, map.size);
  }
  return map;
}

function toNullableSortNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNullablePositiveSortNumber(
  value: number | null | undefined,
): number | null {
  const normalized = toNullableSortNumber(value);
  return normalized != null && normalized > 0 ? normalized : null;
}

export function compareNullableSortNumber(
  left: number | null | undefined,
  right: number | null | undefined,
  direction: CodexNumericSortDirection,
): number {
  const leftValue = toNullableSortNumber(left);
  const rightValue = toNullableSortNumber(right);
  if (leftValue == null && rightValue == null) return 0;
  if (leftValue == null) return 1;
  if (rightValue == null) return -1;
  const diff =
    direction === "desc" ? rightValue - leftValue : leftValue - rightValue;
  return diff === 0 ? 0 : diff;
}

export function compareCodexCurrentAccountFirst(
  left: CodexAccount,
  right: CodexAccount,
  currentAccountId: string | null | undefined,
): number {
  const normalizedCurrentId = currentAccountId?.trim();
  if (!normalizedCurrentId) return 0;

  const leftIsCurrent = left.id === normalizedCurrentId;
  const rightIsCurrent = right.id === normalizedCurrentId;
  if (leftIsCurrent === rightIsCurrent) return 0;
  return leftIsCurrent ? -1 : 1;
}

export function compareCodexAccountTieBreak(
  left: CodexAccount,
  right: CodexAccount,
  direction: CodexNumericSortDirection = "desc",
): number {
  const createdDiff =
    direction === "desc"
      ? right.created_at - left.created_at
      : left.created_at - right.created_at;
  if (createdDiff !== 0) return createdDiff;
  return direction === "desc"
    ? right.id.localeCompare(left.id)
    : left.id.localeCompare(right.id);
}

function compareCodexAccountCreatedAt(
  left: CodexAccount,
  right: CodexAccount,
  direction: CodexNumericSortDirection,
): number {
  const diff =
    direction === "desc"
      ? right.created_at - left.created_at
      : left.created_at - right.created_at;
  return diff !== 0 ? diff : left.id.localeCompare(right.id);
}

function computeCodexQuotaAvailabilityRank(
  account: CodexAccount,
): CodexQuotaAvailabilityRank | null {
  if (isCodexApiKeyAccount(account) && !isCodexNewApiAccount(account)) {
    return null;
  }

  const percentages = getCodexEffectiveQuotaPercentages(account.quota);
  const values = [percentages.hourly, percentages.weekly].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (values.length === 0) return null;

  return {
    bottleneck: Math.min(...values),
    total: values.reduce((sum, value) => sum + value, 0),
    hourly: percentages.hourly,
    weekly: percentages.weekly,
  };
}

function getCodexQuotaAvailabilityRank(
  account: CodexAccount,
  cache?: CodexAccountSortCache,
): CodexQuotaAvailabilityRank | null {
  if (!cache) return computeCodexQuotaAvailabilityRank(account);

  const entry = getCodexAccountSortCacheEntry(cache, account);
  if (!entry.quotaAvailabilityRankResolved) {
    entry.quotaAvailabilityRank = computeCodexQuotaAvailabilityRank(account);
    entry.quotaAvailabilityRankResolved = true;
  }
  return entry.quotaAvailabilityRank ?? null;
}

function getCodexPlanKey(
  account: CodexAccount,
  cache?: CodexAccountSortCache,
): string {
  if (!cache) return getCodexPlanFilterKey(account);

  const entry = getCodexAccountSortCacheEntry(cache, account);
  if (entry.planKey == null) {
    entry.planKey = getCodexPlanFilterKey(account);
  }
  return entry.planKey;
}

export function getCodexAccountQuotaAvailabilityScore(
  account: CodexAccount,
): number | null {
  return getCodexAccountQuotaAvailabilityScoreCached(account);
}

function getCodexAccountQuotaAvailabilityScoreCached(
  account: CodexAccount,
  cache?: CodexAccountSortCache,
): number | null {
  return getCodexQuotaAvailabilityRank(account, cache)?.bottleneck ?? null;
}

function compareCodexAccountsByQuotaAvailabilityCached(
  left: CodexAccount,
  right: CodexAccount,
  direction: CodexNumericSortDirection = "desc",
  cache?: CodexAccountSortCache,
): number {
  const leftRank = getCodexQuotaAvailabilityRank(left, cache);
  const rightRank = getCodexQuotaAvailabilityRank(right, cache);
  if (!leftRank && !rightRank) return 0;
  if (!leftRank) return 1;
  if (!rightRank) return -1;

  const bottleneckDiff = compareNullableSortNumber(
    leftRank.bottleneck,
    rightRank.bottleneck,
    direction,
  );
  if (bottleneckDiff !== 0) return bottleneckDiff;

  const totalDiff = compareNullableSortNumber(
    leftRank.total,
    rightRank.total,
    direction,
  );
  if (totalDiff !== 0) return totalDiff;

  const weeklyDiff = compareNullableSortNumber(
    leftRank.weekly,
    rightRank.weekly,
    direction,
  );
  if (weeklyDiff !== 0) return weeklyDiff;

  return compareNullableSortNumber(leftRank.hourly, rightRank.hourly, direction);
}

export function compareCodexAccountsByQuotaAvailability(
  left: CodexAccount,
  right: CodexAccount,
  direction: CodexNumericSortDirection = "desc",
): number {
  return compareCodexAccountsByQuotaAvailabilityCached(left, right, direction);
}

function getCodexAccountRecommendedSortBucket(
  account: CodexAccount,
  apiServiceSortMeta: Map<string, number>,
  groupSortMeta: Map<string, CodexGroupSortMeta>,
  currentAccountId: string | null | undefined,
  cache?: CodexAccountSortCache,
): number {
  if (apiServiceSortMeta.has(account.id) || isCodexNewApiAccount(account)) {
    return 0;
  }
  if (groupSortMeta.has(account.id)) return 1;
  if (currentAccountId === account.id) return 2;
  if (isCodexApiKeyAccount(account)) return 3;

  const planKey = getCodexPlanKey(account, cache).toLowerCase();
  const hasUsableQuota =
    (getCodexAccountQuotaAvailabilityScoreCached(account, cache) ?? 0) > 0;
  if ((planKey === "pro" || planKey === "plus") && hasUsableQuota) {
    return 4;
  }
  if (planKey === "free") return 5;
  return 6;
}

function compareCodexAccountTopSortPriority(
  left: CodexAccount,
  right: CodexAccount,
  apiServiceSortMeta: Map<string, number>,
  groupSortMeta: Map<string, CodexGroupSortMeta>,
  currentAccountId: string | null | undefined,
  cache?: CodexAccountSortCache,
): number {
  const leftBucket = getCodexAccountRecommendedSortBucket(
    left,
    apiServiceSortMeta,
    groupSortMeta,
    currentAccountId,
    cache,
  );
  const rightBucket = getCodexAccountRecommendedSortBucket(
    right,
    apiServiceSortMeta,
    groupSortMeta,
    currentAccountId,
    cache,
  );
  const leftTopBucket = leftBucket <= 2 ? leftBucket : 3;
  const rightTopBucket = rightBucket <= 2 ? rightBucket : 3;
  if (leftTopBucket !== rightTopBucket) {
    return leftTopBucket - rightTopBucket;
  }
  if (leftTopBucket <= 2) {
    return compareCodexCurrentAccountFirst(left, right, currentAccountId);
  }
  return 0;
}

function compareCodexRecommendedFreeAccounts(
  left: CodexAccount,
  right: CodexAccount,
  cache?: CodexAccountSortCache,
): number {
  const quotaDiff = compareCodexAccountsByQuotaAvailabilityCached(
    left,
    right,
    "desc",
    cache,
  );
  if (quotaDiff !== 0) return quotaDiff;

  const resetDiff = compareNullableSortNumber(
    getCodexQuotaResetSortValue(left, "weekly_reset", cache),
    getCodexQuotaResetSortValue(right, "weekly_reset", cache),
    "asc",
  );
  return resetDiff !== 0 ? resetDiff : compareCodexAccountTieBreak(left, right);
}

function compareCodexRecommendedGroupedAccounts(
  left: CodexAccount,
  right: CodexAccount,
  groupSortMeta: Map<string, CodexGroupSortMeta>,
  cache?: CodexAccountSortCache,
): number {
  const quotaDiff = compareCodexAccountsByQuotaAvailabilityCached(
    left,
    right,
    "desc",
    cache,
  );
  if (quotaDiff !== 0) return quotaDiff;

  const resetDiff = compareNullableSortNumber(
    getCodexEarliestQuotaResetSortValue(left, cache),
    getCodexEarliestQuotaResetSortValue(right, cache),
    "asc",
  );
  if (resetDiff !== 0) return resetDiff;

  const leftMeta = groupSortMeta.get(left.id);
  const rightMeta = groupSortMeta.get(right.id);
  const sortOrderDiff =
    (leftMeta?.sortOrder ?? Number.MAX_SAFE_INTEGER) -
    (rightMeta?.sortOrder ?? Number.MAX_SAFE_INTEGER);
  if (sortOrderDiff !== 0) return sortOrderDiff;

  return compareCodexAccountTieBreak(left, right);
}

function compareCodexAccountsByOptionalSortMeta(
  left: CodexAccount,
  right: CodexAccount,
  sortMeta?: Map<string, number>,
): number {
  if (!sortMeta || sortMeta.size === 0) return 0;
  const leftIndex = sortMeta.get(left.id);
  const rightIndex = sortMeta.get(right.id);
  if (leftIndex == null && rightIndex == null) return 0;
  if (leftIndex == null) return 1;
  if (rightIndex == null) return -1;
  return leftIndex - rightIndex;
}

function compareCodexRecommendedApiServiceAccounts(
  left: CodexAccount,
  right: CodexAccount,
  apiServiceHealthSortMeta?: Map<string, number>,
  cache?: CodexAccountSortCache,
): number {
  const quotaDiff = compareCodexAccountsByQuotaAvailabilityCached(
    left,
    right,
    "desc",
    cache,
  );
  if (quotaDiff !== 0) return quotaDiff;

  const healthSortDiff = compareCodexAccountsByOptionalSortMeta(
    left,
    right,
    apiServiceHealthSortMeta,
  );
  if (healthSortDiff !== 0) return healthSortDiff;

  const resetDiff = compareNullableSortNumber(
    getCodexEarliestQuotaResetSortValue(left, cache),
    getCodexEarliestQuotaResetSortValue(right, cache),
    "asc",
  );
  if (resetDiff !== 0) return resetDiff;

  if (isCodexNewApiAccount(left) !== isCodexNewApiAccount(right)) {
    return isCodexNewApiAccount(left) ? -1 : 1;
  }

  return compareCodexAccountTieBreak(left, right);
}

function getCodexQuotaSortValue(
  account: CodexAccount,
  metric: CodexQuotaMetric,
  cache?: CodexAccountSortCache,
): number | null {
  if (cache) {
    const entry = getCodexAccountSortCacheEntry(cache, account);
    if (!(metric in entry.quotaSortValues)) {
      entry.quotaSortValues[metric] = getCodexQuotaSortValue(account, metric);
    }
    return entry.quotaSortValues[metric] ?? null;
  }

  if (isCodexApiKeyAccount(account) && !isCodexNewApiAccount(account)) {
    return null;
  }
  const percentages = getCodexEffectiveQuotaPercentages(account.quota);
  return metric === "weekly" ? percentages.weekly : percentages.hourly;
}

function getCodexQuotaResetSortValue(
  account: CodexAccount,
  metric: CodexQuotaResetMetric,
  cache?: CodexAccountSortCache,
): number | null {
  if (cache) {
    const entry = getCodexAccountSortCacheEntry(cache, account);
    if (!(metric in entry.quotaResetSortValues)) {
      entry.quotaResetSortValues[metric] = getCodexQuotaResetSortValue(
        account,
        metric,
      );
    }
    return entry.quotaResetSortValues[metric] ?? null;
  }

  return toNullablePositiveSortNumber(
    metric === "weekly_reset"
      ? account.quota?.weekly_reset_time
      : account.quota?.hourly_reset_time,
  );
}

function getCodexEarliestQuotaResetSortValue(
  account: CodexAccount,
  cache?: CodexAccountSortCache,
): number | null {
  if (cache) {
    const entry = getCodexAccountSortCacheEntry(cache, account);
    if (!entry.earliestQuotaResetSortValueResolved) {
      entry.earliestQuotaResetSortValue =
        getCodexEarliestQuotaResetSortValue(account);
      entry.earliestQuotaResetSortValueResolved = true;
    }
    return entry.earliestQuotaResetSortValue ?? null;
  }

  const values = [
    getCodexQuotaResetSortValue(account, "hourly_reset"),
    getCodexQuotaResetSortValue(account, "weekly_reset"),
  ].filter((value): value is number => value != null);
  if (values.length === 0) return null;
  return Math.min(...values);
}

function normalizeCodexQuotaResetTimestampMs(
  value: number | null | undefined,
): number | null {
  const normalized = toNullablePositiveSortNumber(value);
  if (normalized == null) return null;
  return normalized < 1_000_000_000_000 ? normalized * 1000 : normalized;
}

function getCodexEarliestQuotaResetMs(
  account: CodexAccount,
  cache?: CodexAccountSortCache,
): number | null {
  if (cache) {
    const entry = getCodexAccountSortCacheEntry(cache, account);
    if (!entry.earliestQuotaResetMsResolved) {
      entry.earliestQuotaResetMs = getCodexEarliestQuotaResetMs(account);
      entry.earliestQuotaResetMsResolved = true;
    }
    return entry.earliestQuotaResetMs ?? null;
  }

  const values = [
    normalizeCodexQuotaResetTimestampMs(account.quota?.hourly_reset_time),
    normalizeCodexQuotaResetTimestampMs(account.quota?.weekly_reset_time),
  ].filter((value): value is number => value != null);
  if (values.length === 0) return null;
  return Math.min(...values);
}

function getCodexLocalAccessRefreshPriorityBucket(
  account: CodexAccount,
  nowMs: number,
  cache?: CodexAccountSortCache,
): number {
  if (isCodexApiKeyAccount(account)) return 99;
  if (
    account.quota_error &&
    !isCodexQuotaLimitError(account.quota_error) &&
    !isCodexQuotaCooldownError(account.quota_error)
  ) {
    return 0;
  }
  if (!account.quota) return 1;

  const resetAtMs = getCodexEarliestQuotaResetMs(account, cache);
  if (resetAtMs != null && resetAtMs <= nowMs) return 2;

  const quotaScore = getCodexAccountQuotaAvailabilityScoreCached(account, cache);
  if (quotaScore === 0) return 3;
  if (quotaScore != null && quotaScore <= 10) return 4;
  return 5;
}

function compareCodexAccountsByLocalAccessRefreshPriorityCached(
  left: CodexAccount,
  right: CodexAccount,
  options: CodexLocalAccessRefreshSortOptions = {},
  cache?: CodexAccountSortCache,
): number {
  const nowMs = options.nowMs ?? Date.now();
  const leftBucket = getCodexLocalAccessRefreshPriorityBucket(
    left,
    nowMs,
    cache,
  );
  const rightBucket = getCodexLocalAccessRefreshPriorityBucket(
    right,
    nowMs,
    cache,
  );
  if (leftBucket !== rightBucket) return leftBucket - rightBucket;

  const resetDiff = compareNullableSortNumber(
    getCodexEarliestQuotaResetMs(left, cache),
    getCodexEarliestQuotaResetMs(right, cache),
    "asc",
  );
  if (resetDiff !== 0) return resetDiff;

  const quotaDiff = compareNullableSortNumber(
    getCodexAccountQuotaAvailabilityScoreCached(left, cache),
    getCodexAccountQuotaAvailabilityScoreCached(right, cache),
    "asc",
  );
  if (quotaDiff !== 0) return quotaDiff;

  const errorTimestampDiff = compareNullableSortNumber(
    left.quota_error?.timestamp,
    right.quota_error?.timestamp,
    "asc",
  );
  if (errorTimestampDiff !== 0) return errorTimestampDiff;

  return compareCodexAccountTieBreak(left, right);
}

export function compareCodexAccountsByLocalAccessRefreshPriority(
  left: CodexAccount,
  right: CodexAccount,
  options: CodexLocalAccessRefreshSortOptions = {},
): number {
  return compareCodexAccountsByLocalAccessRefreshPriorityCached(
    left,
    right,
    options,
  );
}

function compareCodexAccountsByLocalAccessEvidence(
  left: CodexAccount,
  right: CodexAccount,
  cache?: CodexAccountSortCache,
): number {
  const quotaDiff = compareCodexAccountsByQuotaAvailabilityCached(
    left,
    right,
    "desc",
    cache,
  );
  if (quotaDiff !== 0) return quotaDiff;

  const resetDiff = compareNullableSortNumber(
    getCodexEarliestQuotaResetSortValue(left, cache),
    getCodexEarliestQuotaResetSortValue(right, cache),
    "asc",
  );
  if (resetDiff !== 0) return resetDiff;

  if (isCodexApiKeyAccount(left) !== isCodexApiKeyAccount(right)) {
    return isCodexApiKeyAccount(left) ? 1 : -1;
  }

  return compareCodexAccountTieBreak(left, right);
}

function compareCodexAccountsByLocalAccessScheduleCached(
  left: CodexAccount,
  right: CodexAccount,
  currentAccountId: string | null | undefined,
  apiServiceHealthSortMeta?: Map<string, number>,
  cache?: CodexAccountSortCache,
): number {
  const currentDiff = compareCodexCurrentAccountFirst(left, right, currentAccountId);
  if (currentDiff !== 0) return currentDiff;

  const quotaDiff = compareCodexAccountsByQuotaAvailabilityCached(
    left,
    right,
    "desc",
    cache,
  );
  if (quotaDiff !== 0) return quotaDiff;

  const healthSortDiff = compareCodexAccountsByOptionalSortMeta(
    left,
    right,
    apiServiceHealthSortMeta,
  );
  if (healthSortDiff !== 0) return healthSortDiff;

  const resetDiff = compareNullableSortNumber(
    getCodexEarliestQuotaResetSortValue(left, cache),
    getCodexEarliestQuotaResetSortValue(right, cache),
    "asc",
  );
  if (resetDiff !== 0) return resetDiff;

  return compareCodexAccountTieBreak(left, right);
}

export function compareCodexAccountsByLocalAccessSchedule(
  left: CodexAccount,
  right: CodexAccount,
  currentAccountId: string | null | undefined,
  apiServiceHealthSortMeta?: Map<string, number>,
): number {
  return compareCodexAccountsByLocalAccessScheduleCached(
    left,
    right,
    currentAccountId,
    apiServiceHealthSortMeta,
  );
}

export function sortCodexLocalAccessAccountsForScheduling(
  accounts: CodexAccount[],
  currentAccountId: string | null | undefined,
  apiServiceHealthSortMeta?: Map<string, number>,
): CodexAccount[] {
  const cache = createCodexAccountSortCache();
  return [...accounts].sort((left, right) =>
    compareCodexAccountsByLocalAccessScheduleCached(
      left,
      right,
      currentAccountId,
      apiServiceHealthSortMeta,
      cache,
    ),
  );
}

export function sortCodexLocalAccessAccountIdsForScheduling(
  accountIds: string[],
  accounts: CodexAccount[],
  currentAccountId: string | null | undefined,
  apiServiceHealthSortMeta?: Map<string, number>,
): string[] {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const knownAccounts = accountIds
    .map((accountId) => accountById.get(accountId))
    .filter((account): account is CodexAccount => Boolean(account));
  const sortedKnownIds = sortCodexLocalAccessAccountsForScheduling(
    knownAccounts,
    currentAccountId,
    apiServiceHealthSortMeta,
  ).map((account) => account.id);
  const missingIds = accountIds
    .filter((accountId) => !accountById.has(accountId))
    .sort((left, right) => left.localeCompare(right));
  return [...sortedKnownIds, ...missingIds];
}

function isCodexLocalAccessCurrentAccountUnavailable(
  account: CodexAccount,
  cache?: CodexAccountSortCache,
): boolean {
  if (account.requires_reauth) return true;
  if (isCodexQuotaLimitError(account.quota_error)) return true;
  return getCodexAccountQuotaAvailabilityScoreCached(account, cache) === 0;
}

export function sortCodexLocalAccessAccountsForStableDisplay(
  accounts: CodexAccount[],
  currentAccountId: string | null | undefined,
): CodexAccount[] {
  const cache = createCodexAccountSortCache();
  const normalizedCurrentId = currentAccountId?.trim();
  if (!normalizedCurrentId) {
    return [...accounts].sort((left, right) =>
      compareCodexAccountsByLocalAccessEvidence(left, right, cache),
    );
  }

  const currentAccount = accounts.find(
    (account) => account.id === normalizedCurrentId,
  );
  if (!currentAccount) {
    return [...accounts].sort((left, right) =>
      compareCodexAccountsByLocalAccessEvidence(left, right, cache),
    );
  }

  const otherAccounts = accounts.filter(
    (account) => account.id !== normalizedCurrentId,
  ).sort((left, right) =>
    compareCodexAccountsByLocalAccessEvidence(left, right, cache),
  );
  if (isCodexLocalAccessCurrentAccountUnavailable(currentAccount, cache)) {
    return [...otherAccounts, currentAccount];
  }
  return [currentAccount, ...otherAccounts];
}

export function sortCodexLocalAccessAccountIdsForStableDisplay(
  accountIds: string[],
  accounts: CodexAccount[],
  currentAccountId: string | null | undefined,
  accountById: ReadonlyMap<string, CodexAccount> = new Map(
    accounts.map((account) => [account.id, account]),
  ),
): string[] {
  const knownAccounts = accountIds
    .map((accountId) => accountById.get(accountId))
    .filter((account): account is CodexAccount => Boolean(account));
  const knownIds = sortCodexLocalAccessAccountsForStableDisplay(
    knownAccounts,
    currentAccountId,
  ).map((account) => account.id);
  const missingIds = accountIds.filter((accountId) => !accountById.has(accountId));
  missingIds.sort((left, right) => left.localeCompare(right));
  return [...knownIds, ...missingIds];
}

export function sortCodexLocalAccessAccountsForRefresh(
  accounts: CodexAccount[],
  options: CodexLocalAccessRefreshSortOptions = {},
): CodexAccount[] {
  const cache = createCodexAccountSortCache();
  return [...accounts].sort((left, right) =>
    compareCodexAccountsByLocalAccessRefreshPriorityCached(
      left,
      right,
      options,
      cache,
    ),
  );
}

export function sortCodexLocalAccessAccountIdsForRefresh(
  accountIds: string[],
  accounts: CodexAccount[],
  nowMs: number = Date.now(),
  accountById: ReadonlyMap<string, CodexAccount> = new Map(
    accounts.map((account) => [account.id, account]),
  ),
): string[] {
  const knownAccounts = accountIds
    .map((accountId) => accountById.get(accountId))
    .filter((account): account is CodexAccount => Boolean(account));
  const sortedKnownIds = sortCodexLocalAccessAccountsForRefresh(knownAccounts, {
    nowMs,
  }).map((account) => account.id);
  const missingIds = accountIds
    .filter((accountId) => !accountById.has(accountId))
    .sort((left, right) => left.localeCompare(right));
  return [...sortedKnownIds, ...missingIds];
}

export function getCodexLocalAccessPrimaryRefreshAccountId(
  displayAccountIds: string[],
  accounts: CodexAccount[],
  accountById: ReadonlyMap<string, CodexAccount> = new Map(
    accounts.map((account) => [account.id, account]),
  ),
): string | null {
  for (const accountId of displayAccountIds) {
    const account = accountById.get(accountId);
    if (account && !isCodexApiKeyAccount(account)) {
      return account.id;
    }
  }
  return null;
}

function compareCodexAccountsByRecommendedSortCached(
  left: CodexAccount,
  right: CodexAccount,
  options: Pick<
    CodexAccountSortOptions,
    | "apiServiceSortMeta"
    | "apiServiceHealthSortMeta"
    | "groupSortMeta"
    | "currentAccountId"
  > = {},
  cache?: CodexAccountSortCache,
): number {
  const apiServiceSortMeta = options.apiServiceSortMeta ?? new Map<string, number>();
  const apiServiceHealthSortMeta = options.apiServiceHealthSortMeta;
  const groupSortMeta =
    options.groupSortMeta ?? new Map<string, CodexGroupSortMeta>();
  const currentAccountId = options.currentAccountId ?? null;
  const topPriority = compareCodexAccountTopSortPriority(
    left,
    right,
    apiServiceSortMeta,
    groupSortMeta,
    currentAccountId,
    cache,
  );
  if (topPriority !== 0) return topPriority;

  const leftBucket = getCodexAccountRecommendedSortBucket(
    left,
    apiServiceSortMeta,
    groupSortMeta,
    currentAccountId,
    cache,
  );
  const rightBucket = getCodexAccountRecommendedSortBucket(
    right,
    apiServiceSortMeta,
    groupSortMeta,
    currentAccountId,
    cache,
  );
  if (leftBucket !== rightBucket) {
    return leftBucket - rightBucket;
  }
  if (leftBucket === 0) {
    return compareCodexRecommendedApiServiceAccounts(
      left,
      right,
      apiServiceHealthSortMeta,
      cache,
    );
  }
  if (leftBucket === 1) {
    return compareCodexRecommendedGroupedAccounts(
      left,
      right,
      groupSortMeta,
      cache,
    );
  }
  if (leftBucket === 5) {
    return compareCodexRecommendedFreeAccounts(left, right, cache);
  }

  const quotaDiff = compareCodexAccountsByQuotaAvailabilityCached(
    left,
    right,
    "desc",
    cache,
  );
  return quotaDiff !== 0 ? quotaDiff : compareCodexAccountTieBreak(left, right);
}

export function compareCodexAccountsByRecommendedSort(
  left: CodexAccount,
  right: CodexAccount,
  options: Pick<
    CodexAccountSortOptions,
    | "apiServiceSortMeta"
    | "apiServiceHealthSortMeta"
    | "groupSortMeta"
    | "currentAccountId"
  > = {},
): number {
  return compareCodexAccountsByRecommendedSortCached(left, right, options);
}

function getSubscriptionTimestampMs(
  account: CodexAccount,
  options: CodexAccountSortOptions,
  cache?: CodexAccountSortCache,
): number | null {
  if (isCodexApiKeyAccount(account)) return null;
  if (!cache) {
    return toNullablePositiveSortNumber(options.getSubscriptionTimestampMs?.(account));
  }

  const entry = getCodexAccountSortCacheEntry(cache, account);
  if (!entry.subscriptionTimestampMsResolved) {
    entry.subscriptionTimestampMs = toNullablePositiveSortNumber(
      options.getSubscriptionTimestampMs?.(account),
    );
    entry.subscriptionTimestampMsResolved = true;
  }
  return entry.subscriptionTimestampMs ?? null;
}

function compareCodexAccountsBySortCached(
  left: CodexAccount,
  right: CodexAccount,
  options: CodexAccountSortOptions,
  cache?: CodexAccountSortCache,
): number {
  const apiServiceSortMeta = options.apiServiceSortMeta ?? new Map<string, number>();
  const apiServiceHealthSortMeta = options.apiServiceHealthSortMeta;
  const groupSortMeta =
    options.groupSortMeta ?? new Map<string, CodexGroupSortMeta>();
  const currentAccountId = options.currentAccountId ?? null;
  const { sortBy, sortDirection } = options;

  if (sortBy === CODEX_RECOMMENDED_SORT_BY) {
    return compareCodexAccountsByRecommendedSortCached(left, right, {
      apiServiceHealthSortMeta,
      apiServiceSortMeta,
      groupSortMeta,
      currentAccountId,
    }, cache);
  }

  const topPriority = compareCodexAccountTopSortPriority(
    left,
    right,
    apiServiceSortMeta,
    groupSortMeta,
    currentAccountId,
    cache,
  );
  if (topPriority !== 0) return topPriority;

  if (sortBy === "created_at") {
    return compareCodexAccountCreatedAt(left, right, sortDirection);
  }
  if (sortBy === "weekly_reset" || sortBy === "hourly_reset") {
    const diff = compareNullableSortNumber(
      getCodexQuotaResetSortValue(left, sortBy, cache),
      getCodexQuotaResetSortValue(right, sortBy, cache),
      sortDirection,
    );
    return diff !== 0
      ? diff
      : compareCodexAccountTieBreak(left, right, sortDirection);
  }
  if (sortBy === "subscription_expiry") {
    const diff = compareNullableSortNumber(
      getSubscriptionTimestampMs(left, options, cache),
      getSubscriptionTimestampMs(right, options, cache),
      sortDirection,
    );
    return diff !== 0
      ? diff
      : compareCodexAccountTieBreak(left, right, sortDirection);
  }
  if (sortBy === "weekly" || sortBy === "hourly") {
    const diff = compareNullableSortNumber(
      getCodexQuotaSortValue(left, sortBy, cache),
      getCodexQuotaSortValue(right, sortBy, cache),
      sortDirection,
    );
    return diff !== 0
      ? diff
      : compareCodexAccountTieBreak(left, right, sortDirection);
  }

  return compareCodexAccountCreatedAt(left, right, sortDirection);
}

export function compareCodexAccountsBySort(
  left: CodexAccount,
  right: CodexAccount,
  options: CodexAccountSortOptions,
): number {
  return compareCodexAccountsBySortCached(left, right, options);
}

export function createCodexAccountSortComparator(
  options: CodexAccountSortOptions,
): (left: CodexAccount, right: CodexAccount) => number {
  const cache = createCodexAccountSortCache();
  return (left, right) => compareCodexAccountsBySortCached(left, right, options, cache);
}

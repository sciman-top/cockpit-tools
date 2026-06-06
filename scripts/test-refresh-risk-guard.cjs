#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function fail(message) {
  throw new Error(message);
}

function assertContains(text, needle, message) {
  if (!text.includes(needle)) {
    fail(message);
  }
}

function assertNotContains(text, needle, message) {
  if (text.includes(needle)) {
    fail(message);
  }
}

function assertMatches(text, pattern, message) {
  if (!pattern.test(text)) {
    fail(message);
  }
}

function assertNotMatches(text, pattern, message) {
  if (pattern.test(text)) {
    fail(message);
  }
}

function extractRange(text, startNeedle, endNeedle, context) {
  const start = text.indexOf(startNeedle);
  if (start < 0) {
    fail(`${context}: missing start marker ${startNeedle}`);
  }
  const end = text.indexOf(endNeedle, start + startNeedle.length);
  if (end < 0) {
    fail(`${context}: missing end marker ${endNeedle}`);
  }
  return text.slice(start, end);
}

function parseCurrentAccountRefreshPresetMinutes(source) {
  const match = source.match(/CURRENT_ACCOUNT_REFRESH_PRESET_MINUTES\s*=\s*\[(?<values>[^\]]+)\]/);
  if (!match || !match.groups) {
    fail('current-account refresh presets must be declared as a shared constant');
  }

  return match.groups.values
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
}

const app = read('src/App.tsx');
const quickSettings = read('src/components/QuickSettingsPopover.tsx');
const settingsPage = read('src/pages/SettingsPage.tsx');
const currentAccountRefresh = read('src/utils/currentAccountRefresh.ts');
const codexCommands = read('src-tauri/src/commands/codex.rs');
const codexQuota = read('src-tauri/src/modules/codex_quota.rs');
const codexService = read('src/services/codexService.ts');
const codexAccountStore = read('src/stores/useCodexAccountStore.ts');
const codexAccountsPage = read('src/pages/CodexAccountsPage.tsx');
const codexApiServicePage = read('src/pages/CodexApiServicePage.tsx');
const codexLocalAccessModal = read('src/components/CodexLocalAccessModal.tsx');
const codexLocalAccessAccounts = read('src/utils/codexLocalAccessAccounts.ts');
const asyncConcurrency = read('src/utils/asyncConcurrency.ts');
const codexLocalAccessRust = read('src-tauri/src/modules/codex_local_access.rs');
const webReport = read('src-tauri/src/modules/web_report.rs');
const preflight = read('scripts/release/preflight.cjs');

const trayRefresh = extractRange(
  app,
  "listen('tray:refresh_quota'",
  '}).then((fn) => { unlisten = fn; });',
  'tray quota refresh listener',
);
assertContains(
  app,
  'const TRAY_QUOTA_REFRESH_STEP_DELAY_MS = 750;',
  'tray quota refresh must keep an explicit inter-provider delay',
);
assertContains(
  trayRefresh,
  'for (const { command, errorMessage } of refreshTasks)',
  'tray quota refresh must run providers sequentially',
);
assertContains(
  trayRefresh,
  'await sleep(TRAY_QUOTA_REFRESH_STEP_DELAY_MS);',
  'tray quota refresh must delay between provider refreshes',
);
assertNotMatches(
  trayRefresh,
  /Promise\.all\s*\(\s*refreshTasks\.map/s,
  'tray quota refresh must not fan out all provider refreshes with Promise.all',
);

assertContains(
  currentAccountRefresh,
  'export const MIN_CURRENT_ACCOUNT_REFRESH_MINUTES = 30;',
  'current-account refresh minimum must remain conservative',
);
const presets = parseCurrentAccountRefreshPresetMinutes(currentAccountRefresh);
if (presets.length === 0 || presets.some((value) => value < 30)) {
  fail(`current-account refresh presets must all be >= 30 minutes, got: ${presets.join(', ')}`);
}
assertContains(
  quickSettings,
  'const CURRENT_ACCOUNT_REFRESH_PRESETS = CURRENT_ACCOUNT_REFRESH_PRESET_MINUTES.map(String);',
  'quick settings must use the shared current-account refresh presets',
);
assertContains(
  settingsPage,
  'const CURRENT_ACCOUNT_REFRESH_PRESET_VALUES = CURRENT_ACCOUNT_REFRESH_PRESET_MINUTES.map(String);',
  'settings page must use the shared current-account refresh presets',
);
assertContains(
  quickSettings,
  'saveCurrentAccountRefresh(sanitizeCurrentAccountRefreshMinutes(parsed));',
  'quick settings must sanitize custom current-account refresh values before saving',
);
assertContains(
  settingsPage,
  'result[platform] = sanitizeCurrentAccountRefreshMinutes(raw);',
  'settings page must sanitize current-account refresh values before saving',
);
assertNotContains(
  quickSettings,
  "const CURRENT_ACCOUNT_REFRESH_PRESETS = ['1', '2', '5', '10', '15'];",
  'quick settings must not restore low-frequency current-account presets',
);
assertNotContains(
  settingsPage,
  "const CURRENT_ACCOUNT_REFRESH_PRESET_VALUES = ['1', '2', '5', '10', '15'];",
  'settings page must not restore low-frequency current-account presets',
);

const currentCodexRefresh = extractRange(
  codexCommands,
  'pub async fn refresh_current_codex_quota',
  'pub async fn refresh_all_codex_quotas',
  'current Codex quota refresh command',
);
assertContains(
  currentCodexRefresh,
  'codex_quota::RefreshQuotaOptions::default()',
  'current Codex quota refresh must default to non-forced live refresh',
);
assertNotContains(
  currentCodexRefresh,
  'force_live_refresh: true',
  'current Codex quota refresh must not force live refresh by default',
);
const allCodexRefresh = extractRange(
  codexQuota,
  'pub async fn refresh_all_quotas()',
  '#[cfg(test)]',
  'all Codex quota refresh path',
);
assertContains(
  allCodexRefresh,
  'RefreshQuotaOptions::default()',
  'all Codex quota refresh must default to non-forced live refresh',
);
assertNotContains(
  allCodexRefresh,
  'force_live_refresh: true',
  'all Codex quota refresh must not force live refresh by default',
);
assertContains(
  codexAccountStore,
  'hydrateProfiles?: boolean',
  'Codex account store must support skipping profile hydration after refresh',
);
assertContains(
  codexAccountStore,
  'fetchAccounts({ silent: true, hydrateProfiles: false })',
  'Codex account store must skip profile hydration in refresh snapshot syncs',
);
const codexStoreRefreshQuota = extractRange(
  codexAccountStore,
  'refreshQuota: async (accountId: string)',
  'refreshSubscriptionInfo: async (accountId: string)',
  'Codex account store refresh quota path',
);
assertContains(
  codexStoreRefreshQuota,
  'codexService.refreshCodexQuota(accountId)',
  'Codex account store refresh quota must use the default non-forced path',
);
assertNotContains(
  codexStoreRefreshQuota,
  'force: true',
  'Codex account store refresh quota must not force live refresh by default',
);
assertContains(
  codexAccountsPage,
  'reloadCodexAccountsAfterQuotaRefresh',
  'Codex quota refresh page flow must use the no-hydrate snapshot helper',
);
assertContains(
  codexAccountsPage,
  'fetchAccounts({ silent: true, hydrateProfiles: false })',
  'Codex quota refresh page flow must skip profile hydration after refresh',
);
assertNotContains(
  codexAccountsPage,
  'codexService.refreshCodexQuota(accountId, { force: true })',
  'Codex account page refresh actions must not force live refresh by default',
);
assertContains(
  codexApiServicePage,
  'fetchAccounts({ silent: true, hydrateProfiles: false })',
  'Codex API service refresh path must skip profile hydration after quota refresh',
);
assertContains(
  codexLocalAccessAccounts,
  'isCodexExplicitFreePlanType',
  'Codex local access account eligibility must keep free-plan restriction support',
);
assertNotContains(
  codexLocalAccessAccounts,
  'isCodexApiKeyAccount',
  'Codex local access account eligibility must not reject API key accounts; Rust sidecar supports API key pool members',
);
assertContains(
  codexApiServicePage,
  'filterCodexLocalAccessAccountIds(',
  'Codex API service member saves must use the shared local-access eligibility filter',
);
const codexAccountsLocalAccessSave = extractRange(
  codexAccountsPage,
  'const handleSaveLocalAccessAccounts = useCallback(',
  'const handleRemoveLocalAccessAccount = useCallback(',
  'Codex accounts page local access save path',
);
assertContains(
  codexAccountsLocalAccessSave,
  'filterCodexLocalAccessAccountIds(',
  'Codex accounts page API service member saves must use the shared local-access eligibility filter',
);
assertNotContains(
  codexAccountsLocalAccessSave,
  'isCodexApiKeyAccount(account)) return false',
  'Codex accounts page must not silently drop API key accounts from the API service pool',
);
assertNotContains(
  codexLocalAccessModal,
  'accounts.filter((account) => !isCodexApiKeyAccount(account))',
  'Codex local access modal must show API key accounts because backend sidecar can route them',
);
assertContains(
  asyncConcurrency,
  'export async function runSettledWithConcurrency',
  'shared async concurrency helper must be available for UI refresh fan-out guards',
);
assertContains(
  codexApiServicePage,
  'runSettledWithConcurrency(',
  'Codex API service refresh path must limit quota refresh concurrency',
);
assertContains(
  codexApiServicePage,
  'setLocalAccessEnabledWithContinuityRetry',
  'Codex API service enable/disable path must offer force retry after continuity protection blocks the first attempt',
);
assertContains(
  codexApiServicePage,
  'setCodexRuntimeModeWithContinuityRetry',
  'Codex API service runtime-mode path must offer force retry after continuity protection blocks the first attempt',
);
assertContains(
  codexApiServicePage,
  'isCodexContinuityProtectionError(error)',
  'Codex API service page must classify continuity protection errors before retrying',
);
assertContains(
  codexAccountsPage,
  'const localAccessStateRef = useRef<CodexLocalAccessState | null>(null);',
  'Codex accounts page must keep a stable local-access state ref for light-state polling',
);
assertContains(
  codexAccountsPage,
  'const localAccessLightRefreshInFlightRef = useRef(false);',
  'Codex accounts page must dedupe concurrent light-state polling requests',
);
const codexAccountsLightReload = extractRange(
  codexAccountsPage,
  'const reloadLocalAccessLightState = useCallback(',
  'const reloadCodexRuntimeMode = useCallback(',
  'Codex accounts page light-state reload path',
);
assertContains(
  codexAccountsLightReload,
  'if (localAccessLightRefreshInFlightRef.current)',
  'Codex accounts page light-state reload must short-circuit when a prior request is still running',
);
assertContains(
  codexAccountsLightReload,
  'localAccessLightRefreshInFlightRef.current = true',
  'Codex accounts page light-state reload must mark the in-flight guard before dispatching',
);
assertContains(
  codexAccountsLightReload,
  'localAccessLightRefreshInFlightRef.current = false',
  'Codex accounts page light-state reload must always clear the in-flight guard',
);
assertContains(
  codexAccountsLightReload,
  'if (!localAccessStateRef.current)',
  'Codex accounts page light-state reload must read the latest state from a ref instead of re-binding the callback on every poll result',
);
assertContains(
  codexAccountsPage,
  '}, [reloadLocalAccessState]);',
  'Codex accounts page light-state reload callback must not depend directly on localAccessState',
);
assertContains(
  codexLocalAccessRust,
  'schedule_runtime_projection_history_visibility_repair(',
  'Codex runtime projection must schedule history visibility repair instead of blocking UI actions',
);
assertContains(
  codexLocalAccessRust,
  'tokio::task::spawn_blocking',
  'Codex runtime projection history visibility repair must run off the UI command await chain',
);
assertNotContains(
  codexLocalAccessRust,
  'repair_runtime_projection_history_visibility()?;',
  'Codex runtime projection must not synchronously wait for session visibility repair',
);
const codexApiServiceRefreshAccounts = extractRange(
  codexApiServicePage,
  'onRefreshAccounts={async (accountIds) => {',
  'onRefreshStats={reloadState}',
  'Codex API service member refresh path',
);
assertNotContains(
  codexApiServiceRefreshAccounts,
  'Promise.allSettled(',
  'Codex API service member refresh must not fan out all quota refreshes at once',
);
assertContains(
  codexLocalAccessModal,
  'memberRefreshBusy',
  'Codex local access modal must lock member refresh actions with local busy state',
);
assertContains(
  codexLocalAccessModal,
  'setMemberRefreshBusy(true)',
  'Codex local access modal must set busy before refreshing selected members',
);
assertContains(
  codexLocalAccessModal,
  'setMemberRefreshBusy(false)',
  'Codex local access modal must clear busy after refreshing selected members',
);
assertNotContains(
  codexApiServicePage,
  'codexService.refreshCodexQuota(accountId, { force: true })',
  'Codex API service refresh actions must not force live refresh by default',
);
const codexStoreRefreshSubscriptionInfo = extractRange(
  codexAccountStore,
  'refreshSubscriptionInfo: async (accountId: string)',
  'refreshAllQuotas: async ()',
  'Codex account store refresh subscription info path',
);
assertContains(
  codexStoreRefreshSubscriptionInfo,
  'codexService.refreshCodexSubscriptionInfo(accountId, {',
  'Codex account store refresh subscription info must pass an explicit options bag',
);
assertContains(
  codexStoreRefreshSubscriptionInfo,
  'force: false',
  'Codex account store refresh subscription info must not force live refresh by default',
);
const codexServiceRefreshSubscriptionInfo = extractRange(
  codexService,
  'export async function refreshCodexSubscriptionInfo(',
  '/** 刷新所有账号配额 */',
  'Codex service refresh subscription info path',
);
assertContains(
  codexServiceRefreshSubscriptionInfo,
  'force: options?.force ?? false',
  'Codex service refresh subscription info must default to non-forced refresh',
);
assertNotContains(
  codexServiceRefreshSubscriptionInfo,
  'force: options?.force ?? true',
  'Codex service refresh subscription info must not default to forced refresh',
);
const codexRefreshSubscriptionCommand = extractRange(
  codexCommands,
  'pub async fn refresh_codex_subscription_info',
  'pub async fn refresh_current_codex_quota',
  'Codex refresh subscription info command',
);
assertContains(
  codexRefreshSubscriptionCommand,
  'force.unwrap_or(false)',
  'Codex refresh subscription info command must default to non-forced refresh',
);
assertNotContains(
  codexRefreshSubscriptionCommand,
  'force.unwrap_or(true)',
  'Codex refresh subscription info command must not default to forced refresh',
);

assertNotContains(
  webReport,
  'AUTH_REFRESH_STALE_THRESHOLD_SECONDS',
  'web_report must not restore a global stale refresh threshold',
);
assertContains(
  webReport,
  'service_refresh_at: HashMap',
  'web_report must track refresh attempts per service',
);
assertContains(
  webReport,
  'fn service_refresh_delay_seconds',
  'web_report must keep interval-aware refresh delay calculation',
);
assertContains(
  webReport,
  'fn build_due_service_refresh_policies',
  'web_report must filter refresh work to due services only',
);
assertContains(
  webReport,
  'service_refresh_due_respects_disabled_policy',
  'web_report refresh guard must include disabled-policy coverage',
);
assertContains(
  webReport,
  'service_refresh_due_uses_per_service_interval',
  'web_report refresh guard must include per-service interval coverage',
);
assertContains(
  preflight,
  'scripts/test-refresh-risk-guard.cjs',
  'release preflight must run the refresh-risk guard',
);

console.log('PASS refresh-risk guard tests');

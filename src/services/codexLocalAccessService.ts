import { invoke } from '@tauri-apps/api/core';
import type {
  CodexLocalAccessCustomRoutingRule,
  CodexLocalAccessImageGenerationMode,
  CodexLocalAccessModelAlias,
  CodexLocalAccessPortCleanupResult,
  CodexLocalAccessRequestLogQuery,
  CodexLocalAccessRoutingStrategy,
  CodexLocalAccessScope,
  CodexLocalAccessState,
  CodexLocalApiSafetyPresetId,
  CodexLocalAccessTestResult,
  CodexLocalAccessUsageEventPage,
  CodexRuntimeIntegrationMode,
  CodexRuntimeModeState,
} from '../types/codexLocalAccess';

export async function getCodexLocalAccessState(): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_get_state');
}

export async function saveCodexLocalAccessAccounts(
  accountIds: string[],
  restrictFreeAccounts: boolean,
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_save_accounts', {
    accountIds,
    restrictFreeAccounts,
  });
}

export async function removeCodexLocalAccessAccount(
  accountId: string,
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_remove_account', { accountId });
}

export async function rotateCodexLocalAccessApiKey(): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_rotate_api_key');
}

export async function updateCodexLocalAccessBoundOAuthAccount(
  boundOauthAccountId: string | null,
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_update_bound_oauth_account', {
    boundOauthAccountId,
  });
}

export async function clearCodexLocalAccessStats(): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_clear_stats');
}

export async function recoverCodexLocalAccessHealth(
  accountId: string,
  model?: string | null,
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_recover_health', { accountId, model });
}

export async function pauseCodexLocalAccessHealth(
  accountId: string,
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_pause_health', { accountId });
}

export async function queryCodexLocalAccessRequestLogs(
  query: CodexLocalAccessRequestLogQuery,
): Promise<CodexLocalAccessUsageEventPage> {
  return await invoke('codex_local_access_query_request_logs', {
    page: query.page,
    pageSize: query.pageSize,
    statsRange: query.statsRange ?? null,
    modelQuery: query.modelQuery ?? null,
    accountQuery: query.accountQuery ?? null,
    apiKeyQuery: query.apiKeyQuery ?? null,
    requestKind: query.requestKind ?? null,
    success: query.success ?? null,
    errorCategory: query.errorCategory ?? null,
  });
}

export async function prepareCodexLocalAccessForRestart(): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_prepare_restart');
}

export async function killCodexLocalAccessPort(): Promise<CodexLocalAccessPortCleanupResult> {
  return await invoke('codex_local_access_kill_port');
}

export async function updateCodexLocalAccessPort(
  port: number,
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_update_port', { port });
}

export async function updateCodexLocalAccessRoutingStrategy(
  strategy: CodexLocalAccessRoutingStrategy,
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_update_routing_strategy', { strategy });
}

export async function applyCodexLocalAccessSafetyPreset(
  preset: CodexLocalApiSafetyPresetId,
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_apply_safety_preset', { preset });
}

export async function updateCodexLocalAccessCustomRouting(
  rules: CodexLocalAccessCustomRoutingRule[],
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_update_custom_routing', { rules });
}

export async function updateCodexLocalAccessModelRules(
  modelAliases: CodexLocalAccessModelAlias[],
  excludedModels: string[],
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_update_model_rules', {
    modelAliases,
    excludedModels,
  });
}

export async function updateCodexLocalAccessRoutingOptions(payload: {
  sessionAffinity: boolean;
  sessionAffinityTtlMs: number;
  maxRetryCredentials: number;
  maxRetryIntervalMs: number;
  disableCooling: boolean;
}): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_update_routing_options', payload);
}

export async function updateCodexLocalAccessUpstreamProxyConfig(
  upstreamProxyUrl: string | null,
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_update_upstream_proxy_config', {
    upstreamProxyUrl,
  });
}

export async function updateCodexLocalAccessAccessScope(
  accessScope: CodexLocalAccessScope,
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_update_access_scope', {
    accessScope,
  });
}

export async function updateCodexLocalAccessImageGenerationMode(
  imageGenerationMode: CodexLocalAccessImageGenerationMode,
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_update_image_generation_mode', {
    imageGenerationMode,
  });
}

export async function createCodexLocalAccessApiKey(
  label?: string | null,
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_create_api_key', {
    label: label ?? null,
  });
}

export async function updateCodexLocalAccessApiKey(
  apiKeyId: string,
  payload: {
    label?: string | null;
    enabled?: boolean | null;
    modelPrefix?: string | null;
    allowedModels?: string[] | null;
    excludedModels?: string[] | null;
  },
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_update_api_key', {
    apiKeyId,
    label: payload.label ?? null,
    enabled: payload.enabled ?? null,
    modelPrefix: payload.modelPrefix ?? null,
    allowedModels: payload.allowedModels ?? null,
    excludedModels: payload.excludedModels ?? null,
  });
}

export async function rotateCodexLocalAccessNamedApiKey(
  apiKeyId: string,
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_rotate_named_api_key', { apiKeyId });
}

export async function deleteCodexLocalAccessApiKey(
  apiKeyId: string,
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_delete_api_key', { apiKeyId });
}

export async function setCodexLocalAccessEnabled(
  enabled: boolean,
  options?: { force?: boolean },
): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_set_enabled', {
    enabled,
    force: options?.force ?? false,
  });
}

export async function getCodexRuntimeMode(): Promise<CodexRuntimeModeState> {
  return await invoke('codex_runtime_mode_get');
}

export async function setCodexRuntimeMode(
  mode: CodexRuntimeIntegrationMode,
  options?: { force?: boolean },
): Promise<CodexRuntimeModeState> {
  return await invoke('codex_runtime_mode_set', {
    mode,
    force: options?.force ?? false,
  });
}

export async function activateCodexLocalAccess(): Promise<CodexLocalAccessState> {
  return await invoke('codex_local_access_activate');
}

export async function testCodexLocalAccess(): Promise<CodexLocalAccessTestResult> {
  return await invoke('codex_local_access_test');
}

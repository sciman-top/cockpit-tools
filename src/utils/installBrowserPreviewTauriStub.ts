type BrowserPreviewWindow = Window & {
  __COCKPIT_BROWSER_PREVIEW__?: boolean;
  __TAURI__?: {
    metadata: Record<string, unknown>;
    core: {
      invoke: (command: string, args?: unknown) => Promise<unknown>;
    };
  };
  __TAURI_INTERNALS__?: {
    metadata: {
      currentWindow: { label: string };
      currentWebview: { label: string };
    };
    invoke: (command: string, args?: unknown) => Promise<unknown>;
    transformCallback: (callback: unknown) => number;
  };
  __TAURI_EVENT_PLUGIN_INTERNALS__?: {
    unregisterListener: (...args: unknown[]) => void;
  };
};

function hasTauriInvokeBridge(target: BrowserPreviewWindow): boolean {
  return (
    typeof target.__TAURI__?.core?.invoke === 'function' ||
    typeof target.__TAURI_INTERNALS__?.invoke === 'function'
  );
}

function readBrowserPreviewJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readBrowserPreviewCodexAccounts(): unknown[] {
  return readBrowserPreviewJson<unknown[]>('agtools.codex.accounts.cache', []);
}

function readBrowserPreviewCurrentCodexAccount(): unknown {
  return readBrowserPreviewJson<unknown | null>(
    'agtools.codex.accounts.current',
    null,
  );
}

function readBrowserPreviewLocalAccessState(): ReturnType<
  typeof buildBrowserPreviewLocalAccessState
> {
  return readBrowserPreviewJson(
    'agtools.codex.local_access.state.preview',
    buildBrowserPreviewLocalAccessState(),
  );
}

function buildBrowserPreviewCodexWakeupRuntime() {
  return {
    available: true,
    binaryPath: 'browser-preview-codex',
    configuredCodexCliPath: null,
    configuredNodePath: null,
    version: 'browser-preview',
    source: 'browser-preview',
    message: 'Browser preview runtime',
    requiredRuntimePaths: [],
    checkedAt: Date.now(),
    installHints: [],
  };
}

function buildBrowserPreviewCodexWakeupState() {
  const now = Date.now();
  return {
    enabled: false,
    tasks: [
      {
        id: 'preview-quota-reset',
        name: 'Browser Preview Quota Reset',
        enabled: false,
        accountIds: ['preview-codex-oauth'],
        prompt: 'hello from browser preview',
        model: 'gpt-5.3-codex',
        modelDisplayName: 'GPT-5.3 Codex',
        modelReasoningEffort: 'medium',
        schedule: {
          kind: 'quota_reset',
          quotaResetWindow: 'either',
        },
        executionMode: 'confirm',
        confirmTimeoutMinutes: 5,
        createdAt: now - 60_000,
        updatedAt: now - 30_000,
        nextRunAt: null,
      },
      {
        id: 'preview-startup-delayed',
        name: 'Browser Preview Startup Wakeup',
        enabled: false,
        accountIds: ['preview-codex-oauth'],
        prompt: 'hello from browser preview',
        model: 'gpt-5.3-codex',
        modelDisplayName: 'GPT-5.3 Codex',
        modelReasoningEffort: 'medium',
        schedule: {
          kind: 'startup',
          startupDelayMinutes: 10,
        },
        executionMode: 'confirm',
        confirmTimeoutMinutes: 5,
        createdAt: now - 50_000,
        updatedAt: now - 20_000,
        nextRunAt: null,
      },
    ],
    modelPresets: [
      {
        id: 'preview-gpt-5-3-codex',
        name: 'GPT-5.3 Codex',
        model: 'gpt-5.3-codex',
        allowedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
        defaultReasoningEffort: 'medium',
      },
    ],
    modelPresetMigrations: [],
  };
}

function readBrowserPreviewCodexWakeupOverview() {
  return readBrowserPreviewJson(
    'agtools.codex.wakeup.overview.preview',
    {
      runtime: buildBrowserPreviewCodexWakeupRuntime(),
      state: buildBrowserPreviewCodexWakeupState(),
      history: [],
    },
  );
}

function findBrowserPreviewCodexAccount(args: unknown): unknown {
  const accountId =
    args && typeof args === 'object' && 'accountId' in args
      ? String((args as { accountId?: unknown }).accountId ?? '')
      : '';
  if (!accountId) {
    return readBrowserPreviewCurrentCodexAccount();
  }
  return (
    readBrowserPreviewCodexAccounts().find(
      (account) =>
        account &&
        typeof account === 'object' &&
        'id' in account &&
        String((account as { id?: unknown }).id) === accountId,
    ) ?? readBrowserPreviewCurrentCodexAccount()
  );
}

function buildBrowserPreviewLocalAccessState() {
  const now = Date.now();
  const usage = {
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    clientCanceledCount: 0,
    upstreamResponseFailedCount: 0,
    streamIncompleteCount: 0,
    totalLatencyMs: 0,
    textRequestCount: 0,
    imageRequestCount: 0,
    imageGenerationRequestCount: 0,
    imageEditRequestCount: 0,
    imageGenerationCapabilityFailureCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    estimatedCostUsd: 0,
  };
  const concurrencyDiagnostics = {
    updatedAt: now,
    maxConcurrentRequests: 1,
    activeRequestCount: 0,
    activeStreamCount: 0,
    requestCapacity: 1,
    minRequestIntervalSeconds: 5,
    maxQueueWaitSeconds: 0,
    startIntervalRemainingMs: 0,
  };

  return {
    collection: null,
    running: false,
    defaultProfile: null,
    apiPortUrl: 'http://127.0.0.1:54140/v1',
    baseUrl: 'http://127.0.0.1:54140/v1',
    lanBaseUrl: null,
    modelIds: [],
    modelPricingPresets: [],
    lastError: null,
    memberCount: 0,
    effectiveAccountIds: [],
    stats: {
      since: now,
      updatedAt: now,
      totals: usage,
      accounts: [],
      models: [],
      apiKeys: [],
      recent: [],
    },
    health: {
      schemaVersion: 1,
      updatedAt: now,
      unavailable: false,
      loadError: null,
      accounts: [],
      healthyCount: 0,
      estimatedAvailableCount: 0,
      coolingCount: 0,
      exhaustedCount: 0,
      authSuspectCount: 0,
      manualRequiredCount: 0,
      disabledCount: 0,
      activeModelCooldownCount: 0,
      stickyAccountHash: null,
      stickyReason: null,
      stickyExpiresAtMs: null,
      nearestCooldownUntilMs: null,
      lastErrorType: null,
      lastStatus: null,
      lastRequestId: null,
      auditDegraded: false,
      auditError: null,
      auditDegradedAtMs: null,
      selectorInsight: null,
      blockedInsight: null,
      recentAuditEvents: [
        {
          timestamp: now - 45_000,
          requestId: 'req-preview-selector',
          phase: 'selector',
          requestIdSource: 'client_request_id',
          status: 200,
          errorType: null,
          streamState: null,
          outcome: 'selected',
          modelKey: 'gpt-5.5',
          selectedReason: 'sticky_selected',
          sessionAffinitySource: 'session_id',
          recoverAction: null,
          retryAfterMs: null,
          message: null,
        },
        {
          timestamp: now - 12_000,
          requestId: 'req-preview-blocked',
          phase: 'final_response',
          requestIdSource: 'client_request_id',
          status: 503,
          errorType: 'pool_unavailable',
          streamState: 'json_completed',
          outcome: 'error',
          modelKey: 'gpt-5.5',
          selectedReason: null,
          sessionAffinitySource: null,
          recoverAction: 'retry_after_cooldown_or_start_new_task',
          retryAfterMs: 3000,
          message: 'API 服务号池暂无可调度账号（冷却中 2 个）',
        },
      ],
    },
    concurrencyDiagnostics,
    accountHealth: [],
  };
}

function buildBrowserPreviewLocalAccessLightState() {
  const state = readBrowserPreviewLocalAccessState();
  return {
    running: state.running,
    apiPortUrl: state.apiPortUrl,
    baseUrl: state.baseUrl,
    lanBaseUrl: state.lanBaseUrl,
    lastError: state.lastError,
    memberCount: state.memberCount,
    effectiveAccountIds: state.effectiveAccountIds,
    health: state.health,
    concurrencyDiagnostics: state.concurrencyDiagnostics,
    accountHealth: state.accountHealth,
  };
}

async function browserPreviewInvoke(
  command: string,
  args?: unknown,
): Promise<unknown> {
  if (command === 'plugin:event|listen') {
    return 0;
  }
  if (
    command === 'plugin:event|unlisten' ||
    command === 'save_tray_platform_layout' ||
    command === 'update_log'
  ) {
    return null;
  }
  if (command === 'get_general_config') {
    return {
      language: 'zh-CN',
      theme: 'light',
      ui_scale: 1,
      auto_start: false,
      auto_refresh_minutes: 0,
      codex_auto_refresh_minutes: 0,
      minimize_to_tray: false,
      close_to_tray: false,
      close_behavior: 'ask',
      opencode_app_path: '',
      antigravity_app_path: '',
      codex_app_path: '',
      vscode_app_path: '',
      opencode_sync_on_switch: false,
      codex_launch_on_switch: true,
    };
  }
  if (command === 'save_general_config' || command === 'wakeup_sync_state') {
    return null;
  }
  if (command === 'check_version_jump') {
    return null;
  }
  if (command === 'list_accounts') {
    return [];
  }
  if (command === 'get_current_account') {
    return null;
  }
  if (command === 'announcement_get_state') {
    return {
      announcements: [],
      unreadIds: [],
      popupAnnouncement: null,
    };
  }
  if (
    command === 'announcement_mark_read' ||
    command === 'announcement_mark_all_read'
  ) {
    return null;
  }
  if (command === 'list_codex_accounts') {
    return readBrowserPreviewCodexAccounts();
  }
  if (command === 'get_current_codex_account') {
    return readBrowserPreviewCurrentCodexAccount();
  }
  if (
    command === 'refresh_codex_account_profile' ||
    command === 'refresh_codex_subscription_info'
  ) {
    return findBrowserPreviewCodexAccount(args);
  }
  if (command === 'sync_codex_local_quota_observations') {
    return 0;
  }
  if (command === 'codex_local_access_get_state') {
    return readBrowserPreviewLocalAccessState();
  }
  if (command === 'codex_local_access_get_light_state') {
    return buildBrowserPreviewLocalAccessLightState();
  }
  if (command === 'codex_runtime_mode_get') {
    return {
      mode: 'direct_projection',
      accountKind: 'oauth',
      currentAccountId: null,
      updatedAt: Date.now(),
    };
  }
  if (command === 'codex_list_instances') {
    return [];
  }
  if (command === 'get_codex_api_service_app_speed_config') {
    return {
      speed: 'standard',
      globalStatePath: 'browser-preview',
    };
  }
  if (command === 'codex_wakeup_get_cli_status') {
    return readBrowserPreviewCodexWakeupOverview().runtime;
  }
  if (command === 'codex_wakeup_update_runtime_config') {
    return readBrowserPreviewCodexWakeupOverview().runtime;
  }
  if (command === 'codex_wakeup_get_overview') {
    return readBrowserPreviewCodexWakeupOverview();
  }
  if (command === 'codex_wakeup_get_state') {
    return readBrowserPreviewCodexWakeupOverview().state;
  }
  if (command === 'codex_wakeup_load_history') {
    return readBrowserPreviewCodexWakeupOverview().history;
  }
  if (command === 'codex_wakeup_save_state') {
    return {
      enabled:
        args && typeof args === 'object' && 'enabled' in args
          ? Boolean((args as { enabled?: unknown }).enabled)
          : false,
      tasks:
        args && typeof args === 'object' && 'tasks' in args
          ? ((args as { tasks?: unknown[] }).tasks ?? [])
          : [],
      modelPresets:
        args && typeof args === 'object' && 'modelPresets' in args
          ? ((args as { modelPresets?: unknown[] }).modelPresets ?? [])
          : [],
      modelPresetMigrations:
        args && typeof args === 'object' && 'modelPresetMigrations' in args
          ? ((args as { modelPresetMigrations?: unknown[] }).modelPresetMigrations ?? [])
          : [],
    };
  }
  if (
    command === 'codex_wakeup_clear_history' ||
    command === 'codex_wakeup_cancel_scope' ||
    command === 'codex_wakeup_release_scope'
  ) {
    return null;
  }
  throw new Error(`[browser-preview] Tauri invoke unavailable: ${command}`);
}

if (typeof window !== 'undefined') {
  const target = window as unknown as BrowserPreviewWindow;
  if (!hasTauriInvokeBridge(target)) {
    target.__COCKPIT_BROWSER_PREVIEW__ = true;
    target.__TAURI__ = {
      metadata: {},
      core: {
        invoke: browserPreviewInvoke,
      },
    };
    target.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: 'browser-preview' },
        currentWebview: { label: 'browser-preview-webview' },
      },
      invoke: browserPreviewInvoke,
      transformCallback: () => 0,
    };
    target.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
  }
}

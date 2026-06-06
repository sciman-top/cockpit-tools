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
    },
    concurrencyDiagnostics,
    accountHealth: [],
  };
}

function buildBrowserPreviewLocalAccessLightState() {
  const state = buildBrowserPreviewLocalAccessState();
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
      minimize_to_tray: false,
      close_to_tray: false,
    };
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
    return buildBrowserPreviewLocalAccessState();
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

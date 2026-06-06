import { create } from 'zustand';
import {
  CodexAccount,
  CodexApiProviderMode,
  CodexAppSpeed,
  CodexQuota,
  getCodexSubscriptionExpiryBucket,
  hasCodexAccountStructure,
  hasCodexAccountName,
  isCodexApiKeyAccount,
  isCodexPaidPlanType,
  isCodexTeamLikePlan,
} from '../types/codex';
import * as codexService from '../services/codexService';
import { emitAccountsChanged, emitCurrentAccountChanged } from '../utils/accountSyncEvents';
import {
  sanitizeAccountForLocalCache,
  sanitizeAccountsForLocalCache,
} from '../utils/accountCacheSanitizer';
import { loadJsonFromLocalStorage } from '../utils/storageJson';

const APP_PROFILE = (import.meta.env.VITE_COCKPIT_TOOLS_PROFILE || '').trim();
const STORAGE_PROFILE_SUFFIX =
  APP_PROFILE && APP_PROFILE !== 'prod' ? `.${APP_PROFILE}` : '';
const SHOULD_PRESERVE_CACHE_ON_EMPTY_LIST = !STORAGE_PROFILE_SUFFIX;
const CODEX_ACCOUNTS_CACHE_KEY = `agtools.codex.accounts.cache${STORAGE_PROFILE_SUFFIX}`;
const CODEX_CURRENT_ACCOUNT_CACHE_KEY = `agtools.codex.accounts.current${STORAGE_PROFILE_SUFFIX}`;
const CODEX_PROFILE_SYNC_IN_FLIGHT = new Set<string>();
const CODEX_PROFILE_SYNC_LAST_ATTEMPT = new Map<string, number>();
const CODEX_PROFILE_SYNC_RETRY_INTERVAL_MS = 5 * 60 * 1000;
let allowNextEmptyCodexAccountList = false;
let allowNextEmptyCodexCurrentAccount = false;

const sanitizeCodexAccountForCache = (account: CodexAccount): CodexAccount => ({
  ...sanitizeAccountForLocalCache(account),
  openai_api_key: undefined,
  tokens: {
    id_token: '',
    access_token: '',
  },
});

const sanitizeCodexAccountsForCache = (accounts: CodexAccount[]): CodexAccount[] =>
  sanitizeAccountsForLocalCache(accounts).map(sanitizeCodexAccountForCache);

const loadCachedCodexAccounts = () => {
  const parsed = loadJsonFromLocalStorage<unknown>(CODEX_ACCOUNTS_CACHE_KEY, (error) => {
    console.warn('[CodexAccountStore] 清理损坏的账号缓存:', error);
  });
  if (!Array.isArray(parsed)) {
    return [];
  }
  const sanitized = sanitizeCodexAccountsForCache(parsed as CodexAccount[]);
  try {
    localStorage.setItem(CODEX_ACCOUNTS_CACHE_KEY, JSON.stringify(sanitized));
  } catch {
    // ignore cache write failures
  }
  return sanitized;
};

const loadCachedCodexCurrentAccount = () => {
  const parsed = loadJsonFromLocalStorage<CodexAccount>(
    CODEX_CURRENT_ACCOUNT_CACHE_KEY,
    (error) => {
      console.warn('[CodexAccountStore] 清理损坏的当前账号缓存:', error);
    },
  );
  if (!parsed) {
    return null;
  }
  const sanitized = sanitizeCodexAccountForCache(parsed);
  try {
    localStorage.setItem(CODEX_CURRENT_ACCOUNT_CACHE_KEY, JSON.stringify(sanitized));
  } catch {
    // ignore cache write failures
  }
  return sanitized;
};

const persistCodexAccountsCache = (accounts: CodexAccount[]) => {
  try {
    localStorage.setItem(
      CODEX_ACCOUNTS_CACHE_KEY,
      JSON.stringify(sanitizeCodexAccountsForCache(accounts)),
    );
  } catch {
    // ignore cache write failures
  }
};

const persistCodexCurrentAccountCache = (account: CodexAccount | null) => {
  try {
    if (!account) {
      localStorage.removeItem(CODEX_CURRENT_ACCOUNT_CACHE_KEY);
      return;
    }
    localStorage.setItem(
      CODEX_CURRENT_ACCOUNT_CACHE_KEY,
      JSON.stringify(sanitizeCodexAccountForCache(account)),
    );
  } catch {
    // ignore cache write failures
  }
};

const mergeSwitchedCodexAccountIntoList = (
  accounts: CodexAccount[],
  switchedAccount: CodexAccount,
): CodexAccount[] => {
  let found = false;
  const nextAccounts = accounts.map((account) => {
    if (account.id !== switchedAccount.id) {
      return account;
    }
    found = true;
    return {
      ...account,
      ...switchedAccount,
    };
  });

  if (found) {
    return nextAccounts;
  }
  return [switchedAccount, ...nextAccounts];
};

const shouldHydrateCodexProfile = (account: CodexAccount): boolean =>
  !hasCodexAccountStructure(account) ||
  (isCodexTeamLikePlan(account.plan_type) && !hasCodexAccountName(account));

const shouldHydrateCodexSubscription = (account: CodexAccount): boolean => {
  if (isCodexApiKeyAccount(account) || !isCodexPaidPlanType(account.plan_type)) {
    return false;
  }

  const expiryBucket = getCodexSubscriptionExpiryBucket(
    account.subscription_active_until,
  );
  if (expiryBucket === "missing") {
    return false;
  }
  if (expiryBucket !== "expired") {
    return false;
  }

  const nextRetryAt = account.subscription_query_next_retry_at;
  if (typeof nextRetryAt === "number" && Number.isFinite(nextRetryAt)) {
    return nextRetryAt <= Math.floor(Date.now() / 1000);
  }
  return true;
};

const shouldHydrateCodexMetadata = (account: CodexAccount): boolean =>
  shouldHydrateCodexProfile(account) || shouldHydrateCodexSubscription(account);

const CODEX_STALE_ACCOUNT_ERROR = 'CODEX_STALE_ACCOUNT';

interface CodexAccountState {
  accounts: CodexAccount[];
  currentAccount: CodexAccount | null;
  loading: boolean;
  error: string | null;
  
  // Actions
  fetchAccounts: (options?: {
    silent?: boolean;
    hydrateProfiles?: boolean;
  }) => Promise<void>;
  syncLocalQuotaObservations: () => Promise<number>;
  fetchCurrentAccount: () => Promise<void>;
  switchAccount: (accountId: string, options?: { force?: boolean }) => Promise<CodexAccount>;
  deleteAccount: (accountId: string) => Promise<void>;
  deleteAccounts: (accountIds: string[]) => Promise<void>;
  refreshQuota: (accountId: string) => Promise<CodexQuota>;
  refreshSubscriptionInfo: (accountId: string) => Promise<CodexAccount>;
  refreshAllQuotas: () => Promise<number>;
  hydrateAccountProfilesIfNeeded: (accountIds?: string[]) => Promise<void>;
  importFromLocal: () => Promise<CodexAccount>;
  importFromJson: (jsonContent: string) => Promise<CodexAccount[]>;
  updateAccountName: (accountId: string, name: string) => Promise<CodexAccount>;
  updateApiKeyCredentials: (
    accountId: string,
    apiKey: string,
    apiBaseUrl?: string,
    apiProviderMode?: CodexApiProviderMode,
    apiProviderId?: string,
    apiProviderName?: string,
  ) => Promise<CodexAccount>;
  updateApiKeyBoundOAuthAccount: (
    accountId: string,
    boundOauthAccountId: string | null,
  ) => Promise<CodexAccount>;
  updateAccountTags: (accountId: string, tags: string[]) => Promise<CodexAccount>;
  updateAccountNote: (accountId: string, note: string) => Promise<CodexAccount>;
  updateAccountAppSpeed: (accountId: string, speed: CodexAppSpeed) => Promise<CodexAccount>;
}

export const useCodexAccountStore = create<CodexAccountState>((set, get) => {
  const syncCodexSnapshotAfterRefresh = async (reason: string) => {
    try {
      await get().fetchAccounts({ silent: true, hydrateProfiles: false });
    } catch (error) {
      console.error(`[CodexAccountStore] ${reason} 后回读账号列表失败:`, error);
    }

    try {
      await get().fetchCurrentAccount();
    } catch (error) {
      console.error(`[CodexAccountStore] ${reason} 后回读当前账号失败:`, error);
    }
  };

  return ({
  accounts: loadCachedCodexAccounts(),
  currentAccount: loadCachedCodexCurrentAccount(),
  loading: false,
  error: null,
  
  fetchAccounts: async (options) => {
    if (!options?.silent) {
      set({ loading: true, error: null });
    }
    try {
      const accounts = await codexService.listCodexAccounts();
      if (
        SHOULD_PRESERVE_CACHE_ON_EMPTY_LIST &&
        accounts.length === 0 &&
        get().accounts.length > 0 &&
        !allowNextEmptyCodexAccountList
      ) {
        console.warn('[CodexAccountStore] 忽略异常空账号列表，保留本地缓存账号');
        if (!options?.silent) {
          set({ loading: false });
        }
        return;
      }
      allowNextEmptyCodexAccountList = false;
      set(options?.silent ? { accounts } : { accounts, loading: false });
      persistCodexAccountsCache(accounts);
      if (options?.hydrateProfiles ?? true) {
        void get().hydrateAccountProfilesIfNeeded(
          accounts.map((account) => account.id),
        );
      }
    } catch (e) {
      set(options?.silent ? { error: String(e) } : { error: String(e), loading: false });
    }
  },

  syncLocalQuotaObservations: async () => {
    const repairedCount = await codexService.syncCodexLocalQuotaObservations();
    if (repairedCount > 0) {
      await get().fetchAccounts({ silent: true, hydrateProfiles: false });
      await get().fetchCurrentAccount();
    }
    return repairedCount;
  },
  
  fetchCurrentAccount: async () => {
    try {
      const currentAccount = await codexService.getCurrentCodexAccount();
      if (
        SHOULD_PRESERVE_CACHE_ON_EMPTY_LIST &&
        !currentAccount &&
        get().currentAccount &&
        get().accounts.length > 0 &&
        !allowNextEmptyCodexCurrentAccount
      ) {
        console.warn('[CodexAccountStore] 忽略异常空当前账号，保留本地缓存当前账号');
        return;
      }
      allowNextEmptyCodexCurrentAccount = false;
      set({ currentAccount });
      persistCodexCurrentAccountCache(currentAccount);
    } catch (e) {
      console.error('获取当前 Codex 账号失败:', e);
    } finally {
      allowNextEmptyCodexCurrentAccount = false;
    }
  },
  
  switchAccount: async (accountId: string, options?: { force?: boolean }) => {
    const accounts = await codexService.listCodexAccounts();
    allowNextEmptyCodexAccountList = false;
    set({ accounts, loading: false, error: null });
    persistCodexAccountsCache(accounts);

    const targetExists = accounts.some((account) => account.id === accountId);
    if (!targetExists) {
      const currentAccount = await codexService.getCurrentCodexAccount();
      allowNextEmptyCodexCurrentAccount = false;
      set({ currentAccount });
      persistCodexCurrentAccountCache(currentAccount);
      throw new Error(CODEX_STALE_ACCOUNT_ERROR);
    }

    const account = await codexService.switchCodexAccount(accountId, {
      force: options?.force ?? false,
    });
    const nextAccounts = mergeSwitchedCodexAccountIntoList(get().accounts, account);
    set({
      accounts: nextAccounts,
      currentAccount: account,
      loading: false,
      error: null,
    });
    persistCodexAccountsCache(nextAccounts);
    persistCodexCurrentAccountCache(account);
    await emitCurrentAccountChanged({
      platformId: 'codex',
      accountId: account.id,
      reason: 'switch',
    });
    void get().fetchAccounts({ silent: true, hydrateProfiles: false });
    return account;
  },
  
  deleteAccount: async (accountId: string) => {
    const previousCurrentAccountId = get().currentAccount?.id ?? null;
    allowNextEmptyCodexAccountList = get().accounts.length <= 1;
    allowNextEmptyCodexCurrentAccount = previousCurrentAccountId === accountId;
    try {
      await codexService.deleteCodexAccount(accountId);
      await get().fetchAccounts();
      await get().fetchCurrentAccount();
    } finally {
      allowNextEmptyCodexAccountList = false;
      allowNextEmptyCodexCurrentAccount = false;
    }
    await emitAccountsChanged({
      platformId: 'codex',
      reason: 'delete',
    });
    const nextCurrentAccountId = get().currentAccount?.id ?? null;
    if (previousCurrentAccountId !== nextCurrentAccountId) {
      await emitCurrentAccountChanged({
        platformId: 'codex',
        accountId: nextCurrentAccountId,
        reason: 'delete',
      });
    }
  },
  
  deleteAccounts: async (accountIds: string[]) => {
    const previousCurrentAccountId = get().currentAccount?.id ?? null;
    const deleteIdSet = new Set(accountIds);
    allowNextEmptyCodexAccountList = get().accounts.every((account) =>
      deleteIdSet.has(account.id),
    );
    allowNextEmptyCodexCurrentAccount = previousCurrentAccountId
      ? deleteIdSet.has(previousCurrentAccountId)
      : false;
    try {
      await codexService.deleteCodexAccounts(accountIds);
      await get().fetchAccounts();
      await get().fetchCurrentAccount();
    } finally {
      allowNextEmptyCodexAccountList = false;
      allowNextEmptyCodexCurrentAccount = false;
    }
    await emitAccountsChanged({
      platformId: 'codex',
      reason: 'delete',
    });
    const nextCurrentAccountId = get().currentAccount?.id ?? null;
    if (previousCurrentAccountId !== nextCurrentAccountId) {
      await emitCurrentAccountChanged({
        platformId: 'codex',
        accountId: nextCurrentAccountId,
        reason: 'delete',
      });
    }
  },
  
  refreshQuota: async (accountId: string) => {
    try {
      return await codexService.refreshCodexQuota(accountId);
    } finally {
      await syncCodexSnapshotAfterRefresh('刷新配额');
    }
  },

  refreshSubscriptionInfo: async (accountId: string) => {
    try {
      return await codexService.refreshCodexSubscriptionInfo(accountId, {
        force: false,
      });
    } finally {
      await syncCodexSnapshotAfterRefresh('刷新订阅信息');
    }
  },
  
  refreshAllQuotas: async () => {
    try {
      return await codexService.refreshAllCodexQuotas();
    } finally {
      await syncCodexSnapshotAfterRefresh('批量刷新配额');
    }
  },

  hydrateAccountProfilesIfNeeded: async (accountIds?: string[]) => {
    const now = Date.now();
    const scope = accountIds ? new Set(accountIds) : null;
    const candidates = get().accounts.filter(
      (account) =>
        (!scope || scope.has(account.id)) &&
          shouldHydrateCodexMetadata(account) &&
          !CODEX_PROFILE_SYNC_IN_FLIGHT.has(account.id) &&
          now - (CODEX_PROFILE_SYNC_LAST_ATTEMPT.get(account.id) ?? 0) >=
            CODEX_PROFILE_SYNC_RETRY_INTERVAL_MS,
    );

    const mergeUpdatedAccount = (updatedAccount: CodexAccount) => {
      set((state) => {
        const nextAccounts = state.accounts.map((item) =>
          item.id === updatedAccount.id ? { ...item, ...updatedAccount } : item,
        );
        const nextCurrentAccount =
          state.currentAccount?.id === updatedAccount.id
            ? { ...state.currentAccount, ...updatedAccount }
            : state.currentAccount;

        persistCodexAccountsCache(nextAccounts);
        persistCodexCurrentAccountCache(nextCurrentAccount);

        return {
          accounts: nextAccounts,
          currentAccount: nextCurrentAccount,
        };
      });
    };

    for (const account of candidates) {
      CODEX_PROFILE_SYNC_IN_FLIGHT.add(account.id);
      CODEX_PROFILE_SYNC_LAST_ATTEMPT.set(account.id, now);
      try {
        const needsProfile = shouldHydrateCodexProfile(account);
        const needsSubscription = shouldHydrateCodexSubscription(account);
        let latestAccount = account;

        if (needsProfile) {
          try {
            latestAccount = await codexService.refreshCodexAccountProfile(
              latestAccount.id,
            );
            mergeUpdatedAccount(latestAccount);
          } catch (e) {
            console.warn('刷新 Codex 账号资料失败:', account.id, e);
          }
        }

        if (needsSubscription) {
          try {
            latestAccount = await codexService.refreshCodexSubscriptionInfo(
              latestAccount.id,
              { force: false },
            );
            mergeUpdatedAccount(latestAccount);
          } catch (e) {
            console.warn('刷新 Codex 订阅信息失败:', account.id, e);
          }
        }
      } finally {
        CODEX_PROFILE_SYNC_IN_FLIGHT.delete(account.id);
      }
    }
  },
  
  importFromLocal: async () => {
    const account = await codexService.importCodexFromLocal();
    await get().fetchAccounts();
    await emitAccountsChanged({
      platformId: 'codex',
      reason: 'import',
    });
    return account;
  },
  
  importFromJson: async (jsonContent: string) => {
    const accounts = await codexService.importCodexFromJson(jsonContent);
    await get().fetchAccounts();
    await emitAccountsChanged({
      platformId: 'codex',
      reason: 'import',
    });
    return accounts;
  },

  updateAccountName: async (accountId: string, name: string) => {
    const account = await codexService.updateCodexAccountName(accountId, name);
    await get().fetchAccounts();
    await get().fetchCurrentAccount();
    return account;
  },

  updateApiKeyCredentials: async (
    accountId: string,
    apiKey: string,
    apiBaseUrl?: string,
    apiProviderMode?: CodexApiProviderMode,
    apiProviderId?: string,
    apiProviderName?: string,
  ) => {
    const account = await codexService.updateCodexApiKeyCredentials(
      accountId,
      apiKey,
      apiBaseUrl,
      apiProviderMode,
      apiProviderId,
      apiProviderName,
    );
    await get().fetchAccounts();
    await get().fetchCurrentAccount();
    return account;
  },

  updateApiKeyBoundOAuthAccount: async (
    accountId: string,
    boundOauthAccountId: string | null,
  ) => {
    const account = await codexService.updateCodexApiKeyBoundOAuthAccount(
      accountId,
      boundOauthAccountId,
    );
    await get().fetchAccounts();
    await get().fetchCurrentAccount();
    return account;
  },

  updateAccountTags: async (accountId: string, tags: string[]) => {
    const account = await codexService.updateCodexAccountTags(accountId, tags);
    await get().fetchAccounts();
    return account;
  },

  updateAccountNote: async (accountId: string, note: string) => {
    const account = await codexService.updateCodexAccountNote(accountId, note);
    await get().fetchAccounts();
    await get().fetchCurrentAccount();
    return account;
  },

  updateAccountAppSpeed: async (accountId: string, speed: CodexAppSpeed) => {
    const account = await codexService.updateCodexAccountAppSpeed(accountId, speed);
    await get().fetchAccounts();
    await get().fetchCurrentAccount();
    return account;
  },
  });
});

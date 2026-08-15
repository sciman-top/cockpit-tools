import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CodebuddySessionListPanel } from '../components/codebuddy/CodebuddySessionListPanel';
import { CodebuddySessionManager } from '../components/codebuddy/CodebuddySessionManager';
import {
  CodebuddySuiteAccountsSharedView,
  type CodebuddySuiteAccountsPlatformConfig,
} from '../components/codebuddy-suite/CodebuddySuiteAccountsSharedView';
import { DosageNotifyUsageStatus } from '../components/platform/DosageNotifyUsageStatus';
import {
  PlatformOverviewTabsHeader,
  type PlatformOverviewTab,
} from '../components/platform/PlatformOverviewTabsHeader';
import { useProviderAccountsPage } from '../hooks/useProviderAccountsPage';
import * as codebuddyService from '../services/codebuddyService';
import { useCodebuddyAccountStore } from '../stores/useCodebuddyAccountStore';
import {
  CB_PACKAGE_CODE,
  type CodebuddyAccount,
  type CodebuddyOfficialQuotaResource,
  getCodebuddyAccountDisplayEmail,
  getCodebuddyOfficialQuotaModel,
  getCodebuddyPlanBadge,
  getCodebuddyQuotaCategoryGroups,
  getCodebuddyUsage,
} from '../types/codebuddy';
import { compareCurrentAccountFirst } from '../utils/currentAccountSort';
import { CodebuddyInstancesContent } from './CodebuddyInstancesPage';

const CB_FLOW_NOTICE_COLLAPSED_KEY = 'agtools.codebuddy.flow_notice_collapsed';
const CB_CURRENT_ACCOUNT_ID_KEY = 'agtools.codebuddy.current_account_id';
const QUOTA_NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

const codebuddyPlatformConfig: CodebuddySuiteAccountsPlatformConfig<CodebuddyAccount> = {
  pageClassName: 'codebuddy-accounts-page',
  quickSettingsType: 'codebuddy',
  searchPlaceholderKey: 'codebuddy.search',
  searchPlaceholderDefault: '搜索 CodeBuddy 账号...',
  flowNotice: {
    titleKey: 'codebuddy.flowNotice.title',
    titleDefault: 'CodeBuddy 账号管理说明（点击展开/收起）',
    descKey: 'codebuddy.flowNotice.desc',
    descDefault: '切换账号需读取 CodeBuddy 本地认证存储并调用系统凭据服务进行加解密，数据仅在本地处理。',
    permissionKey: 'codebuddy.flowNotice.permission',
    permissionDefault: '权限范围：读取 CodeBuddy 认证数据库 (state.vscdb)，调用系统凭据能力（macOS Keychain / Windows DPAPI / Linux Secret Service）进行解密/回写。',
    networkKey: 'codebuddy.flowNotice.network',
    networkDefault: '网络范围：OAuth 授权登录与 Token 刷新需联网请求 codebuddy.ai；配额查询需调用计费 API。不上传本地密钥或凭证。',
  },
  noAccountsKey: 'codebuddy.noAccounts',
  noAccountsDefault: '暂无 CodeBuddy 账号',
  addAccountTitleKey: 'codebuddy.addAccount',
  addAccountTitleDefault: '添加 CodeBuddy 账号',
  oauthDescKey: 'codebuddy.oauthDesc',
  oauthDescDefault: '点击下方按钮将在浏览器中打开 CodeBuddy 授权页面。',
  oauthFeatureCardClassName: 'codebuddy-oauth-feature-card',
  oauthFeatureTitleKey: 'codebuddy.oauthFeature.oauth.title',
  oauthFeatureTitleDefault: '仅授权 IDE 登录信息',
  oauthFeatureItem1Key: 'codebuddy.oauthFeature.oauth.item1',
  oauthFeatureItem1Default: '在浏览器完成 OAuth 后即可添加账号并用于 IDE 切换。',
  oauthFeatureItem2Key: 'codebuddy.oauthFeature.oauth.item2',
  oauthFeatureItem2Default: '授权完成后会自动刷新资源包配额数据。',
  oauthFeatureItem3Key: 'codebuddy.oauthFeature.oauth.item3',
  oauthFeatureItem3Default: '账号卡片将按资源包展示额度、进度和刷新/到期时间。',
  oauthUrlInputPlaceholderKey: 'codebuddy.oauthUrlInputPlaceholder',
  oauthUrlInputPlaceholderDefault: '可手动输入授权地址',
  oauthWaitingKey: 'codebuddy.oauthWaiting',
  oauthWaitingDefault: '等待授权完成...',
  tokenDescKey: 'codebuddy.tokenDesc',
  tokenDescDefault: '粘贴 CodeBuddy 的 access token：',
  importLocalDescKey: 'codebuddy.import.localDesc',
  importLocalDescDefault: '支持从本机 CodeBuddy 客户端或 JSON 文件导入账号数据。',
  importLocalClientKey: 'codebuddy.import.localClient',
  importLocalClientDefault: '从本机 CodeBuddy 导入',
  getDisplayEmail: getCodebuddyAccountDisplayEmail,
  getPlanBadge: getCodebuddyPlanBadge,
  getUsage: getCodebuddyUsage,
  getQuotaGroups: (account, t) => getCodebuddyQuotaCategoryGroups(account, t),
  hasQuotaData: (account) => {
    const model = getCodebuddyOfficialQuotaModel(account);
    return model.resources.length > 0 || model.extra.total > 0 || model.extra.remain > 0 || model.extra.used > 0;
  },
  usagePrefix: 'codebuddy',
  quotaPrefix: 'codebuddy',
  tableUsageClassName: 'codebuddy-table-usage',
};

function formatQuotaNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return QUOTA_NUMBER_FORMATTER.format(Math.max(0, value));
}

function clampPercent(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function getQuotaClassByRemainPercent(remainPercent: number | null): string {
  if (remainPercent == null || !Number.isFinite(remainPercent)) return 'high';
  if (remainPercent <= 10) return 'critical';
  if (remainPercent <= 30) return 'low';
  if (remainPercent <= 60) return 'medium';
  return 'high';
}

function formatQuotaDateTime(timeMs: number | null, locale: string): string | null {
  if (timeMs == null || !Number.isFinite(timeMs)) return null;
  const date = new Date(timeMs);
  if (locale.startsWith('zh')) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}年 ${month}月${day}日 ${hour}:${minute}:${second}`;
  }
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

interface CodebuddyQuotaSectionProps {
  account: CodebuddyAccount;
  variant: 'card' | 'table';
  locale: string;
  maskAccountText: (value: string) => string;
}

function CodebuddyQuotaSection({ account, variant, locale, maskAccountText }: CodebuddyQuotaSectionProps) {
  const { t } = useTranslation();
  const model = getCodebuddyOfficialQuotaModel(account);
  const hasQuotaData =
    model.resources.length > 0 || model.extra.total > 0 || model.extra.remain > 0 || model.extra.used > 0;
  const refreshFailed = !!account.quota_query_last_error?.trim();
  const shouldShowQuota = hasQuotaData && !refreshFailed;
  const statusText = refreshFailed
    ? t('codebuddy.quotaQuery.failedRefreshCompact', '配额查询失败')
    : t('codebuddy.quotaQuery.empty', '暂无可用配额数据');
  const extraResource: CodebuddyOfficialQuotaResource = {
    ...model.extra,
    packageName: t('codebuddy.extraCredit.title', '加量包'),
  };
  const resources = [...model.resources, extraResource];

  const packageTitle = (resource: CodebuddyOfficialQuotaResource, isExtra: boolean) => {
    if (isExtra || resource.packageCode === CB_PACKAGE_CODE.extra) {
      return t('codebuddy.extraCredit.title', '加量包');
    }
    if (resource.packageCode === CB_PACKAGE_CODE.activity) {
      return t('codebuddy.quotaQuery.packageTitle.activity', '活动赠送包');
    }
    if (
      resource.packageCode === CB_PACKAGE_CODE.free ||
      resource.packageCode === CB_PACKAGE_CODE.gift ||
      resource.packageCode === CB_PACKAGE_CODE.freeMon
    ) {
      return t('codebuddy.quotaQuery.packageTitle.base', '基础体验包');
    }
    if (
      resource.packageCode === CB_PACKAGE_CODE.proMon ||
      resource.packageCode === CB_PACKAGE_CODE.proYear
    ) {
      return t('codebuddy.quotaQuery.packageTitle.pro', '专业版订阅');
    }
    return resource.packageName || t('codebuddy.quotaQuery.packageUnknown', '套餐信息未知');
  };

  const resourceTime = (resource: CodebuddyOfficialQuotaResource, isExtra: boolean) => {
    if (isExtra) return null;
    const isBase = resource.isBasePackage;
    const primary = formatQuotaDateTime(isBase ? resource.refreshAt : resource.expireAt, locale);
    if (primary) {
      return isBase
        ? t('codebuddy.quotaQuery.updatedAt', '下次刷新时间：{{time}}', { time: primary })
        : t('codebuddy.quotaQuery.expireAt', '到期时间：{{time}}', { time: primary });
    }
    const fallback = formatQuotaDateTime(isBase ? resource.expireAt : resource.refreshAt, locale);
    if (!fallback) return null;
    return isBase
      ? t('codebuddy.quotaQuery.expireAt', '到期时间：{{time}}', { time: fallback })
      : t('codebuddy.quotaQuery.updatedAt', '下次刷新时间：{{time}}', { time: fallback });
  };

  return (
    <>
      <div className="quota-item">
        <div className="quota-header">
          <span className="quota-name">{t('codebuddy.usage', '用量状态')}</span>
          <DosageNotifyUsageStatus
            usage={getCodebuddyUsage(account)}
            locale={locale}
            accountLabel={maskAccountText(getCodebuddyAccountDisplayEmail(account))}
            normalText={t('codebuddy.usageNormal', '正常')}
            abnormalText={t('codebuddy.usageAbnormal', '异常')}
            viewDetailText={t('codebuddy.usageViewDetail', '查看详情')}
            detailTitle={t('codebuddy.usageDetailTitle', '用量状态详情')}
            accountText={t('common.shared.columns.account', '账号')}
            confirmText={t('common.confirm', '确认')}
            closeText={t('common.close', '关闭')}
            classPrefix="codebuddy"
          />
        </div>
      </div>
      <div className="quota-item codebuddy-quota-item">
        <div className="quota-header codebuddy-quota-header">
          <span className="quota-name">{t('codebuddy.quotaQuery.sectionTitle', '配额查询')}</span>
        </div>
        {shouldShowQuota ? (
          <div className="codebuddy-official-quota-list">
            {resources.map((resource, index) => {
              const isExtra = index === resources.length - 1;
              const quotaClass = getQuotaClassByRemainPercent(resource.remainPercent);
              const usedPercent = clampPercent(resource.usedPercent);
              const title = packageTitle(resource, isExtra);
              const timeText = resourceTime(resource, isExtra);
              return (
                <div
                  key={`${account.id}-${resource.packageCode || 'pkg'}-${index}`}
                  className="codebuddy-official-quota-row"
                >
                  <div className="quota-header">
                    <span className="quota-label" title={title}>{title}</span>
                    <span className={`quota-pct ${quotaClass}`}>
                      {formatQuotaNumber(resource.used)} / {formatQuotaNumber(resource.total)}
                    </span>
                  </div>
                  <div className={variant === 'card' ? 'quota-bar-track' : 'quota-progress-track'}>
                    <div
                      className={`${variant === 'card' ? 'quota-bar' : 'quota-progress-bar'} ${quotaClass}`}
                      style={{ width: `${usedPercent}%` }}
                    />
                  </div>
                  {timeText && (
                    <div className="codebuddy-official-quota-meta-wrap">
                      <span className="codebuddy-official-quota-meta">{timeText}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="quota-empty">{statusText}</div>
        )}
      </div>
    </>
  );
}

export function CodebuddyAccountsPage() {
  const [activeTab, setActiveTab] = useState<PlatformOverviewTab>('overview');
  const store = useCodebuddyAccountStore();
  const page = useProviderAccountsPage<CodebuddyAccount>({
    platformKey: 'CodeBuddy',
    oauthLogPrefix: 'CodebuddyOAuth',
    flowNoticeCollapsedKey: CB_FLOW_NOTICE_COLLAPSED_KEY,
    currentAccountIdKey: CB_CURRENT_ACCOUNT_ID_KEY,
    exportFilePrefix: 'codebuddy_accounts',
    oauthTabKeys: ['oauth'],
    store: {
      accounts: store.accounts,
      currentAccountId: store.currentAccountId,
      loading: store.loading,
      error: store.error,
      fetchAccounts: store.fetchAccounts,
      fetchCurrentAccountId: store.fetchCurrentAccountId,
      deleteAccounts: store.deleteAccounts,
      refreshToken: store.refreshToken,
      refreshAllTokens: store.refreshAllTokens,
      setCurrentAccountId: store.setCurrentAccountId,
      updateAccountTags: store.updateAccountTags,
    },
    oauthService: {
      startLogin: codebuddyService.startCodebuddyOAuthLogin,
      completeLogin: codebuddyService.completeCodebuddyOAuthLogin,
      cancelLogin: codebuddyService.cancelCodebuddyOAuthLogin,
    },
    dataService: {
      importFromJson: codebuddyService.importCodebuddyFromJson,
      importFromLocal: codebuddyService.importCodebuddyFromLocal,
      addWithToken: codebuddyService.addCodebuddyAccountWithToken,
      exportAccounts: codebuddyService.exportCodebuddyAccounts,
      injectToVSCode: codebuddyService.injectCodebuddyToVSCode,
    },
    getDisplayEmail: getCodebuddyAccountDisplayEmail,
  });

  const accountsForInstances = useMemo(
    () =>
      [...store.accounts].sort((a, b) => {
        const currentFirstDiff = compareCurrentAccountFirst(a.id, b.id, store.currentAccountId);
        if (currentFirstDiff !== 0) return currentFirstDiff;
        const diff = b.created_at - a.created_at;
        return page.sortDirection === 'desc' ? diff : -diff;
      }),
    [page.sortDirection, store.accounts, store.currentAccountId],
  );

  const platformConfig = useMemo<CodebuddySuiteAccountsPlatformConfig<CodebuddyAccount>>(
    () => ({
      ...codebuddyPlatformConfig,
      renderQuotaSection: (account, variant) => (
        <CodebuddyQuotaSection
          account={account}
          variant={variant}
          locale={page.locale}
          maskAccountText={page.maskAccountText}
        />
      ),
    }),
    [page.locale, page.maskAccountText],
  );

  return (
    <div className={`ghcp-accounts-page ${codebuddyPlatformConfig.pageClassName}`}>
      <PlatformOverviewTabsHeader
        platform="codebuddy"
        active={activeTab}
        onTabChange={setActiveTab}
        tabs={['overview', 'sessions', 'instances']}
      />
      {activeTab === 'instances' ? (
        <CodebuddyInstancesContent accountsForSelect={accountsForInstances} />
      ) : activeTab === 'sessions' ? (
        <CodebuddySessionManager platform="intl" accounts={store.accounts as any} />
      ) : (
        <>
          <CodebuddySuiteAccountsSharedView
            accounts={store.accounts}
            loading={store.loading}
            page={page}
            platformConfig={platformConfig}
            onRefreshAccounts={() => { void store.fetchAccounts(); }}
          />
          <CodebuddySessionListPanel />
        </>
      )}
    </div>
  );
}

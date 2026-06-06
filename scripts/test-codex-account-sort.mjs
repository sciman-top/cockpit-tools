import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const outdir = path.join(tmpdir(), `cockpit-codex-sort-test-${process.pid}`);

await rm(outdir, { force: true, recursive: true });
await mkdir(outdir, { recursive: true });

await esbuild.build({
  entryPoints: {
    accountOrder: path.join(root, 'src/utils/accountOrder.ts'),
    floatingCardSelectors: path.join(root, 'src/utils/floatingCardSelectors.ts'),
    codexAccountSort: path.join(root, 'src/utils/codexAccountSort.ts'),
    codexLocalAccessUiState: path.join(root, 'src/utils/codexLocalAccessUiState.ts'),
    codexLocalAccessHealth: path.join(root, 'src/utils/codexLocalAccessHealth.ts'),
    codexTypes: path.join(root, 'src/types/codex.ts'),
    platformPresentation: path.join(root, 'src/presentation/platformAccountPresentation.ts'),
  },
  outdir,
  bundle: true,
  format: 'esm',
  platform: 'node',
  entryNames: '[name]',
  outExtension: { '.js': '.mjs' },
  logLevel: 'silent',
});

const accountOrder = await import(pathToFileURL(path.join(outdir, 'accountOrder.mjs')).href);
const selectors = await import(pathToFileURL(path.join(outdir, 'floatingCardSelectors.mjs')).href);
const sort = await import(pathToFileURL(path.join(outdir, 'codexAccountSort.mjs')).href);
const localAccessUiState = await import(pathToFileURL(path.join(outdir, 'codexLocalAccessUiState.mjs')).href);
const localAccessHealth = await import(pathToFileURL(path.join(outdir, 'codexLocalAccessHealth.mjs')).href);
const codexTypes = await import(pathToFileURL(path.join(outdir, 'codexTypes.mjs')).href);
const platformPresentation = await import(pathToFileURL(path.join(outdir, 'platformPresentation.mjs')).href);

function codexAccount(id, quota, extra = {}) {
  return {
    id,
    email: `${id}@example.test`,
    tokens: {
      id_token: `${id}-id-token`,
      access_token: `${id}-access-token`,
    },
    quota,
    created_at: extra.created_at ?? 1,
    last_used: extra.last_used ?? 1,
    ...extra,
  };
}

function quota(hourly, weekly, extra = {}) {
  return {
    hourly_percentage: hourly,
    weekly_percentage: weekly,
    hourly_window_present: true,
    weekly_window_present: true,
    ...extra,
  };
}

function translate(_key, optionsOrDefault, maybeOptions) {
  const options = typeof optionsOrDefault === 'object' ? optionsOrDefault : maybeOptions;
  if (typeof options?.defaultValue === 'string') return options.defaultValue;
  if (typeof optionsOrDefault === 'string') return optionsOrDefault;
  if (typeof options?.count === 'number') return String(options.count);
  if (typeof options?.value === 'string') return options.value;
  return '';
}

assert.deepEqual(
  accountOrder.normalizeAccountOrder(['pool-member'], ['candidate-a', 'pool-member', 'candidate-b']),
  ['pool-member', 'candidate-a', 'candidate-b'],
  'Full account order normalization keeps its custom-sort fill behavior',
);

assert.deepEqual(
  accountOrder.normalizeSelectedAccountOrder(
    ['pool-member', 'missing', 'pool-member'],
    ['candidate-a', 'pool-member', 'candidate-b'],
  ),
  ['pool-member'],
  'API service member persistence must not append every available candidate account',
);

assert.equal(
  codexTypes.getCodexQuotaWindowLabel(6 * 24 * 60, 'weekly'),
  'Weekly',
  'Weekly quota labels should not render API-service 6d threshold snapshots as a custom 6d window',
);

{
  const subscription = codexTypes.getCodexAccountSubscriptionPresentation(
    codexAccount('plus-without-expiry', undefined, { plan_type: 'plus', auth_mode: 'oauth' }),
    translate,
  );

  assert.equal(
    subscription.valueText,
    'PLUS',
    'Known Codex plan should not render as missing subscription info just because expiry is unavailable',
  );
  assert.equal(subscription.tone, 'active');
  assert.match(subscription.titleText, /PLUS/);
}

{
  const account = codexAccount('plus-with-stale-expiry', quota(95, 95), {
    plan_type: 'plus',
    auth_mode: 'oauth',
    subscription_active_until: '2000-01-01T00:00:00Z',
  });
  const subscription = codexTypes.getCodexAccountSubscriptionPresentation(
    account,
    translate,
  );
  const presentation = platformPresentation.buildCodexAccountPresentation(
    account,
    translate,
  );

  assert.equal(
    subscription.bucket,
    'known_plan',
    'Known paid Codex plans should not render stale historical expiry timestamps as visually expired',
  );
  assert.equal(subscription.valueText, 'PLUS');
  assert.equal(subscription.tone, 'warning');
  assert.equal(subscription.timestampMs, null);
  assert.equal(subscription.refreshable, true);
  assert.match(subscription.titleText, /PLUS/);
  assert.match(subscription.titleText, /2000-01-01/);
  assert.equal(
    presentation.planLabel,
    'PLUS',
    'Plan badge should continue showing the effective paid plan while stale expiry moves to a refreshable warning',
  );
  assert.match(presentation.planClass, /codex-plus/);
}

{
  const account = codexAccount(
    'confirmed-free-with-stale-plus',
    quota(100, 95, {
      hourly_window_present: false,
      weekly_window_present: true,
      weekly_window_minutes: 43200,
      raw_data: {
        plan_type: 'free',
        rate_limit: {
          primary_window: {
            used_percent: 5,
            limit_window_seconds: 2592000,
            reset_after_seconds: 2592000,
          },
        },
      },
    }),
    {
      plan_type: 'plus',
      auth_mode: 'oauth',
      subscription_active_until: '2000-01-01T00:00:00Z',
    },
  );
  const subscription = codexTypes.getCodexAccountSubscriptionPresentation(
    account,
    translate,
  );
  const presentation = platformPresentation.buildCodexAccountPresentation(
    account,
    translate,
  );

  assert.equal(
    presentation.planLabel,
    'FREE',
    'Confirmed free quota evidence plus expired paid metadata should render the card badge as FREE',
  );
  assert.equal(presentation.planClass, 'free');
  assert.equal(
    subscription.valueText,
    'FREE',
    'Confirmed free accounts should not keep showing subscription PLUS from stale historical metadata',
  );
  assert.equal(subscription.tone, 'active');
  assert.equal(subscription.timestampMs, null);
  assert.equal(subscription.refreshable, undefined);
  assert.deepEqual(
    presentation.quotaItems.map((item) => `${item.label}:${item.valueText}`),
    ['5 Week:95%'],
    'The real free monthly/weekly quota row should remain visible while only the stale plan label is corrected',
  );
}

{
  const presentation = platformPresentation.buildCodexAccountPresentation(
    codexAccount(
      'prolite-active-plan',
      quota(26, 73, {
        hourly_window_minutes: 300,
        weekly_window_minutes: 10080,
        raw_data: {
          plan_type: 'prolite',
          source: 'codex_session_rate_limits',
        },
      }),
      {
        plan_type: 'prolite',
        auth_mode: 'oauth',
        subscription_active_until: '2099-01-01T00:00:00Z',
      },
    ),
    translate,
  );

  assert.equal(
    presentation.planLabel,
    'PRO 5x',
    'Codex prolite is the Pro 5x tier and should not be rendered as PRO LITE',
  );
  assert.match(presentation.planClass, /codex-pro-lite/);
  assert.deepEqual(
    presentation.quotaItems.map((item) => `${item.label}:${item.valueText}`),
    ['5h:26%', 'Weekly:73%'],
    'Pro 5x accounts should keep their 5h and weekly quota rows while only the visible plan name changes',
  );
}

{
  const presentation = platformPresentation.buildCodexAccountPresentation(
    codexAccount(
      'promax-upgraded-with-stale-auth-file-plan',
      quota(26, 73, {
        hourly_window_minutes: 300,
        weekly_window_minutes: 10080,
        raw_data: {
          plan_type: 'pro',
          source: 'codex_official_websocket_rate_limits',
        },
      }),
      {
        plan_type: 'pro',
        auth_file_plan_type: 'prolite',
        auth_mode: 'oauth',
        subscription_active_until: '2099-01-01T00:00:00Z',
      },
    ),
    translate,
  );

  assert.equal(
    presentation.planLabel,
    'PRO 20x',
    'A future Pro 20x upgrade must not keep rendering as Pro 5x because of stale auth_file_plan_type=prolite',
  );
  assert.match(presentation.planClass, /codex-pro-max/);
  assert.doesNotMatch(presentation.planClass, /codex-pro-lite/);
}

{
  const presentation = platformPresentation.buildCodexAccountPresentation(
    codexAccount(
      'free-health-reset-unknown',
      quota(0, 0, {
        hourly_window_minutes: 300,
        weekly_window_minutes: 10080,
        raw_data: {
          source: 'codex_local_access_health_registry',
          reset_unknown: true,
        },
      }),
      { plan_type: 'free' },
    ),
    translate,
  );

  assert.deepEqual(
    presentation.quotaItems.map((item) => item.label),
    ['Weekly'],
    'Free reset-unknown health snapshots should collapse to the actual weekly quota row',
  );
}

{
  const presentation = platformPresentation.buildCodexAccountPresentation(
    codexAccount(
      'free-session-rate-limits',
      quota(0, 0, {
        hourly_window_minutes: 300,
        weekly_window_minutes: 10080,
        raw_data: {
          source: 'codex_session_rate_limits',
        },
      }),
      { plan_type: 'free' },
    ),
    translate,
  );

  assert.deepEqual(
    presentation.quotaItems.map((item) => item.label),
    ['Weekly'],
    'Free quota snapshots with a weekly row should not render a stale 5h row',
  );
}

{
  const presentation = platformPresentation.buildCodexAccountPresentation(
    codexAccount(
      'free-legacy-dual-window',
      quota(0, 0, {
        hourly_window_minutes: 300,
        weekly_window_minutes: 10080,
        raw_data: null,
      }),
      { plan_type: 'free' },
    ),
    translate,
  );

  assert.deepEqual(
    presentation.quotaItems.map((item) => item.label),
    ['Weekly'],
    'Free legacy snapshots with explicit weekly presence should collapse to weekly-only display',
  );
}

const exhaustedWeeklyButRecentlyUsed = codexAccount(
  'exhausted-weekly',
  quota(100, 0),
  { last_used: 999 },
);
const availableLowQuota = codexAccount('available-low', quota(10, 10));

assert.equal(
  selectors.getRecommendedCodexAccount(
    [exhaustedWeeklyButRecentlyUsed, availableLowQuota],
    null,
  )?.id,
  'available-low',
  'Codex recommendation must not prefer an account whose weekly quota is exhausted',
);

assert.deepEqual(
  [
    exhaustedWeeklyButRecentlyUsed,
    availableLowQuota,
    codexAccount('available-high', quota(80, 80)),
  ]
    .sort((left, right) =>
      sort.compareCodexAccountsByRecommendedSort(left, right, {
        apiServiceSortMeta: new Map([
          ['exhausted-weekly', 0],
          ['available-low', 1],
          ['available-high', 2],
        ]),
      }),
    )
    .map((account) => account.id),
  ['available-high', 'available-low', 'exhausted-weekly'],
  'API service members should keep pool priority but sort usable quota before exhausted accounts',
);

assert.deepEqual(
  [
    exhaustedWeeklyButRecentlyUsed,
    availableLowQuota,
    codexAccount('available-medium', quota(40, 40)),
  ]
    .sort((left, right) =>
      sort.compareCodexAccountsByRecommendedSort(left, right, {
        groupSortMeta: new Map([
          ['exhausted-weekly', { sortOrder: 0 }],
          ['available-low', { sortOrder: 0 }],
          ['available-medium', { sortOrder: 0 }],
        ]),
      }),
    )
    .map((account) => account.id),
  ['available-medium', 'available-low', 'exhausted-weekly'],
  'Grouped Codex cards should sort usable quota before stale group insertion order',
);

assert.deepEqual(
  sort.sortCodexLocalAccessAccountIdsForScheduling(
    ['quota-80-late', 'current-low', 'quota-80-soon', 'quota-30'],
    [
      codexAccount('quota-80-late', quota(80, 80, { hourly_reset_time: 900 })),
      codexAccount('current-low', quota(1, 1, { hourly_reset_time: 100 })),
      codexAccount('quota-80-soon', quota(80, 80, { hourly_reset_time: 300 })),
      codexAccount('quota-30', quota(30, 30, { hourly_reset_time: 200 })),
    ],
    'current-low',
  ),
  ['current-low', 'quota-80-soon', 'quota-80-late', 'quota-30'],
  'Scheduling helper should pin the current account, then sort by quota and reset time',
);

assert.deepEqual(
  sort.sortCodexLocalAccessAccountsForStableDisplay(
    [
      codexAccount('current-saved-second', quota(2, 97), { created_at: 20 }),
      codexAccount('saved-low', quota(15, 15), { created_at: 30 }),
      codexAccount('quota-90', quota(90, 90), { created_at: 10 }),
      codexAccount('quota-40-soon', quota(40, 40, { hourly_reset_time: 200 }), { created_at: 40 }),
    ],
    'current-saved-second',
  ).map((account) => account.id),
  ['current-saved-second', 'quota-90', 'quota-40-soon', 'saved-low'],
  'API service member display should pin the usable current account, then sort other members by quota evidence',
);

assert.deepEqual(
  sort.sortCodexLocalAccessAccountIdsForScheduling(
    ['quota-40-late', 'quota-90', 'current-low', 'quota-40-soon'],
    [
      codexAccount('quota-40-late', quota(40, 40, { hourly_reset_time: 800 })),
      codexAccount('quota-90', quota(90, 90, { hourly_reset_time: 700 })),
      codexAccount('current-low', quota(1, 1, { hourly_reset_time: 100 })),
      codexAccount('quota-40-soon', quota(40, 40, { hourly_reset_time: 200 })),
    ],
    'current-low',
  ),
  ['current-low', 'quota-90', 'quota-40-soon', 'quota-40-late'],
  'Scheduling helper should re-rank schedulable accounts by quota and reset time',
);

assert.deepEqual(
  sort.sortCodexLocalAccessAccountIdsForStableDisplay(
    [
      'current-weekly-0',
      'weekly-0-more-requests',
      'weekly-0-fewer-requests',
      'weekly-97',
    ],
    [
      codexAccount('current-weekly-0', quota(31, 0)),
      codexAccount('weekly-0-more-requests', quota(37, 0)),
      codexAccount('weekly-0-fewer-requests', quota(18, 0)),
      codexAccount('weekly-97', quota(20, 97, { hourly_reset_time: 200 })),
    ],
    'current-weekly-0',
  ),
  [
    'weekly-97',
    'weekly-0-more-requests',
    'weekly-0-fewer-requests',
    'current-weekly-0',
  ],
  'API service member display should sort non-current members by quota evidence before moving an exhausted current account to the end',
);

assert.deepEqual(
  sort.sortCodexLocalAccessAccountIdsForStableDisplay(
    ['current-low', 'saved-first', 'quota-90', 'quota-40-soon'],
    [
      codexAccount('current-low', quota(1, 1, { hourly_reset_time: 100 })),
      codexAccount('saved-first', quota(15, 15, { hourly_reset_time: 900 })),
      codexAccount('quota-90', quota(90, 90, { hourly_reset_time: 700 })),
      codexAccount('quota-40-soon', quota(40, 40, { hourly_reset_time: 200 })),
    ],
    'current-low',
  ),
  ['current-low', 'quota-90', 'quota-40-soon', 'saved-first'],
  'API service member display should not keep member insertion order after quota refresh',
);

assert.deepEqual(
  sort.sortCodexLocalAccessAccountIdsForStableDisplay(
    ['current-refresh-error', 'saved-first', 'quota-90'],
    [
      codexAccount('current-refresh-error', quota(40, 40), {
        quota_error: { message: 'quota refresh failed', timestamp: 1 },
      }),
      codexAccount('saved-first', quota(15, 15)),
      codexAccount('quota-90', quota(90, 90)),
    ],
    'current-refresh-error',
  ),
  ['current-refresh-error', 'quota-90', 'saved-first'],
  'API service member display should keep a current account with a non-limit refresh error pinned, then sort other members by quota evidence',
);

{
  const displayAccounts = [
    codexAccount('current-weekly-0', quota(31, 0)),
    codexAccount('oauth-next', quota(100, 100)),
    codexAccount('api-key', quota(100, 100), { auth_mode: 'apikey' }),
  ];
  const displayIds = sort.sortCodexLocalAccessAccountIdsForStableDisplay(
    ['current-weekly-0', 'oauth-next', 'api-key'],
    displayAccounts,
    'current-weekly-0',
  );

  assert.deepEqual(
    displayIds,
    ['oauth-next', 'api-key', 'current-weekly-0'],
    'API service card display should sort available OAuth members before API-key credentials and move an exhausted current account to the end',
  );
  assert.equal(
    sort.getCodexLocalAccessPrimaryRefreshAccountId(displayIds, displayAccounts),
    'oauth-next',
    'API service card refresh must target the first displayed OAuth account after stable display ordering',
  );
}

assert.equal(
  sort.getCodexLocalAccessPrimaryRefreshAccountId(
    ['quota-error', 'api-key'],
    [
      codexAccount('quota-error', quota(100, 100), {
        quota_error: { message: 'quota refresh failed', timestamp: 1 },
      }),
      codexAccount('api-key', quota(100, 100), { auth_mode: 'apikey' }),
    ],
  ),
  'quota-error',
  'API service card refresh must use display order instead of refresh-priority sorting',
);

assert.equal(
  sort.getCodexLocalAccessPrimaryRefreshAccountId(
    ['api-key', 'oauth-second'],
    [
      codexAccount('api-key', quota(100, 100), { auth_mode: 'apikey' }),
      codexAccount('oauth-second', quota(50, 50)),
    ],
  ),
  'oauth-second',
  'API service card refresh should skip API-key credentials when resolving the displayed primary account',
);

assert.equal(
  localAccessUiState.getCodexLocalAccessPrimaryActionKind(
    false,
    { mode: 'direct_projection', accountKind: 'oauth', currentAccountId: 'acc-direct', updatedAt: 1 },
  ),
  'activate',
  'API service card should offer activation while Codex remains in Direct API/OAuth mode',
);

assert.equal(
  localAccessUiState.getCodexLocalAccessPrimaryActionKind(
    false,
    { mode: 'cockpit_api_service', accountKind: 'oauth', currentAccountId: 'acc-api', updatedAt: 1 },
  ),
  'deactivate',
  'API service card should offer deactivation only when Codex is using Cockpit API Service mode',
);

assert.equal(
  localAccessUiState.getCodexLocalAccessPrimaryActionKind(true, null),
  'deactivate',
  'API service card should also offer deactivation when the default Codex launch binding is the API service account',
);

assert.equal(
  localAccessUiState.getCodexLocalAccessPrimaryActionLabelKind(
    false,
    { mode: 'direct_projection', accountKind: 'oauth', currentAccountId: 'acc-direct', updatedAt: 1 },
    true,
  ),
  'switch',
  'Running API service should show a switch action when Codex is still in Direct API/OAuth mode',
);

assert.equal(
  localAccessUiState.getCodexLocalAccessPrimaryActionLabelKind(
    false,
    { mode: 'direct_projection', accountKind: 'oauth', currentAccountId: 'acc-direct', updatedAt: 1 },
    false,
  ),
  'activate',
  'Stopped API service should keep the start action label while Codex is still in Direct API/OAuth mode',
);

assert.equal(
  localAccessUiState.getCodexLocalAccessPrimaryActionLabelKind(
    false,
    { mode: 'cockpit_api_service', accountKind: 'oauth', currentAccountId: 'acc-api', updatedAt: 1 },
    true,
  ),
  'deactivate',
  'Active Cockpit API Service mode should keep the deactivation label even when the service is running',
);

const refreshNowMs = 1_700_000_000_000;
const quotaCooldownError = {
  code: 'usage_limit_reached',
  message: 'API 返回错误 429 [error_code:usage_limit_reached] [reset_after_seconds:120]',
  timestamp: refreshNowMs - 20_000,
};

assert.equal(
  codexTypes.isCodexQuotaLimitError(quotaCooldownError),
  false,
  'Codex 429 usage_limit_reached with a reset timer should not be treated as account quota exhaustion',
);

assert.equal(
  codexTypes.isCodexQuotaCooldownError(quotaCooldownError),
  true,
  'Codex 429 usage_limit_reached with a reset timer should be classified as cooldown',
);

assert.deepEqual(
  {
    kind: codexTypes.getCodexQuotaIssueInfo(quotaCooldownError).kind,
    displayCode: codexTypes.getCodexQuotaIssueInfo(quotaCooldownError).displayCode,
  },
  {
    kind: 'cooldown',
    displayCode: 'usage_limit_reached',
  },
  'Codex quota issue presentation should keep usage_limit_reached on the cooldown path',
);

assert.equal(
  codexTypes.shouldShowCodexQuotaIssueNotice(quotaCooldownError),
  true,
  'Codex cooldown snapshots should render a notice without entering the account-error bucket',
);

assert.equal(
  codexTypes.shouldShowCodexQuotaIssueNotice({
    message: 'error sending request for url https://chatgpt.com/backend-api/wham/usage',
    timestamp: 1,
  }),
  true,
  'Codex quota refresh transport failures should still render a retry/manual-refresh notice',
);

assert.equal(
  localAccessHealth.isCodexLocalAccessQuotaHealthIssue({
    status: 'healthy',
    lastStatus: 429,
    lastErrorType: 'usage_limit_reached',
  }),
  false,
  'Healthy model-scoped local access quota signals should not render an account quota issue badge',
);

assert.equal(
  codexTypes.getCodexQuotaIssueInfo({
    code: 'usage_limit_reached',
    message: '',
    timestamp: refreshNowMs,
  }).kind,
  'cooldown',
  'Codex quota issue presentation should classify code-only usage_limit_reached as cooldown',
);

assert.equal(
  codexTypes.getCodexQuotaIssueInfo({
    message:
      'Cockpit API service upstream quota exhausted: status=429, error_type=usage_limit_reached, provider_code=usage_limit_reached, reset_at=1780158587',
    timestamp: refreshNowMs,
  }).displayCode,
  'usage_limit_reached',
  'Codex quota issue presentation should extract error_type from Cockpit API service quota snapshots',
);

assert.equal(
  codexTypes.getCodexQuotaIssueInfo({
    message: '{"error":{"type":"usage_limit_reached","code":"usage_limit_reached"}}',
    timestamp: refreshNowMs,
  }).kind,
  'cooldown',
  'Codex quota issue presentation should classify JSON usage_limit_reached bodies as cooldown',
);

const staleWeeklyInHourlySlot = quota(97, 100, {
  hourly_reset_time: 1_780_310_638,
  hourly_window_minutes: 10_080,
  hourly_window_present: true,
  weekly_window_present: false,
});
assert.deepEqual(
  codexTypes.getCodexEffectiveQuotaPercentages(staleWeeklyInHourlySlot),
  { hourly: null, weekly: 97, weeklyBlocksHourly: false },
  'Persisted free-plan weekly windows stored in the hourly slot must count as weekly quota',
);
assert.deepEqual(
  codexTypes.getCodexQuotaWindows(staleWeeklyInHourlySlot).map((window) => ({
    label: window.label,
    percentage: window.percentage,
    resetTime: window.resetTime,
    windowMinutes: window.windowMinutes,
  })),
  [
    {
      label: 'Weekly',
      percentage: 97,
      resetTime: 1_780_310_638,
      windowMinutes: 10_080,
    },
  ],
  'Stale weekly-in-hourly quota snapshots should render as a single weekly window',
);

assert.deepEqual(
  sort.sortCodexLocalAccessAccountIdsForStableDisplay(
    ['stale-weekly-exhausted', 'usable'],
    [
      codexAccount(
        'stale-weekly-exhausted',
        quota(0, 100, {
          hourly_window_minutes: 10_080,
          hourly_window_present: true,
          weekly_window_present: false,
        }),
      ),
      codexAccount('usable', quota(20, 20)),
    ],
    'stale-weekly-exhausted',
  ),
  ['usable', 'stale-weekly-exhausted'],
  'Stable display should move a current account with stale weekly-in-hourly exhausted quota to the end',
);
assert.equal(
  selectors.getRecommendedCodexAccount(
    [
      codexAccount(
        'stale-weekly-exhausted',
        quota(0, 100, {
          hourly_window_minutes: 10_080,
          hourly_window_present: true,
          weekly_window_present: false,
        }),
      ),
      codexAccount('usable', quota(20, 20)),
    ],
    null,
  )?.id,
  'usable',
  'Recommendations must not treat stale weekly-in-hourly exhausted quota as available',
);

const codeReviewResetBefore = Math.floor(Date.now() / 1000) + 120;
const codeReviewMetric = codexTypes.getCodexCodeReviewQuotaMetric({
  raw_data: {
    code_review_rate_limit: {
      primary_window: {
        used_percent: '25',
        limit_window_seconds: '18000',
        reset_after_seconds: '120',
      },
    },
  },
});
const codeReviewResetAfter = Math.floor(Date.now() / 1000) + 120;
assert.ok(codeReviewMetric, 'Codex code-review quota metric should parse');
assert.equal(
  codeReviewMetric.percentage,
  75,
  'Codex code-review quota should parse numeric-string usage percentages',
);
assert.ok(
  codeReviewMetric.resetTime >= codeReviewResetBefore &&
    codeReviewMetric.resetTime <= codeReviewResetAfter,
  'Codex code-review quota should parse numeric-string reset_after_seconds',
);

assert.equal(
  codexTypes.formatCodexResetTimeAbsolute(1_700_000_360_000),
  codexTypes.formatCodexResetTimeAbsolute(1_700_000_360),
  'Codex quota reset formatter should normalize millisecond timestamps',
);

assert.equal(
  codexTypes.formatCodexResetTime(
    1_700_000_360,
    (key) => (key === 'common.shared.quota.resetDone' ? '已重置' : key),
  ),
  codexTypes.formatCodexResetTimeAbsolute(1_700_000_360),
  'Codex quota reset formatter should keep showing the reset timestamp after it passes',
);

assert.equal(
  codexTypes.isCodexAccountErrorState(codexAccount('limited', quota(0, 0), {
    quota_error: quotaCooldownError,
  })),
  false,
  'Quota-cooldown Codex accounts should stay out of the ERROR/abnormal bucket',
);

assert.equal(
  codexTypes.isCodexAccountErrorState(codexAccount('unauthorized', quota(100, 100), {
    quota_error: {
      message: 'API 返回错误 401 [error_code:invalid_token]',
      timestamp: refreshNowMs - 20_000,
    },
  })),
  true,
  'Codex 401 invalid_token should remain an account error',
);

assert.deepEqual(
  sort.sortCodexLocalAccessAccountIdsForRefresh(
    [
      'current-schedulable',
      'future-exhausted',
      'quota-cooldown',
      'missing-quota',
      'reset-due',
      'quota-error',
      'api-key',
    ],
    [
      codexAccount('current-schedulable', quota(95, 95), { last_used: 999 }),
      codexAccount(
        'future-exhausted',
        quota(0, 0, { weekly_reset_time: Math.floor((refreshNowMs + 60_000) / 1000) }),
      ),
      codexAccount(
        'quota-cooldown',
        quota(0, 0, { weekly_reset_time: Math.floor((refreshNowMs + 120_000) / 1000) }),
        { quota_error: quotaCooldownError },
      ),
      codexAccount('missing-quota', undefined),
      codexAccount(
        'reset-due',
        quota(0, 0, { weekly_reset_time: Math.floor((refreshNowMs - 60_000) / 1000) }),
      ),
      codexAccount('quota-error', quota(100, 100), {
        quota_error: { message: 'quota refresh failed', timestamp: refreshNowMs - 10_000 },
      }),
      codexAccount('api-key', quota(100, 100), { auth_mode: 'apikey' }),
    ],
    refreshNowMs,
  ),
  [
    'quota-error',
    'missing-quota',
    'reset-due',
    'future-exhausted',
    'quota-cooldown',
    'current-schedulable',
    'api-key',
  ],
  'Local access refresh priority must refresh stale state first without treating quota-cooldown accounts as hard errors',
);

assert.deepEqual(
  sort.sortCodexLocalAccessAccountIdsForRefresh(
    ['healthy-b', 'healthy-a'],
    [
      codexAccount('healthy-a', quota(80, 80), { created_at: 20 }),
      codexAccount('healthy-b', quota(80, 80), { created_at: 10 }),
    ],
    refreshNowMs,
  ),
  ['healthy-a', 'healthy-b'],
  'Local access refresh priority should use deterministic account metadata instead of trusting input sequence',
);

assert.deepEqual(
  [
    codexAccount('service-saved-first', quota(80, 80), { created_at: 10 }),
    codexAccount('service-newer', quota(80, 80), { created_at: 20 }),
  ]
    .sort((left, right) =>
      sort.compareCodexAccountsByRecommendedSort(left, right, {
        apiServiceSortMeta: new Map([
          ['service-saved-first', 0],
          ['service-newer', 1],
        ]),
      }),
    )
    .map((account) => account.id),
  ['service-newer', 'service-saved-first'],
  'API service recommended sort should not use membership sequence as a tie-breaker',
);

assert.deepEqual(
  [
    codexAccount('new-reserve', quota(100, 100), { created_at: 20 }),
    codexAccount('used-recovered', quota(100, 100), { created_at: 10 }),
  ]
    .sort((left, right) =>
      sort.compareCodexAccountsByRecommendedSort(left, right, {
        apiServiceSortMeta: new Map([
          ['new-reserve', 0],
          ['used-recovered', 1],
        ]),
        apiServiceHealthSortMeta: new Map([
          ['used-recovered', 0],
          ['new-reserve', 1],
        ]),
      }),
    )
    .map((account) => account.id),
  ['used-recovered', 'new-reserve'],
  'API service recommended sort should use backend health order to keep used recovered accounts ahead of new reserve accounts when quota ties',
);

assert.deepEqual(
  Array.from(
    sort.buildCodexAccountIdSortMeta(
      ['missing-account', 'used-recovered', 'used-recovered', 'new-reserve'],
      { allowedAccountIds: new Set(['used-recovered', 'new-reserve']) },
    ).entries(),
  ),
  [
    ['used-recovered', 0],
    ['new-reserve', 1],
  ],
  'API service health sort meta should ignore missing and duplicate ids without reintroducing saved membership order',
);

assert.deepEqual(
  sort
    .sortCodexLocalAccessAccountsForScheduling(
      [
        codexAccount('new-reserve', quota(100, 100), { created_at: 20 }),
        codexAccount('used-recovered', quota(100, 100), { created_at: 10 }),
      ],
      null,
      sort.buildCodexAccountIdSortMeta(['used-recovered', 'new-reserve']),
    )
    .map((account) => account.id),
  ['used-recovered', 'new-reserve'],
  'API service member list scheduling should use backend health order when quota ties before falling back to newer account tie-breaks',
);

assert.deepEqual(
  [
    codexAccount('group-saved-first', quota(60, 60), { created_at: 10 }),
    codexAccount('group-newer', quota(60, 60), { created_at: 20 }),
  ]
    .sort((left, right) =>
      sort.compareCodexAccountsByRecommendedSort(left, right, {
        groupSortMeta: new Map([
          ['group-saved-first', { sortOrder: 0 }],
          ['group-newer', { sortOrder: 0 }],
        ]),
      }),
    )
    .map((account) => account.id),
  ['group-newer', 'group-saved-first'],
  'Grouped recommended sort should not use group membership sequence as a tie-breaker',
);

{
  const accounts = Array.from({ length: 32 }, (_, index) =>
    codexAccount(`subscription-${String(index).padStart(2, '0')}`, quota(80, 80), {
      created_at: 1_000 + index,
    }),
  );
  const timestamps = new Map(
    accounts.map((account, index) => [account.id, 2_000_000 - ((index * 37) % 997)]),
  );
  let directTimestampCalls = 0;
  const directSortedIds = [...accounts]
    .sort((left, right) =>
      sort.compareCodexAccountsBySort(left, right, {
        sortBy: 'subscription_expiry',
        sortDirection: 'asc',
        getSubscriptionTimestampMs(account) {
          directTimestampCalls += 1;
          return timestamps.get(account.id);
        },
      }),
    )
    .map((account) => account.id);

  let cachedTimestampCalls = 0;
  const cachedComparator = sort.createCodexAccountSortComparator({
    sortBy: 'subscription_expiry',
    sortDirection: 'asc',
    getSubscriptionTimestampMs(account) {
      cachedTimestampCalls += 1;
      return timestamps.get(account.id);
    },
  });
  const cachedSortedIds = [...accounts].sort(cachedComparator).map((account) => account.id);

  assert.deepEqual(
    cachedSortedIds,
    directSortedIds,
    'Cached Codex account sort comparator must preserve subscription-expiry order',
  );
  assert.ok(
    cachedTimestampCalls <= accounts.length,
    `Cached subscription sort should read each account at most once, got ${cachedTimestampCalls}`,
  );
  assert.ok(
    directTimestampCalls > cachedTimestampCalls,
    `Cached subscription sort should reduce repeated timestamp reads (${directTimestampCalls} -> ${cachedTimestampCalls})`,
  );
}

await rm(outdir, { force: true, recursive: true });

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = process.cwd();
const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const outdir = path.join(tmpdir(), `cockpit-codex-card-audit-${process.pid}`);
const accountsDir =
  process.env.COCKPIT_CODEX_ACCOUNTS_DIR ||
  path.join(homedir(), '.antigravity_cockpit', 'codex_accounts');
const reportDir = path.join(root, 'reports', 'codex-account-card-audit');
const reportPath = path.join(reportDir, `${runId}.json`);
const htmlPath = path.join(reportDir, `${runId}.html`);

await rm(outdir, { force: true, recursive: true });
await mkdir(outdir, { recursive: true });

await esbuild.build({
  entryPoints: {
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

const codexTypes = await import(pathToFileURL(path.join(outdir, 'codexTypes.mjs')).href);
const platformPresentation = await import(
  pathToFileURL(path.join(outdir, 'platformPresentation.mjs')).href
);

const translations = {
  'codex.subscription.expired': '有效期已过期',
  'codex.subscription.missing': '未查询',
  'codex.subscription.hoursLeft': '{{count}}小时',
  'codex.subscription.daysLeft': '{{count}}天',
  'codex.subscription.over99Days': '99+天',
};

function interpolate(template, values) {
  return template.replace(/{{\s*([^}\s]+)\s*}}/g, (_match, key) =>
    values?.[key] == null ? '' : String(values[key]),
  );
}

function translate(_key, optionsOrDefault, maybeOptions) {
  const template = translations[_key];
  const options = typeof optionsOrDefault === 'object' ? optionsOrDefault : maybeOptions;
  if (template) return interpolate(template, options);
  if (typeof options?.defaultValue === 'string') return options.defaultValue;
  if (typeof optionsOrDefault === 'string') return optionsOrDefault;
  if (typeof options?.count === 'number') return String(options.count);
  if (typeof options?.date === 'string') return options.date;
  if (typeof options?.plan === 'string') return options.plan;
  return '';
}

function normalizePlanKey(value) {
  return codexTypes.normalizeCodexPlanKey(value);
}

function readRawPlanType(account) {
  const raw = account?.quota?.raw_data;
  return typeof raw?.plan_type === 'string' ? raw.plan_type.trim().toLowerCase() : '';
}

function readRawSource(account) {
  const raw = account?.quota?.raw_data;
  return typeof raw?.source === 'string' ? raw.source : '';
}

function isFuture(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time > Date.now();
}

function isExpiredTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= Date.now();
}

function isConfirmedFree(account) {
  const rawPlan = account?.plan_type || '';
  if (!rawPlan || !codexTypes.isCodexPaidPlanType(rawPlan)) return false;
  if ((account?.auth_mode || '').trim().toLowerCase() === 'apikey') return false;
  if (readRawPlanType(account) !== 'free') return false;
  return !isFuture(account?.subscription_active_until);
}

function proTierFromPlan(value, genericProTier) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  if (
    normalized === 'prolite' ||
    normalized === 'pro-lite' ||
    normalized === 'pro-5x' ||
    normalized === 'codex-pro-5x'
  ) {
    return 'prolite';
  }
  if (
    normalized === 'promax' ||
    normalized === 'pro-max' ||
    normalized === 'pro-20x' ||
    normalized === 'codex-pro-20x'
  ) {
    return 'promax';
  }
  if (
    genericProTier &&
    (normalized === 'pro' || normalized === 'chatgpt-pro' || normalized === 'codex-pro')
  ) {
    return genericProTier;
  }
  return '';
}

function expectedProTier(account, effectivePlanType) {
  return (
    proTierFromPlan(effectivePlanType) ||
    proTierFromPlan(readRawPlanType(account)) ||
    proTierFromPlan(readRawPlanType(account), 'promax') ||
    (normalizePlanKey(effectivePlanType) === 'pro' ? 'promax' : '') ||
    proTierFromPlan(account?.auth_file_plan_type)
  );
}

function summarizeAccount(account, filename) {
  const safeAccount = {
    ...account,
    tokens: {},
    openai_api_key: account?.openai_api_key ? '[redacted]' : undefined,
  };
  const presentation = platformPresentation.buildCodexAccountPresentation(safeAccount, translate);
  const effectivePlanType = codexTypes.getCodexEffectivePlanTypeForPresentation(safeAccount);
  const effectivePlanKey = normalizePlanKey(effectivePlanType);
  const subscription = codexTypes.getCodexAccountSubscriptionPresentation(safeAccount, translate);
  const quotaRows = presentation.quotaItems.map((item) => ({
    key: item.key,
    label: item.label,
    valueText: item.valueText,
    percentage: item.percentage,
    resetText: item.resetText,
  }));
  const proTier = expectedProTier(safeAccount, effectivePlanType);
  const flags = [];

  if (isConfirmedFree(safeAccount)) {
    if (presentation.planLabel !== 'FREE' || presentation.planClass !== 'free') {
      flags.push('confirmed_free_rendered_as_paid');
    }
    if (subscription.valueText !== 'FREE' || subscription.tone !== 'active') {
      flags.push('confirmed_free_subscription_not_free');
    }
  }

  if (proTier === 'prolite') {
    if (presentation.planLabel !== 'PRO 5x' || !presentation.planClass.includes('codex-pro-lite')) {
      flags.push('prolite_tier_not_rendered_as_pro_5x');
    }
  }

  if (proTier === 'promax') {
    if (presentation.planLabel !== 'PRO 20x' || !presentation.planClass.includes('codex-pro-max')) {
      flags.push('promax_tier_not_rendered_as_pro_20x');
    }
  }

  if (
    isExpiredTimestamp(safeAccount.subscription_active_until) &&
    effectivePlanKey !== 'free' &&
    subscription.bucket === 'expired' &&
    (safeAccount.auth_mode || '').trim().toLowerCase() !== 'apikey'
  ) {
    flags.push('oauth_paid_plan_rendered_as_hard_expired');
  }

  return {
    filename,
    id: safeAccount.id,
    email: safeAccount.email,
    account_id: safeAccount.account_id,
    auth_mode: safeAccount.auth_mode,
    plan_type: safeAccount.plan_type,
    auth_file_plan_type: safeAccount.auth_file_plan_type,
    raw_quota_plan_type: readRawPlanType(safeAccount),
    raw_quota_source: readRawSource(safeAccount),
    subscription_active_until: safeAccount.subscription_active_until,
    effective_plan_type: effectivePlanType,
    effective_plan_key: effectivePlanKey,
    expected_pro_tier: proTier || undefined,
    presentation: {
      planLabel: presentation.planLabel,
      planClass: presentation.planClass,
      subscription: {
        bucket: subscription.bucket,
        tone: subscription.tone,
        valueText: subscription.valueText,
        detailText: subscription.detailText,
        refreshable: subscription.refreshable,
      },
      quotaRows,
    },
    flags,
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAuditHtml(report) {
  const cards = report.accounts
    .map((account) => {
      const quotaRows = (account.presentation?.quotaRows || [])
        .map(
          (row) => `
            <div class="quota-row">
              <span>${escapeHtml(row.label)}</span>
              <strong>${escapeHtml(row.valueText)}</strong>
            </div>
          `,
        )
        .join('');
      const flags =
        account.flags?.length > 0
          ? account.flags.map((flag) => `<span class="flag">${escapeHtml(flag)}</span>`).join('')
          : '<span class="ok">OK</span>';
      return `
        <article class="card ${escapeHtml(account.presentation?.planClass || '')}">
          <header>
            <div class="identity">
              <h2>${escapeHtml(account.email || account.id || account.filename)}</h2>
              <p>${escapeHtml(account.account_id || account.id || '')}</p>
            </div>
            <span class="badge">${escapeHtml(account.presentation?.planLabel || '')}</span>
          </header>
          <section class="meta">
            <div><span>plan_type</span><strong>${escapeHtml(account.plan_type)}</strong></div>
            <div><span>quota.raw_data.plan_type</span><strong>${escapeHtml(account.raw_quota_plan_type)}</strong></div>
            <div><span>auth_file_plan_type</span><strong>${escapeHtml(account.auth_file_plan_type)}</strong></div>
            <div><span>effective_plan</span><strong>${escapeHtml(account.effective_plan_type)}</strong></div>
          </section>
          <section class="quota">${quotaRows || '<div class="quota-row"><span>quota</span><strong>none</strong></div>'}</section>
          <footer>
            <span>${escapeHtml(account.presentation?.subscription?.valueText || '')}</span>
            <span>${escapeHtml(account.presentation?.subscription?.tone || '')}</span>
            <span>${flags}</span>
          </footer>
        </article>
      `;
    })
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codex Account Card Audit ${escapeHtml(report.runId)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      font-family: "Segoe UI", Arial, sans-serif;
      background: #eef4f4;
      color: #162033;
    }
    .summary {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 18px;
      margin-bottom: 18px;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
    }
    .summary p {
      margin: 6px 0 0;
      color: #536175;
      font-size: 13px;
    }
    .summary strong {
      color: #0f172a;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(320px, 1fr));
      gap: 16px;
    }
    .card {
      min-height: 260px;
      border: 1px solid #dde5eb;
      border-radius: 8px;
      background: #fbfdfd;
      box-shadow: 0 10px 26px rgba(20, 31, 44, 0.10);
      padding: 16px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }
    h2 {
      margin: 0;
      font-size: 15px;
      line-height: 1.35;
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .identity p {
      margin: 6px 0 0;
      color: #64748b;
      font-size: 11px;
      max-width: 270px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .badge {
      flex: 0 0 auto;
      min-width: 64px;
      text-align: center;
      border: 1px solid #bdd6e8;
      border-radius: 999px;
      background: #e9f3ff;
      color: #334155;
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0;
    }
    .codex-pro-lite .badge { background: #eef6ff; border-color: #9fb7d4; color: #334155; }
    .codex-pro-max .badge { background: #fff2db; border-color: #fdba74; color: #9a3412; }
    .codex-plus .badge { background: #dffcf0; border-color: #86efac; color: #047857; }
    .free .badge { background: #eef2f7; border-color: #cbd5e1; color: #334155; }
    .meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 18px;
    }
    .meta div {
      min-width: 0;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px;
      background: #ffffff;
    }
    .meta span {
      display: block;
      color: #64748b;
      font-size: 11px;
      margin-bottom: 5px;
    }
    .meta strong {
      display: block;
      min-height: 16px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
    }
    .quota {
      margin-top: 14px;
      display: grid;
      gap: 8px;
    }
    .quota-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-radius: 6px;
      background: #f3f7fa;
      padding: 8px 10px;
      font-size: 13px;
    }
    .quota-row strong { color: #0f766e; }
    footer {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
      color: #475569;
      font-size: 12px;
    }
    .ok {
      display: inline-flex;
      border-radius: 999px;
      background: #dcfce7;
      color: #166534;
      padding: 3px 8px;
      font-weight: 700;
    }
    .flag {
      display: inline-flex;
      border-radius: 999px;
      background: #fee2e2;
      color: #991b1b;
      padding: 3px 8px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <section class="summary">
    <div>
      <h1>Codex Account Card Audit</h1>
      <p>${escapeHtml(report.generatedAt)} | ${escapeHtml(report.accountsDir)}</p>
    </div>
    <p><strong>${report.accountCount}</strong> accounts | <strong>${report.issueCount}</strong> issues</p>
  </section>
  <main class="grid">${cards}</main>
</body>
</html>`;
}

const entries = await readdir(accountsDir, { withFileTypes: true });
const accountFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));

const accounts = [];
for (const filename of accountFiles) {
  const filePath = path.join(accountsDir, filename);
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    accounts.push(summarizeAccount(parsed, filename));
  } catch (error) {
    accounts.push({
      filename,
      flags: ['unreadable_account_json'],
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const flagCounts = {};
for (const account of accounts) {
  for (const flag of account.flags || []) {
    flagCounts[flag] = (flagCounts[flag] || 0) + 1;
  }
}

const report = {
  runId,
  generatedAt: new Date().toISOString(),
  accountsDir,
  accountCount: accounts.length,
  issueCount: Object.values(flagCounts).reduce((sum, count) => sum + count, 0),
  flagCounts,
  accounts,
};

await mkdir(reportDir, { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(htmlPath, renderAuditHtml(report), 'utf8');
await rm(outdir, { force: true, recursive: true });

console.log(JSON.stringify({
  reportPath,
  htmlPath,
  accountCount: report.accountCount,
  issueCount: report.issueCount,
  flagCounts: report.flagCounts,
}));

if (report.issueCount > 0) {
  process.exitCode = 1;
}

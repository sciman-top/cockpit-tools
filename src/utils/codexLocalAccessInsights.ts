import type { TFunction } from 'i18next';

export function getCodexLocalAccessSelectorReasonLabel(
  selectedReason: string | null | undefined,
  t: TFunction,
): string {
  switch (selectedReason) {
    case 'active_stream_affinity_selected':
      return t(
        'codex.localAccess.health.selectorReasonActiveStream',
        '沿用当前活跃任务账号',
      );
    case 'previous_response_affinity_selected':
      return t(
        'codex.localAccess.health.selectorReasonPreviousResponse',
        '沿用 previous_response_id 亲和账号',
      );
    case 'request_affinity_selected':
      return t(
        'codex.localAccess.health.selectorReasonRequestAffinity',
        '沿用当前请求亲和账号',
      );
    case 'sticky_selected':
      return t('codex.localAccess.health.selectorReasonSticky', '沿用 sticky 账号');
    case 'fill_first_selected':
      return t(
        'codex.localAccess.health.selectorReasonFillFirst',
        '按 fill-first 选择首个可用账号',
      );
    default:
      return selectedReason ?? '--';
  }
}

export function getCodexLocalAccessSkippedReasonLabel(
  reason: string,
  t: TFunction,
): string {
  switch (reason) {
    case 'health_skipped':
      return t('codex.localAccess.health.skipReasonHealth', '因健康状态跳过');
    case 'cap_truncated':
      return t('codex.localAccess.health.skipReasonCap', '因尝试上限截断');
    case 'sticky_cleared':
      return t('codex.localAccess.health.skipReasonStickyCleared', '旧 sticky 已清理');
    case 'invalid_candidate':
      return t('codex.localAccess.health.skipReasonInvalid', '无效候选');
    default:
      return reason;
  }
}

export function buildCodexLocalAccessSkippedReasonSummary(
  skippedCountsByReason: Record<string, number> | null | undefined,
  t: TFunction,
  formatCount: (count: number) => string = (count) => String(count),
): string | null {
  const entries = Object.entries(skippedCountsByReason ?? {}).filter(
    ([, count]) => Number.isFinite(count) && count > 0,
  );
  if (!entries.length) {
    return null;
  }
  return entries
    .map(
      ([reason, count]) =>
        `${getCodexLocalAccessSkippedReasonLabel(reason, t)} ${formatCount(count)}`,
    )
    .join(' · ');
}

export function getCodexLocalAccessBlockedRecoverActionLabel(
  recoverAction: string | null | undefined,
  t: TFunction,
): string | null {
  switch (recoverAction) {
    case 'retry_after_cooldown_or_start_new_task':
      return t(
        'codex.localAccess.health.recoverActionRetryCooldown',
        '等待冷却结束后重试，或开启新的独立任务',
      );
    case 'retry_after_cooldown_or_recover_accounts':
      return t(
        'codex.localAccess.health.recoverActionRetryOrRecover',
        '等待冷却结束后重试，或先恢复账号',
      );
    case 'refresh_quota_or_recover_accounts':
      return t(
        'codex.localAccess.health.recoverActionRefreshQuota',
        '刷新配额、调整号池或恢复账号后重试',
      );
    case 'recover_accounts_then_retry':
      return t(
        'codex.localAccess.health.recoverActionManual',
        '先在 Cockpit 中完成重新登录或人工恢复，再重试',
      );
    case 'add_account_or_enable_service':
      return t(
        'codex.localAccess.health.recoverActionAddAccount',
        '先添加账号或启用服务，再继续请求',
      );
    default:
      return recoverAction ?? null;
  }
}

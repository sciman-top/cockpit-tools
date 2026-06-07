import type { TFunction } from 'i18next';
import type { CodexLocalAccessRecentAuditEvent } from '../types/codexLocalAccess';

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

export function getCodexLocalAccessRecentAuditPhaseLabel(
  phase: string | null | undefined,
  t: TFunction,
): string {
  switch (phase) {
    case 'selector':
      return t('codex.localAccess.health.auditPhaseSelector', '调度选择');
    case 'pool_wait':
      return t('codex.localAccess.health.auditPhasePoolWait', '号池等待');
    case 'upstream_admitted':
      return t('codex.localAccess.health.auditPhaseUpstreamAdmitted', '上游接纳');
    case 'lease_granted':
      return t('codex.localAccess.health.auditPhaseLeaseGranted', '租约授予');
    case 'stream_completed':
      return t('codex.localAccess.health.auditPhaseStreamCompleted', '流完成');
    case 'stream_terminal':
      return t('codex.localAccess.health.auditPhaseStreamTerminal', '流终态');
    case 'stream_error':
      return t('codex.localAccess.health.auditPhaseStreamError', '流错误');
    case 'client_aborted':
      return t('codex.localAccess.health.auditPhaseClientAborted', '客户端中断');
    case 'manual_pause':
      return t('codex.localAccess.health.auditPhaseManualPause', '手动暂停');
    case 'manual_recovery':
      return t('codex.localAccess.health.auditPhaseManualRecovery', '手动恢复');
    case 'final_response':
      return t('codex.localAccess.health.auditPhaseFinalResponse', '最终响应');
    default:
      return phase ?? '--';
  }
}

export function getCodexLocalAccessRecentAuditHeadline(
  event: CodexLocalAccessRecentAuditEvent,
  t: TFunction,
): string {
  if (event.selectedReason) {
    return getCodexLocalAccessSelectorReasonLabel(event.selectedReason, t);
  }
  if (event.message?.trim()) {
    return event.message.trim();
  }
  const recoverAction = getCodexLocalAccessBlockedRecoverActionLabel(
    event.recoverAction,
    t,
  );
  if (recoverAction) {
    return recoverAction;
  }
  if (event.errorType?.trim()) {
    return event.errorType.trim();
  }
  if (event.outcome?.trim()) {
    return event.outcome.trim();
  }
  return getCodexLocalAccessRecentAuditPhaseLabel(event.phase, t);
}

export function formatCodexLocalAccessRequestIdShort(
  requestId: string,
  maxLength = 12,
): string {
  const trimmed = requestId.trim();
  if (!trimmed || trimmed.length <= maxLength) {
    return trimmed || '--';
  }
  return `${trimmed.slice(0, maxLength)}…`;
}

export function getCodexLocalAccessRequestIdSourceLabel(
  source: string | null | undefined,
  t: TFunction,
): string | null {
  switch (source) {
    case 'codex_turn_state':
      return t('codex.localAccess.health.requestIdSourceTurnState', 'X-Codex-Turn-State');
    case 'codex_turn_metadata_turn_id':
      return t(
        'codex.localAccess.health.requestIdSourceTurnMetadata',
        'X-Codex-Turn-Metadata.turn_id',
      );
    case 'client_request_id':
      return t('codex.localAccess.health.requestIdSourceClientRequest', 'X-Client-Request-Id');
    case 'x_request_id':
      return t('codex.localAccess.health.requestIdSourceXRequest', 'X-Request-Id');
    case 'request_id_header':
      return t('codex.localAccess.health.requestIdSourceRequestHeader', 'Request-Id');
    case 'openai_request_id':
      return t('codex.localAccess.health.requestIdSourceOpenAI', 'OpenAI-Request-Id');
    case 'manual':
      return t('codex.localAccess.health.requestIdSourceManual', 'Manual');
    default:
      return source ?? null;
  }
}

export function getCodexLocalAccessSessionAffinitySourceLabel(
  source: string | null | undefined,
  t: TFunction,
): string | null {
  switch (source) {
    case 'session_id':
      return t('codex.localAccess.health.sessionSourceSessionId', 'Session_id');
    case 'x_session_id':
      return t('codex.localAccess.health.sessionSourceXSessionId', 'X-Session-Id');
    case 'x_client_request_id':
      return t(
        'codex.localAccess.health.sessionSourceClientRequest',
        'X-Client-Request-Id',
      );
    case 'x_amp_thread_id':
      return t('codex.localAccess.health.sessionSourceAmpThread', 'X-Amp-Thread-Id');
    case 'metadata_user_id':
      return t('codex.localAccess.health.sessionSourceMetadataUser', 'metadata.user_id');
    case 'conversation_id':
      return t('codex.localAccess.health.sessionSourceConversationId', 'conversation_id');
    case 'thread_id':
      return t('codex.localAccess.health.sessionSourceThreadId', 'thread_id');
    default:
      return source ?? null;
  }
}

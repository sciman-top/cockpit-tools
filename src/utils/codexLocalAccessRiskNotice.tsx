import type { TFunction } from 'i18next';

const CODEX_LOCAL_ACCESS_RISK_NOTICE_DISMISSED_KEY =
  'agtools.codex.local_access.risk_notice.dismissed.v2';

export type CodexLocalAccessRiskNoticeAction = 'service' | 'switch' | 'activate';

export function isCodexLocalAccessRiskNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(CODEX_LOCAL_ACCESS_RISK_NOTICE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setCodexLocalAccessRiskNoticeDismissed(value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(CODEX_LOCAL_ACCESS_RISK_NOTICE_DISMISSED_KEY, '1');
      return;
    }
    localStorage.removeItem(CODEX_LOCAL_ACCESS_RISK_NOTICE_DISMISSED_KEY);
  } catch {
    // ignore storage write failures
  }
}

export function getCodexLocalAccessRiskNoticeConfirmLabel(
  action: CodexLocalAccessRiskNoticeAction,
  t: TFunction,
): string {
  if (action === 'activate') {
    return t('codex.localAccess.riskNotice.enableAndSwitch', '启用并切号');
  }
  if (action === 'switch') {
    return t('codex.localAccess.riskNotice.continueSwitch', '继续切号');
  }
  if (action === 'service') {
    return t('codex.localAccess.riskNotice.continueStart', '继续启动');
  }
  return t('common.confirm', '确认');
}

export function getCodexLocalAccessRiskNoticeLeadMessage(
  action: CodexLocalAccessRiskNoticeAction,
  t: TFunction,
): string | null {
  if (action === 'activate') {
    return t(
      'codex.localAccess.riskNotice.activateLead',
      '本次操作会先启用 API 服务，再把 Codex 切换到 API 服务模式。',
    );
  }
  if (action === 'switch') {
    return t(
      'codex.localAccess.riskNotice.switchLead',
      '本次操作会把 Codex 切换到 API 服务模式。',
    );
  }
  if (action === 'service') {
    return t(
      'codex.localAccess.riskNotice.serviceLead',
      '本次操作会启用 API 服务。',
    );
  }
  return null;
}

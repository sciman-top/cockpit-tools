import type { TFunction } from 'i18next';
import type {
  CodexSessionVisibilityDiagnosticSummary,
  CodexSessionVisibilityRepairSummary,
} from '../types/codex';

export function getCodexSessionVisibilityDiagnosticRepairableCount(
  summary: CodexSessionVisibilityDiagnosticSummary,
): number {
  return summary.repairableMetadataCount + summary.workspaceRepairCount;
}

export function formatCodexSessionVisibilityDiagnosticMessage(
  summary: CodexSessionVisibilityDiagnosticSummary,
  t: TFunction,
): string {
  const repairableCount = getCodexSessionVisibilityDiagnosticRepairableCount(summary);
  if (repairableCount > 0) {
    return t(
      'codex.sessionManager.messages.visibilityDiagnosticRepairable',
      '检测到 {{repairable}} 项可自动修复的会话可见性差异：provider/SQLite {{metadata}} 项，工作区索引 {{workspace}} 项。',
      {
        repairable: repairableCount,
        metadata: summary.repairableMetadataCount,
        workspace: summary.workspaceRepairCount,
      },
    );
  }

  if (summary.workspaceFilteredThreadCount > 0) {
    return t(
      'codex.sessionManager.messages.visibilityDiagnosticWorkspaceFiltered',
      '未发现可自动写入的 provider 或工作区索引差异；有 {{count}} 条会话的 cwd 不在当前 active workspace roots 中，可能被当前项目视图过滤。',
      { count: summary.workspaceFilteredThreadCount },
    );
  }

  if (summary.skippedSqliteFileCount > 0) {
    return t(
      'codex.sessionManager.messages.visibilityDiagnosticSkippedSqliteOnly',
      '未发现可自动写入的会话可见性差异；已跳过 {{count}} 个无效或损坏的 state_5.sqlite。',
      { count: summary.skippedSqliteFileCount },
    );
  }

  return summary.message;
}

export function formatCodexSessionVisibilityRepairMessage(
  summary: CodexSessionVisibilityRepairSummary,
  t: TFunction,
): string {
  if (summary.skippedSqliteFileCount <= 0) {
    return summary.message;
  }

  if (summary.mutatedInstanceCount === 0) {
    return t(
      'codex.sessionManager.messages.repairVisibilitySkippedOnly',
      '未发现需要写入的 provider 差异；已跳过 {{count}} 个无效或损坏的 state_5.sqlite，需由 Codex 重新生成后才能修复其中的 SQLite 记录',
      { count: summary.skippedSqliteFileCount },
    );
  }

  return t(
    'codex.sessionManager.messages.repairVisibilitySkippedWithBase',
    '{{message}}；已跳过 {{count}} 个无效或损坏的 state_5.sqlite，需由 Codex 重新生成后才能修复其中的 SQLite 记录',
    { message: summary.message, count: summary.skippedSqliteFileCount },
  );
}

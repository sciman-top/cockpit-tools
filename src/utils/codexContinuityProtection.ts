const CODEX_CONTINUITY_PROTECTION_ERROR_MARKER =
  "Codex 连续性保护窗口内已阻止切换";

export function getErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isCodexContinuityProtectionError(error: unknown): boolean {
  return getErrorText(error).includes(CODEX_CONTINUITY_PROTECTION_ERROR_MARKER);
}

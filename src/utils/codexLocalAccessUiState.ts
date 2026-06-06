import type { CodexRuntimeModeState } from "../types/codexLocalAccess";

export type CodexLocalAccessPrimaryActionKind = "activate" | "deactivate";
export type CodexLocalAccessPrimaryActionLabelKind =
  | "activate"
  | "deactivate"
  | "switch";

export function isCodexLocalAccessRuntimeActive(
  localAccessLaunchCurrent: boolean,
  runtimeMode: CodexRuntimeModeState | null | undefined,
): boolean {
  void localAccessLaunchCurrent;
  return Boolean(runtimeMode?.mode === "cockpit_api_service");
}

export function getCodexLocalAccessPrimaryActionKind(
  localAccessLaunchCurrent: boolean,
  runtimeMode: CodexRuntimeModeState | null | undefined,
): CodexLocalAccessPrimaryActionKind {
  return isCodexLocalAccessRuntimeActive(localAccessLaunchCurrent, runtimeMode)
    ? "deactivate"
    : "activate";
}

export function getCodexLocalAccessPrimaryActionLabelKind(
  localAccessLaunchCurrent: boolean,
  runtimeMode: CodexRuntimeModeState | null | undefined,
  localAccessRunning: boolean,
): CodexLocalAccessPrimaryActionLabelKind {
  const actionKind = getCodexLocalAccessPrimaryActionKind(
    localAccessLaunchCurrent,
    runtimeMode,
  );
  if (actionKind === "deactivate") {
    return "deactivate";
  }
  return localAccessRunning ? "switch" : "activate";
}

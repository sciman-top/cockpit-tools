export function isTauriRuntimeAvailable(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  if ((window as Window & { __COCKPIT_BROWSER_PREVIEW__?: boolean }).__COCKPIT_BROWSER_PREVIEW__) {
    return false;
  }

  const candidate = (window as Window & {
    __TAURI__?: {
      core?: {
        invoke?: unknown;
      };
      metadata?: unknown;
    };
    __TAURI_INTERNALS__?: {
      invoke?: unknown;
    };
  }).__TAURI__;
  const internals = (window as Window & {
    __TAURI_INTERNALS__?: {
      invoke?: unknown;
    };
  }).__TAURI_INTERNALS__;

  return (
    typeof candidate?.core?.invoke === 'function' ||
    typeof internals?.invoke === 'function'
  );
}

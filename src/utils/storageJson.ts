export function parseJsonOrNull<T>(
  raw: string | null | undefined,
  onError?: (error: unknown) => void,
): T | null {
  if (raw == null || raw.trim() === '') {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    onError?.(error);
    return null;
  }
}

export function loadJsonFromLocalStorage<T>(
  key: string,
  onError?: (error: unknown) => void,
): T | null {
  try {
    const raw = localStorage.getItem(key);
    return parseJsonOrNull<T>(raw, (error) => {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore cleanup failures
      }
      onError?.(error);
    });
  } catch (error) {
    onError?.(error);
    return null;
  }
}

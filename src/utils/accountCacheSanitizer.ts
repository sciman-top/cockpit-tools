const SENSITIVE_CACHE_FIELD_NAMES = new Set([
  'accesstoken',
  'apikey',
  'authtoken',
  'clientsecret',
  'credential',
  'credentials',
  'idtoken',
  'openaiapikey',
  'password',
  'refreshtoken',
  'secret',
  'tokens',
]);

function normalizeCacheFieldName(key: string): string {
  return key.replace(/[^a-z0-9]/giu, '').toLowerCase();
}

function sanitizeValueForLocalCache(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeValueForLocalCache);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const source = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (SENSITIVE_CACHE_FIELD_NAMES.has(normalizeCacheFieldName(key))) {
      continue;
    }
    sanitized[key] = sanitizeValueForLocalCache(child);
  }
  return sanitized;
}

export function sanitizeAccountForLocalCache<TAccount>(account: TAccount): TAccount {
  return sanitizeValueForLocalCache(account) as TAccount;
}

export function sanitizeAccountsForLocalCache<TAccount>(accounts: TAccount[]): TAccount[] {
  return accounts.map((account) => sanitizeAccountForLocalCache(account));
}

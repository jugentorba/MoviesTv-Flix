/**
 * Reads the tokens Supabase puts in a password-recovery link.
 *
 * A recovery email redirects to `moviestvflix://auth/reset#access_token=…&
 * refresh_token=…&type=recovery`. The native layer has no browser to parse the
 * fragment, so the app adopts the session itself instead of asking the user to
 * repeat the flow in a browser.
 */

export interface RecoveryTokens {
  accessToken: string;
  refreshToken: string;
}

const MAX_TOKEN_LENGTH = 4_096;

function safeToken(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_TOKEN_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function searchParams(fragment: string): URLSearchParams | null {
  if (!fragment) return null;
  try {
    return new URLSearchParams(fragment);
  } catch {
    return null;
  }
}

export function parseRecoveryTokens(url: string): RecoveryTokens | null {
  const raw = url?.trim();
  if (!raw) return null;

  const hashIndex = raw.indexOf('#');
  const queryIndex = raw.indexOf('?');
  const hash = hashIndex >= 0 ? raw.slice(hashIndex + 1) : '';
  const queryEnd = hashIndex >= 0 ? hashIndex : raw.length;
  const query = queryIndex >= 0 ? raw.slice(queryIndex + 1, queryEnd) : '';

  const candidates = [searchParams(hash), searchParams(query)];
  for (const params of candidates) {
    if (!params) continue;
    const accessToken = safeToken(params.get('access_token'));
    const refreshToken = safeToken(params.get('refresh_token'));
    if (accessToken && refreshToken) {
      return { accessToken, refreshToken };
    }
  }
  return null;
}

/** `recovery`, `signup`, `invite` …; null when the link carries no type. */
export function authLinkType(url: string): string | null {
  const raw = url?.trim();
  if (!raw) return null;
  const hashIndex = raw.indexOf('#');
  const queryIndex = raw.indexOf('?');
  const hash = hashIndex >= 0 ? raw.slice(hashIndex + 1) : '';
  const queryEnd = hashIndex >= 0 ? hashIndex : raw.length;
  const query = queryIndex >= 0 ? raw.slice(queryIndex + 1, queryEnd) : '';

  for (const fragment of [hash, query]) {
    if (!fragment) continue;
    const type = safeToken(new URLSearchParams(fragment).get('type'));
    if (type) return type;
  }
  return null;
}

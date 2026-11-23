export interface SupabaseEnvironment {
  EXPO_PUBLIC_SUPABASE_URL?: string;
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  EXPO_PUBLIC_PREVIEW_MODE?: string;
}

export type SupabaseConfigResult =
  | { ok: true; url: string; publishableKey: string }
  | { ok: false; reason: 'backend-not-configured' };

export function shouldLoadStoredSupabaseConfig(
  explicitEnvironment: boolean,
  buildConfigured: boolean,
): boolean {
  return !explicitEnvironment && !buildConfigured;
}

export function shouldFetchRuntimeSupabaseConfig(
  platform: string,
  explicitEnvironment: boolean,
  buildConfigured: boolean,
): boolean {
  return platform === 'web'
    && shouldLoadStoredSupabaseConfig(
      explicitEnvironment,
      buildConfigured,
    );
}

export function isPreviewMode(environment: SupabaseEnvironment): boolean {
  const value = environment.EXPO_PUBLIC_PREVIEW_MODE?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

function safeSupabaseUrl(value: string | undefined): string | null {
  const raw = value?.trim();
  if (
    !raw
    || raw.length > 2_048
    || /[\u0000-\u001f\u007f]/.test(raw)
  ) return null;

  try {
    const url = new URL(raw);
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '');
    const localHttp = url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '::1'].includes(hostname);
    if (
      (url.protocol !== 'https:' && !localHttp)
      || Boolean(url.username)
      || Boolean(url.password)
      || Boolean(url.search)
      || Boolean(url.hash)
    ) {
      return null;
    }
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string | null {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return null;

  if (base64.length % 4 === 1) return null;
  const padded = base64.padEnd(
    Math.ceil(base64.length / 4) * 4,
    '=',
  );
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';

  for (let index = 0; index < padded.length; index += 4) {
    const chunk = padded.slice(index, index + 4);
    const values = [...chunk].map((character) => (
      character === '=' ? 0 : alphabet.indexOf(character)
    ));
    if (
      values.length !== 4
      || values.some((item, itemIndex) => (
        item < 0 && chunk[itemIndex] !== '='
      ))
    ) return null;

    const combined = (
      (values[0]! << 18)
      | (values[1]! << 12)
      | (values[2]! << 6)
      | values[3]!
    );
    output += String.fromCharCode((combined >> 16) & 0xff);
    if (chunk[2] !== '=') {
      output += String.fromCharCode((combined >> 8) & 0xff);
    }
    if (chunk[3] !== '=') {
      output += String.fromCharCode(combined & 0xff);
    }
  }

  return output;
}

function jwtRole(value: string): string | null {
  const parts = value.split('.');
  if (parts.length !== 3) return null;

  try {
    const decoded = decodeBase64Url(parts[1]!);
    if (!decoded) return null;
    const payload = JSON.parse(decoded) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

function localSupabaseUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '');
    return ['localhost', '127.0.0.1', '::1'].includes(hostname);
  } catch {
    return false;
  }
}

function safePublishableKey(
  value: string | undefined,
  allowDevelopmentKey = false,
): string | null {
  const key = value?.trim();
  if (
    !key
    || key.length > 8_192
    || /[\u0000-\u001f\u007f]/.test(key)
  ) return null;
  if (/^sb_secret_/i.test(key)) return null;
  if (/service[-_]?role/i.test(key)) return null;

  const jwt = key.split('.').length === 3;
  if (jwt) return jwtRole(key) === 'anon' ? key : null;
  if (/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key)) return key;
  return allowDevelopmentKey ? key : null;
}

export function readSupabaseConfig(
  environment: SupabaseEnvironment,
): SupabaseConfigResult {
  const url = safeSupabaseUrl(environment.EXPO_PUBLIC_SUPABASE_URL);
  const publishableKey = safePublishableKey(
    environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    localSupabaseUrl(url),
  );
  return url && publishableKey
    ? { ok: true, url, publishableKey }
    : { ok: false, reason: 'backend-not-configured' };
}


interface RuntimeConfigResponseLike {
  ok: boolean;
  headers: {
    get(name: string): string | null;
  };
  text(): Promise<string>;
}

export type RuntimeConfigFetcher = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<RuntimeConfigResponseLike>;

const MAX_RUNTIME_CONFIG_BYTES = 16_384;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800
      && code <= 0xdbff
      && index + 1 < value.length
    ) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function fetchRuntimeSupabaseConfig(
  fetcher: RuntimeConfigFetcher,
  endpoint = '/api/runtime-config',
  timeoutMs = 5_000,
): Promise<SupabaseConfigResult> {
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.min(Math.trunc(timeoutMs), 30_000)
    : 5_000;
  const controller = typeof AbortController === 'function'
    ? new AbortController()
    : null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    const operation = (async (): Promise<SupabaseConfigResult> => {
      const response = await fetcher(endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response.ok) {
        return { ok: false, reason: 'backend-not-configured' };
      }

      const declaredLength = response.headers.get('content-length');
      if (declaredLength) {
        const normalizedLength = declaredLength.trim();
        if (!/^\d+$/.test(normalizedLength)) {
          return { ok: false, reason: 'backend-not-configured' };
        }
        const parsedLength = Number(normalizedLength);
        if (
          !Number.isSafeInteger(parsedLength)
          || parsedLength > MAX_RUNTIME_CONFIG_BYTES
        ) {
          return { ok: false, reason: 'backend-not-configured' };
        }
      }

      const contentType = response.headers
        .get('content-type')
        ?.toLowerCase() ?? '';
      if (contentType.includes('text/html')) {
        return { ok: false, reason: 'backend-not-configured' };
      }

      const body = await response.text();
      if (utf8ByteLength(body) > MAX_RUNTIME_CONFIG_BYTES) {
        return { ok: false, reason: 'backend-not-configured' };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body) as unknown;
      } catch {
        return { ok: false, reason: 'backend-not-configured' };
      }

      const payload = recordOf(parsed);
      if (!payload) {
        return { ok: false, reason: 'backend-not-configured' };
      }

      return readSupabaseConfig({
        EXPO_PUBLIC_SUPABASE_URL: typeof payload.supabaseUrl === 'string'
          ? payload.supabaseUrl
          : undefined,
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          typeof payload.supabasePublishableKey === 'string'
            ? payload.supabasePublishableKey
            : undefined,
      });
    })();

    const timeout = new Promise<SupabaseConfigResult>((resolve) => {
      timer = setTimeout(() => {
        controller?.abort();
        resolve({ ok: false, reason: 'backend-not-configured' });
      }, safeTimeoutMs);
    });

    return await Promise.race([operation, timeout]);
  } catch {
    return { ok: false, reason: 'backend-not-configured' };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

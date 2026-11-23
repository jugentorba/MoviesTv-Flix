export interface CatalogEnvironment {
  EXPO_PUBLIC_CATALOG_BASE_URL?: string;
  EXPO_PUBLIC_PREVIEW_MODE?: string;
  EXPO_PUBLIC_DEMO_CATALOG?: string;
}

export type CatalogConfig =
  | { mode: 'installed'; baseUrl: null }
  | { mode: 'demo'; baseUrl: null }
  | { mode: 'remote'; baseUrl: string };

function enabled(value?: string): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

const MAX_REMOTE_CATALOG_URL_LENGTH = 2_048;

function safeRemoteCatalogUrl(
  value: string | undefined,
): string | null {
  const input = value?.trim();
  if (
    !input
    || input.length > MAX_REMOTE_CATALOG_URL_LENGTH
    || /[\u0000-\u001f\u007f]/.test(input)
  ) return null;

  try {
    const url = new URL(input);
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '');
    const localHttp = (
      url.protocol === 'http:'
      && (
        hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '::1'
      )
    );

    if (
      (url.protocol !== 'https:' && !localHttp)
      || Boolean(url.username)
      || Boolean(url.password)
      || Boolean(url.search)
      || Boolean(url.hash)
    ) {
      return null;
    }

    const normalized = url.href.replace(/\/+$/, '');
    return normalized.length <= MAX_REMOTE_CATALOG_URL_LENGTH
      ? normalized
      : null;
  } catch {
    return null;
  }
}

export function getCatalogConfig(
  env: CatalogEnvironment,
): CatalogConfig {
  const remote = safeRemoteCatalogUrl(
    env.EXPO_PUBLIC_CATALOG_BASE_URL,
  );
  if (remote) {
    return { mode: 'remote', baseUrl: remote };
  }

  if (enabled(env.EXPO_PUBLIC_DEMO_CATALOG)) {
    return { mode: 'demo', baseUrl: null };
  }

  // Production starts without a bundled catalog. Catalogs are supplied by
  // the user through the add-on/provider system.
  return { mode: 'installed', baseUrl: null };
}

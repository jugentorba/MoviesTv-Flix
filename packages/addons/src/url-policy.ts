export type AddonInstallOrigin = 'manual' | 'curated';

export const MAX_PROVIDER_URL_LENGTH = 8_192;

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function isLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '::1') return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  return false;
}

function isPrivateIpv4(hostname: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return false;
  const [a, b, c, d] = match.slice(1).map(Number);
  if ([a, b, c, d].some((part) => part < 0 || part > 255)) return false;
  return a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function isPrivateIpv6(hostname: string): boolean {
  return hostname === '::1'
    || /^f[cd][0-9a-f]{2}:/i.test(hostname)
    || /^fe[89ab][0-9a-f]:/i.test(hostname);
}

export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return isLoopbackHost(normalized) || isPrivateIpv4(normalized) || isPrivateIpv6(normalized);
}

function normalizeSharedProviderScheme(input: string): string {
  const trimmed = input.trim();
  if (!/^stremio:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.slice('stremio://'.length)}`;
}

export function assertRemoteProviderUrl(input: string, origin: AddonInstallOrigin): URL {
  const normalizedInput = normalizeSharedProviderScheme(input);
  if (
    !normalizedInput
    || normalizedInput.length > MAX_PROVIDER_URL_LENGTH
  ) {
    throw new Error('Provider URL is too long');
  }

  let url: URL;
  try {
    url = new URL(normalizedInput);
  } catch {
    throw new Error('Invalid provider URL');
  }
  if (url.toString().length > MAX_PROVIDER_URL_LENGTH) {
    throw new Error('Provider URL is too long');
  }

  if (url.username || url.password) throw new Error('Provider URLs cannot contain credentials');

  const hostname = normalizedHostname(url);
  const isHttps = url.protocol === 'https:';
  const isManualLoopbackHttp = origin === 'manual' && url.protocol === 'http:' && isLoopbackHost(hostname);
  if (!isHttps && !isManualLoopbackHttp) {
    throw new Error('Provider URL must use HTTPS');
  }

  if (origin === 'curated' && isPrivateOrLoopbackHost(hostname)) {
    throw new Error('Curated providers cannot target private network addresses');
  }

  return url;
}

export function normalizeManifestUrl(input: string, origin: AddonInstallOrigin): string {
  const url = assertRemoteProviderUrl(input, origin);
  url.hash = '';

  if (!url.pathname.endsWith('/manifest.json') && url.pathname !== '/manifest.json') {
    const basePath = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
    url.pathname = `${basePath || ''}/manifest.json`;
  }

  const normalized = url.toString();
  if (normalized.length > MAX_PROVIDER_URL_LENGTH) {
    throw new Error('Provider URL is too long');
  }
  return normalized;
}

function validNuvioConfigSegment(segment: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return false;
  }

  let config: unknown;
  try {
    config = JSON.parse(decoded);
  } catch {
    return false;
  }

  if (
    typeof config !== 'object'
    || config === null
    || Array.isArray(config)
  ) return false;

  const entries = Object.entries(config);
  if (!entries.length || entries.length > 2) return false;

  const allowedKeys = new Set(['language', 'region']);
  return entries.every(([key, value]) => {
    if (!allowedKeys.has(key) || typeof value !== 'string') return false;
    const normalized = value.trim();
    if (
      !normalized
      || normalized.length > 64
      || /[\u0000-\u001f\u007f]/.test(normalized)
    ) return false;

    return key === 'language'
      ? /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(normalized)
      : /^(?:[A-Za-z]{2}|[0-9]{3})$/.test(normalized);
  });
}

export function nuvioWebCatalogBaseUrl(manifestUrl: string): string | undefined {
  try {
    const url = new URL(manifestUrl);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.search
      || url.hash
      || url.hostname.toLowerCase() !== 'catalog.nuvio.tv'
    ) return undefined;

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.at(-1) !== 'manifest.json') return undefined;
    segments.pop();

    if (
      segments.length > 1
      || (segments.length === 1 && !validNuvioConfigSegment(segments[0]!))
    ) return undefined;

    return segments.length
      ? `/api/nuvio-catalog/${segments[0]}`
      : '/api/nuvio-catalog';
  } catch {
    return undefined;
  }
}

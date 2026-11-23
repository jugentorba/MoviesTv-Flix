function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodesToConfig(segment: string): boolean {
  try {
    return isRecord(JSON.parse(decodeURIComponent(segment)));
  } catch {
    return false;
  }
}

export function isSafePublicConfiguredManifestUrl(
  manifestUrl: string | undefined,
): boolean {
  if (!manifestUrl) return false;

  try {
    const url = new URL(manifestUrl);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.search
      || url.hash
    ) return false;

    // TvVoo exposes country-only presets as public, non-credential routes such
    // as /cfg-fr-al-bk/manifest.json. Keep this deliberately host- and
    // shape-specific: MediaFlow/password flags (mfu_*, mfp_*, cln, etc.) do
    // not match and therefore remain device-local.
    return url.hostname.toLowerCase() === 'tvvoo.hayd.uk'
      && /^\/cfg-(?:[a-z]{2})(?:-[a-z]{2})*\/manifest\.json$/i.test(
        url.pathname,
      );
  } catch {
    return false;
  }
}

export function buildStremioConfiguredManifestUrl(
  manifestUrl: string,
  config: Record<string, unknown>,
): string {
  const url = new URL(manifestUrl);
  url.search = '';
  url.hash = '';

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.at(-1) !== 'manifest.json') {
    throw new Error('Provider manifest URL is invalid');
  }
  segments.pop();

  // Standard Stremio SDK configured URLs insert one JSON path segment
  // immediately before manifest.json. Replace it when already present.
  if (segments.length && decodesToConfig(segments.at(-1)!)) {
    segments.pop();
  }

  const encodedConfig = encodeURIComponent(JSON.stringify(config));
  url.pathname = `/${[...segments, encodedConfig, 'manifest.json'].join('/')}`;
  return url.toString();
}


export function stremioPublicBaseManifestUrl(
  manifestUrl: string,
): string | undefined {
  try {
    const url = new URL(manifestUrl);
    url.search = '';
    url.hash = '';

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.at(-1) !== 'manifest.json') return undefined;
    segments.pop();

    if (segments.length && decodesToConfig(segments.at(-1)!)) {
      segments.pop();
    }

    url.pathname = `/${[...segments, 'manifest.json'].join('/')}`;
    return url.toString();
  } catch {
    return undefined;
  }
}

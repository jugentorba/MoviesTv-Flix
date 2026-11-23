import { stableTextCompare, type StreamSource } from '@moviestv/core';

function fnv1a(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function transportIdentity(source: StreamSource): string {
  const contentType = source.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const filename = source.filename?.trim().toLowerCase() ?? '';
  const extension = filename.match(/\.([a-z0-9]{2,8})$/i)?.[1] ?? '';
  const codec = source.codec?.trim().toLowerCase() ?? '';
  const codecDetail = source.codecDetail?.trim().toLowerCase() ?? '';
  const audioCodec = source.audioCodec?.trim().toLowerCase() ?? '';
  const dynamicRange = source.dynamicRange?.trim().toLowerCase() ?? '';
  const webReady = source.webReady === true
    ? '1'
    : source.webReady === false
      ? '0'
      : '';

  return [
    contentType,
    extension,
    codec,
    codecDetail,
    audioCodec,
    dynamicRange,
    webReady,
  ].join('\u0000');
}

function canonicalSourceIdentity(source: StreamSource): string {
  let url = source.url.trim();
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    url = parsed.toString();
  } catch {
    // Playback sources are validated before reaching the player. Keep the
    // trimmed value here so this helper remains safe for defensive callers.
  }

  const headers = Object.entries(source.headers ?? {})
    .flatMap(([rawName, rawValue]) => {
      if (typeof rawValue !== 'string') return [];
      const name = rawName.trim().toLowerCase();
      const value = rawValue.trim();
      return name && value ? [[name, value] as const] : [];
    })
    .sort(([leftName, leftValue], [rightName, rightValue]) => (
      stableTextCompare(leftName, rightName)
      || stableTextCompare(leftValue, rightValue)
    ))
    .map(([name, value]) => `${name}:${value}`)
    .join('\n');

  return `${url}\u0000${headers}\u0000${transportIdentity(source)}`;
}

/**
 * Stable, opaque identity for one runtime playback source.
 *
 * The source URL/query and request-header values may contain short-lived
 * credentials. React keys and diagnostic state should not carry those values
 * in readable form, while still changing when the actual request changes.
 */
export function playbackSourceFingerprint(
  source: StreamSource,
): string {
  const canonical = canonicalSourceIdentity(source);
  const first = fnv1a(canonical, 0x811c9dc5).toString(36);
  const second = fnv1a(canonical, 0x9e3779b9).toString(36);
  return `source-${first}-${second}-${canonical.length.toString(36)}`;
}

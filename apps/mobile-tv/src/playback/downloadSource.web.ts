import type { StreamSource } from '@moviestv/core';
import type { OfflineMediaSnapshot } from '../downloads/offlineDownloadMetadata';

function boundedMetadataText(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== 'string' || value.length > maxLength) {
    return undefined;
  }
  const normalized = value.trim();
  if (
    !normalized
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function safeUrlDerivedFileName(value: unknown): string | undefined {
  if (
    typeof value !== 'string'
    || value.length > 8_192
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return undefined;

  try {
    const url = new URL(value);
    const encoded = url.pathname.split('/').filter(Boolean).at(-1);
    if (!encoded) return undefined;
    const decoded = decodeURIComponent(encoded).trim();
    if (
      !decoded
      || decoded.length > 180
      || /[\\/\u0000-\u001f\u007f]/.test(decoded)
    ) return undefined;

    const match = decoded.match(/^(.+)\.([a-z0-9]{2,5})$/i);
    if (!match?.[1]) return undefined;
    const stem = match[1];
    if (
      /^(?:access[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|sig|credential|session|debrid|alldebrid|realdebrid)(?:=|:).+/i.test(stem)
      || /[={}\[\]"'<>]/.test(stem)
      || stem.includes('=')
      || /^[a-f0-9]{24,}$/i.test(stem)
      || /^[A-Za-z0-9_-]{32,}$/.test(stem)
    ) return undefined;

    return decoded;
  } catch {
    return undefined;
  }
}

function sourceExtension(source: StreamSource): string {
  const filename = boundedMetadataText(source.filename, 2_000);
  const filenameMatch = filename?.match(/\.([a-z0-9]{2,5})$/i);
  if (filenameMatch) return `.${filenameMatch[1].toLowerCase()}`;

  const { url } = source;
  if (
    typeof url === 'string'
    && url.length <= 8_192
    && !/[\u0000-\u001f\u007f]/.test(url)
  ) {
    try {
      const parsed = new URL(url);
      const match = decodeURIComponent(parsed.pathname)
        .match(/\.([a-z0-9]{2,5})$/i);
      if (match) return `.${match[1].toLowerCase()}`;

      for (const [name, value] of parsed.searchParams) {
        if (!/format|type|mime|content|container|filename|file|stream|url|src|source|playlist|media/i.test(name)) continue;
        const nested = value.match(/\.([a-z0-9]{2,5})(?:$|[?#])/i);
        if (nested) return `.${nested[1].toLowerCase()}`;
      }
    } catch {
      // Fall through to trusted MIME metadata.
    }
  }

  const contentType = source.contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType === 'video/webm') return '.webm';
  if (contentType === 'video/x-m4v') return '.m4v';
  if (contentType === 'video/quicktime') return '.mov';
  if (contentType === 'video/mp4') return '.mp4';
  return '';
}

export function webDownloadFileName(source: StreamSource, titleHint?: string): string {
  const fallback = 'MoviesTv-Flix-download';
  const safeTitle = boundedMetadataText(titleHint, 500);
  const safeQuality = boundedMetadataText(source.quality, 128);
  const safeName = boundedMetadataText(source.name, 500);
  const raw = (safeTitle
    ? [safeTitle, safeQuality].filter(Boolean).join(' - ')
    : safeName)
    || safeUrlDerivedFileName(source.url)
    || fallback;

  const cleaned = raw.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 180) || fallback;
  if (/\.[a-z0-9]{2,5}$/i.test(cleaned)) return cleaned;
  return `${cleaned}${sourceExtension(source)}`;
}

function safeSourceId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized
    && normalized.length <= 512
    && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : null;
}

function safeDownloadUrl(
  value: unknown,
  httpsOnly: boolean,
): URL | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > 8_192
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) return null;

  try {
    const url = new URL(normalized);
    if (
      (httpsOnly
        ? url.protocol !== 'https:'
        : url.protocol !== 'https:' && url.protocol !== 'http:')
      || url.username
      || url.password
      || url.href.length > 8_192
    ) return null;
    return url;
  } catch {
    return null;
  }
}

function isAdaptiveManifestDownload(
  source: StreamSource,
  url: URL,
): boolean {
  const contentType = source.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (
    /^(?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl|mpegurl|dash\+xml)|audio\/(?:mpegurl|x-mpegurl))$/i.test(
      contentType,
    )
  ) return true;

  const filename = boundedMetadataText(source.filename, 2_000) ?? '';
  if (/\.(?:m3u8|mpd)$/i.test(filename)) return true;
  if (/\.(?:m3u8|mpd)$/i.test(url.pathname)) return true;

  for (const [name, value] of url.searchParams) {
    if (!/format|type|mime|content|container|filename|file|stream|url|src|source|playlist|media/i.test(name)) continue;
    if (/m3u8|mpegurl|\bhls\b|\bmpd\b|\bdash\b/i.test(value)) return true;
  }

  return false;
}

export function canDownloadSource(source: StreamSource): boolean {
  if (!safeSourceId(source.id)) return false;
  const url = safeDownloadUrl(source.url, true);
  if (!url) return false;

  const adaptiveManifest = isAdaptiveManifestDownload(source, url);
  let protectedRequest = false;
  if (source.headers) {
    for (const name in source.headers) {
      if (Object.prototype.hasOwnProperty.call(source.headers, name)) {
        protectedRequest = true;
        break;
      }
    }
  }
  const filename = boundedMetadataText(source.filename, 2_000) ?? '';
  const unsupportedContainer =
    /\.(?:mkv|avi)$/i.test(url.pathname)
    || /\.(?:mkv|avi)$/i.test(filename);
  return !adaptiveManifest && !protectedRequest && !unsupportedContainer;
}

export async function downloadSource(
  source: StreamSource,
  onProgress?: (progress: number | null) => void,
  titleHint?: string,
  _media?: OfflineMediaSnapshot,
): Promise<void> {
  const url = safeDownloadUrl(source.url, true);
  if (!url || !canDownloadSource(source)) {
    throw new Error('This source cannot be downloaded in the browser');
  }
  onProgress?.(null);
  const anchor = document.createElement('a');
  anchor.href = url.href;
  anchor.download = webDownloadFileName(source, titleHint);
  anchor.rel = 'noopener noreferrer';
  anchor.target = '_blank';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  onProgress?.(1);
}

import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import type { StreamSource } from '@moviestv/core';
import {
  buildOfflineDownloadMetadata,
  canReadOfflineMetadataFile,
  OFFLINE_PARTIAL_SUFFIX,
  offlineMetadataFileName,
  offlineMetadataMatchesFile,
  parseOfflineDownloadMetadata,
  type OfflineMediaSnapshot,
} from '../downloads/offlineDownloadMetadata';
import {
  offlineDownloadScopePath,
  type OfflineDownloadScope,
} from '../downloads/offlineDownloadScope';

export interface ControlledDownloadHandle {
  promise: Promise<void>;
  fileName?: string;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): void;
}

function urlExtension(url: string): string | undefined {
  if (
    typeof url !== 'string'
    || url.length > 8_192
    || /[\u0000-\u001f\u007f]/.test(url)
  ) return undefined;

  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname);
    const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (match) return `.${match[1].toLowerCase()}`;

    for (const [name, value] of parsed.searchParams) {
      if (!/format|type|mime|content|container|filename|file|stream|url|src|source|playlist|media/i.test(name)) continue;
      const nested = value.match(/\.([a-z0-9]{2,5})(?:$|[?#])/i);
      if (nested) return `.${nested[1].toLowerCase()}`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

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
  const safeFilename = boundedMetadataText(source.filename, 2_000);
  const filenameMatch = safeFilename?.match(/\.([a-z0-9]{2,5})$/i);
  if (filenameMatch) return `.${filenameMatch[1].toLowerCase()}`;

  const url = urlExtension(source.url);
  if (url) return url;

  const contentType = source.contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType === 'video/webm') return '.webm';
  if (contentType === 'video/x-m4v') return '.m4v';
  if (contentType === 'video/quicktime') return '.mov';
  if (contentType === 'video/mp4') return '.mp4';

  return '.mp4';
}

function baseFileName(source: StreamSource, titleHint?: string): string {
  const safeTitle = boundedMetadataText(titleHint, 500);
  const safeQuality = boundedMetadataText(source.quality, 128);
  const safeLanguage = boundedMetadataText(
    source.audioLanguages?.[0] ?? source.language,
    128,
  );
  const safeProviderId = boundedMetadataText(source.providerId, 512);
  const safeSourceName = boundedMetadataText(source.name, 500);
  let candidate = safeTitle
    ? [
        safeTitle,
        safeQuality,
        safeLanguage?.toUpperCase(),
        safeProviderId,
      ].filter(Boolean).join(' - ')
    : safeSourceName;
  if (!candidate) {
    candidate = safeUrlDerivedFileName(source.url) ?? '';
  }

  const cleaned = (candidate || 'movie')
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 150);

  const safe = cleaned || 'movie';
  if (/\.[a-z0-9]{2,5}$/i.test(safe)) return safe;
  return `${safe}${sourceExtension(source)}`;
}

function mediaIdHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function mediaScopedFileName(
  baseName: string,
  media?: OfflineMediaSnapshot,
): string {
  const mediaId = boundedMetadataText(media?.mediaId, 512);
  if (!mediaId) return baseName;

  const extension = baseName.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? '';
  const stem = extension
    ? baseName.slice(0, -extension.length)
    : baseName;
  const readableId = mediaId
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36) || 'media';
  return `${stem} - ${readableId}-${mediaIdHash(mediaId)}${extension}`;
}

export function nativeDownloadFileName(
  source: StreamSource,
  titleHint?: string,
  media?: OfflineMediaSnapshot,
): string {
  return mediaScopedFileName(
    baseFileName(source, titleHint),
    media,
  );
}

function existingDownloadMatches(
  file: File,
  metadataFile: File,
  media?: OfflineMediaSnapshot,
): boolean {
  if (
    !file.exists
    || (file.size ?? 0) <= 0
    || !metadataFile.exists
    || !canReadOfflineMetadataFile(metadataFile.size)
  ) {
    return false;
  }

  const metadata = parseOfflineDownloadMetadata(metadataFile.textSync());
  if (!offlineMetadataMatchesFile(metadata, file.name)) return false;

  const requestedMediaId = media?.mediaId?.trim();
  if (requestedMediaId) return metadata.mediaId === requestedMediaId;

  return true;
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

function safeDownloadUrl(value: unknown): URL | null {
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
      (url.protocol !== 'https:' && url.protocol !== 'http:')
      || url.username
      || url.password
      || url.href.length > 8_192
    ) return null;
    return url;
  } catch {
    return null;
  }
}

function platformAllowsDownloadUrl(
  url: URL,
  platform: string,
): boolean {
  return url.protocol === 'https:'
    || (url.protocol === 'http:' && platform === 'android');
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

function normalizedDownloadHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> | null {
  if (!headers) return {};

  const blocked =
    /^(host|content-length|connection|transfer-encoding|cookie|set-cookie)$/i;
  const headerName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
  const normalized: Record<string, string> = {};
  const seenNames = new Set<string>();
  let count = 0;

  for (const rawName in headers) {
    if (!Object.prototype.hasOwnProperty.call(headers, rawName)) continue;
    count += 1;
    if (count > 16) return null;

    const name = rawName.trim();
    const normalizedName = name.toLowerCase();
    const rawValue = headers[rawName];
    const value = typeof rawValue === 'string'
      ? rawValue.trim()
      : '';
    if (
      !name
      || name.length > 64
      || !headerName.test(name)
      || blocked.test(name)
      || seenNames.has(normalizedName)
      || !value
      || value.length > 2_048
      || /[\u0000-\u001f\u007f]/.test(value)
    ) {
      return null;
    }
    seenNames.add(normalizedName);
    normalized[name] = value;
  }

  return normalized;
}

export function canDownloadSource(
  source: StreamSource,
  platform: string = Platform.OS,
): boolean {
  if (!safeSourceId(source.id)) return false;
  const url = safeDownloadUrl(source.url);
  if (
    !url
    || !platformAllowsDownloadUrl(url, platform)
    || normalizedDownloadHeaders(source.headers) === null
  ) return false;
  return !isAdaptiveManifestDownload(source, url);
}

export function cleanupStalePartialDownloads(
  scope: OfflineDownloadScope = { type: 'guest' },
  nowMs = Date.now(),
  staleAfterMs = 24 * 60 * 60 * 1_000,
): void {
  if (
    !Number.isFinite(nowMs)
    || !Number.isFinite(staleAfterMs)
    || staleAfterMs < 0
  ) return;

  const destination = new Directory(
    Paths.document,
    ...offlineDownloadScopePath(scope),
  );
  destination.create({ idempotent: true, intermediates: true });
  const entries = destination.list().slice(0, 2_000);
  for (const entry of entries) {
    const lastModified = entry instanceof File
      ? entry.lastModified
      : null;
    if (
      !(entry instanceof File)
      || !entry.name.endsWith(OFFLINE_PARTIAL_SUFFIX)
      || typeof lastModified !== 'number'
      || !Number.isFinite(lastModified)
      || lastModified <= 0
      || nowMs - lastModified < staleAfterMs
    ) continue;

    try {
      entry.delete();
    } catch {
      // Stale partial cleanup is best effort. A locked/unavailable file must
      // not prevent the Downloads screen or new downloads from working.
    }
  }
}

function writeMetadata(
  destination: Directory,
  file: File,
  source: StreamSource,
  media?: OfflineMediaSnapshot,
): void {
  if (!media && !source.providerId && !source.quality && !source.language && !source.audioLanguages?.length) {
    return;
  }

  const metadataFile = new File(destination, offlineMetadataFileName(file.name));
  if (!metadataFile.exists) metadataFile.create({ intermediates: true });
  metadataFile.write(JSON.stringify(
    buildOfflineDownloadMetadata(
      file.name,
      source,
      media,
      new Date().toISOString(),
    ),
  ));
}

export function startDownloadSource(
  source: StreamSource,
  onProgress?: (
    progress: number | null,
    bytes?: { written: number; total: number },
  ) => void,
  titleHint?: string,
  media?: OfflineMediaSnapshot,
  scope: OfflineDownloadScope = { type: 'guest' },
): ControlledDownloadHandle {
  const validatedUrl = safeDownloadUrl(source.url);
  const validatedHeaders = normalizedDownloadHeaders(source.headers);
  if (
    !safeSourceId(source.id)
    || !validatedUrl
    || !platformAllowsDownloadUrl(validatedUrl, Platform.OS)
    || validatedHeaders === null
    || isAdaptiveManifestDownload(source, validatedUrl)
  ) {
    const error = new Error('This source cannot be downloaded offline');
    return {
      promise: Promise.reject(error),
      pause: async () => undefined,
      resume: async () => undefined,
      cancel: () => undefined,
    };
  }

  const destination = new Directory(
    Paths.document,
    ...offlineDownloadScopePath(scope),
  );
  destination.create({ idempotent: true, intermediates: true });

  const legacyName = baseFileName(source, titleHint);
  let file = new File(destination, legacyName);
  let metadataFile = new File(
    destination,
    offlineMetadataFileName(file.name),
  );

  if (existingDownloadMatches(file, metadataFile, media)) {
    onProgress?.(1);
    return {
      promise: Promise.resolve(),
      fileName: file.name,
      pause: async () => undefined,
      resume: async () => undefined,
      cancel: () => undefined,
    };
  }

  const scopedName = nativeDownloadFileName(
    source,
    titleHint,
    media,
  );
  if (scopedName !== legacyName) {
    // A legacy file with the same display name may belong to another media
    // item. Leave it untouched and move the new download to an identity-scoped
    // filename instead of overwriting somebody else's offline copy.
    file = new File(destination, scopedName);
    metadataFile = new File(
      destination,
      offlineMetadataFileName(file.name),
    );

    if (existingDownloadMatches(file, metadataFile, media)) {
      onProgress?.(1);
      return {
        promise: Promise.resolve(),
        fileName: file.name,
        pause: async () => undefined,
        resume: async () => undefined,
        cancel: () => undefined,
      };
    }
  }

  const finalFileName = file.name;
  if (file.exists) file.delete();
  if (metadataFile.exists) metadataFile.delete();

  const partialFile = new File(
    destination,
    `${finalFileName}${OFFLINE_PARTIAL_SUFFIX}`,
  );
  if (partialFile.exists) partialFile.delete();

  const task = File.createDownloadTask(validatedUrl.href, partialFile, {
    headers: validatedHeaders,
    onProgress: ({ bytesWritten, totalBytes }) => {
      onProgress?.(
        totalBytes > 0
          ? Math.max(0, Math.min(1, bytesWritten / totalBytes))
          : null,
        { written: bytesWritten, total: totalBytes },
      );
    },
  });

  let settled = false;
  let currentRun: Promise<void> | null = null;
  let resolveCompletion!: () => void;
  let rejectCompletion!: (error: unknown) => void;
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  const removePartialFiles = () => {
    if (partialFile.exists) partialFile.delete();
    if (file.exists) file.delete();
    if (metadataFile.exists) metadataFile.delete();
  };

  const finish = (downloaded: File) => {
    if (settled) return;
    if (!downloaded.exists || (downloaded.size ?? 0) <= 0) {
      fail(new Error('Downloaded file is empty'));
      return;
    }
    try {
      downloaded.rename(finalFileName);
      file = downloaded;
      writeMetadata(destination, downloaded, source, media);
    } catch (error) {
      fail(error);
      return;
    }
    settled = true;
    onProgress?.(1);
    resolveCompletion();
  };

  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    removePartialFiles();
    onProgress?.(null);
    rejectCompletion(error);
  };

  const launch = (resume: boolean) => {
    if (settled || currentRun) return;
    currentRun = (async () => {
      try {
        const downloaded = resume
          ? await task.resumeAsync()
          : await task.downloadAsync();
        if (downloaded?.exists) {
          finish(downloaded);
        } else if (task.state === 'paused') {
          // Expo SDK 56 resolves an active download with null when pauseAsync()
          // successfully transitions it to a resumable paused state.
          return;
        } else {
          fail(new Error('Download did not produce a file'));
        }
      } catch (error) {
        fail(error);
      } finally {
        currentRun = null;
      }
    })();
  };

  launch(false);

  return {
    promise: completion,
    fileName: finalFileName,
    async pause() {
      if (settled || task.state !== 'active') return;
      await task.pauseAsync();
      await currentRun;
    },
    async resume() {
      if (settled || task.state !== 'paused') return;
      if (currentRun) await currentRun;
      launch(true);
    },
    cancel() {
      if (settled) return;
      settled = true;
      onProgress?.(null);
      task.cancel();
      removePartialFiles();
      rejectCompletion(new Error('Download cancelled'));
    },
  };
}

export async function downloadSource(
  source: StreamSource,
  onProgress?: (
    progress: number | null,
    bytes?: { written: number; total: number },
  ) => void,
  titleHint?: string,
  media?: OfflineMediaSnapshot,
  scope: OfflineDownloadScope = { type: 'guest' },
): Promise<void> {
  await startDownloadSource(
    source,
    onProgress,
    titleHint,
    media,
    scope,
  ).promise;
}

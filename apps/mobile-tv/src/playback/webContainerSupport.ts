import type { StreamSource } from '@moviestv/core';

/**
 * Containers the web player can reason about.
 *
 * `hls`, `mp4`, `m4v` and `mov` are treated as browser-native. `webm` and
 * `matroska` depend on what the current engine actually implements: Chromium
 * ships a Matroska demuxer and reports `maybe` for `video/x-matroska`, while
 * WebKit (Safari and every iOS browser) has no Matroska support at all.
 * `dash`, `avi`, `flv` and `wmv` have no native `<video>` support in any
 * browser we target, so they must fail over instead of stalling.
 */
export type WebContainerKind =
  | 'hls'
  | 'mp4'
  | 'm4v'
  | 'mov'
  | 'webm'
  | 'matroska'
  | 'dash'
  | 'avi'
  | 'flv'
  | 'wmv'
  | null;

const MEDIA_PARAM_NAME = /format|type|mime|container|filename|file|stream|url|src|source|playlist|media/i;

function mediaType(source: StreamSource): string {
  return source.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function mediaParameterValues(source: StreamSource): string[] {
  try {
    const url = new URL(source.url);
    return [...url.searchParams]
      .filter(([name]) => MEDIA_PARAM_NAME.test(name))
      .map(([, value]) => value);
  } catch {
    return [];
  }
}

/** Match an explicit container extension against the URL or the file name. */
function hasExtension(source: StreamSource, extension: RegExp): boolean {
  const filename = source.filename?.trim().toLowerCase() ?? '';
  return extension.test(source.url)
    || (Boolean(filename) && extension.test(filename));
}

/**
 * Classify a stream by transport/file metadata only.
 *
 * The display name is deliberately ignored: a movie or provider called "Dash"
 * or "Avi" can still expose a perfectly playable stream.
 */
export function webContainerKind(source: StreamSource): WebContainerKind {
  const contentType = mediaType(source);

  if (
    contentType === 'application/vnd.apple.mpegurl'
    || contentType === 'application/x-mpegurl'
    || contentType === 'application/mpegurl'
    || contentType === 'audio/mpegurl'
    || contentType === 'audio/x-mpegurl'
    || /\.m3u8(?:$|[?#])/i.test(source.url)
    || /\.m3u8$/i.test(source.filename?.trim().toLowerCase() ?? '')
  ) {
    return 'hls';
  }

  try {
    const url = new URL(source.url);
    if (/(?:^|\/)hls(?:\/|$)/i.test(url.pathname)) return 'hls';
    if (
      [...url.searchParams].some(([name, value]) => (
        MEDIA_PARAM_NAME.test(name) && /m3u8|mpegurl|\bhls\b/i.test(value)
      ))
    ) {
      return 'hls';
    }
  } catch {
    // Invalid source URLs are rejected before playback.
  }

  if (contentType === 'video/mp4') return 'mp4';
  if (contentType === 'video/x-m4v') return 'm4v';
  if (contentType === 'video/quicktime') return 'mov';
  if (contentType === 'video/webm') return 'webm';
  if (contentType === 'video/x-matroska') return 'matroska';
  if (contentType === 'application/dash+xml') return 'dash';
  if (contentType === 'video/x-msvideo') return 'avi';
  if (contentType === 'video/x-flv') return 'flv';
  if (contentType === 'video/x-ms-wmv') return 'wmv';

  if (hasExtension(source, /\.mp4(?:$|[?#])/i)) return 'mp4';
  if (hasExtension(source, /\.m4v(?:$|[?#])/i)) return 'm4v';
  if (hasExtension(source, /\.mov(?:$|[?#])/i)) return 'mov';
  if (hasExtension(source, /\.webm(?:$|[?#])/i)) return 'webm';
  if (hasExtension(source, /\.(?:mkv|matroska)(?:$|[?#])/i)) return 'matroska';
  if (hasExtension(source, /\.mpd(?:$|[?#])/i)) return 'dash';
  if (hasExtension(source, /\.avi(?:$|[?#])/i)) return 'avi';
  if (hasExtension(source, /\.flv(?:$|[?#])/i)) return 'flv';
  if (hasExtension(source, /\.wmv(?:$|[?#])/i)) return 'wmv';

  // Extensionless provider URLs sometimes declare the real container in a
  // media query parameter, for example `?file=movie.mkv`, but unrelated
  // parameters must not be able to fake a container.
  const declared = mediaParameterValues(source);
  if (declared.some((value) => /\bwebm\b/i.test(value))) return 'webm';
  if (declared.some((value) => /\bmp4\b/i.test(value))) return 'mp4';
  if (declared.some((value) => /\bm4v\b/i.test(value))) return 'm4v';
  if (declared.some((value) => /\b(?:mov|quicktime)\b/i.test(value))) return 'mov';
  if (declared.some((value) => /\b(?:matroska|mkv)\b/i.test(value))) return 'matroska';
  if (declared.some((value) => /\b(?:dash|mpd)\b/i.test(value))) return 'dash';
  if (declared.some((value) => /\bavi\b/i.test(value))) return 'avi';
  if (declared.some((value) => /\bflv\b/i.test(value))) return 'flv';
  if (declared.some((value) => /\bwmv\b/i.test(value))) return 'wmv';

  return null;
}

function probe(
  video: Pick<HTMLVideoElement, 'canPlayType'>,
  mime: string,
): boolean {
  try {
    return Boolean(video.canPlayType(mime));
  } catch {
    return false;
  }
}

let matroskaSupport: boolean | null = null;

/**
 * Probe Matroska support through an injected media element factory.
 *
 * Exported separately from {@link webEngineSupportsMatroska} so the capability
 * rules stay testable without a real DOM.
 */
export function detectWebMatroskaSupport(
  createVideo: () => Pick<HTMLVideoElement, 'canPlayType'> | null,
): boolean {
  try {
    return browserAdvertisesContainer(createVideo(), 'matroska');
  } catch {
    return false;
  }
}

/**
 * Whether this web engine can demux Matroska at all.
 *
 * Creating a media element is cheap but not free, and source ranking asks this
 * question on every resolution, so the answer is cached for the session. Native
 * platforms never call it; they have no `document`.
 */
export function webEngineSupportsMatroska(): boolean {
  if (matroskaSupport !== null) return matroskaSupport;
  if (typeof document === 'undefined') {
    // Do not cache the answer: a native/SSR pass may run before the DOM exists.
    return false;
  }
  matroskaSupport = detectWebMatroskaSupport(
    () => document.createElement('video'),
  );
  return matroskaSupport;
}

/**
 * Whether the current engine advertises a demuxer for a container that is not
 * universally supported. Only engines that report support may attempt these
 * sources; failures still fall through to the normal source failover.
 */
export function browserAdvertisesContainer(
  video: Pick<HTMLVideoElement, 'canPlayType'> | null | undefined,
  kind: WebContainerKind,
): boolean {
  if (!video || typeof video.canPlayType !== 'function') return false;
  if (kind === 'matroska') return probe(video, 'video/x-matroska');
  if (kind === 'webm') return probe(video, 'video/webm');
  return false;
}

/**
 * Containers with no native browser demuxer at all. They are rejected even if
 * a permissive engine reports a generic MIME match, because the media element
 * would only stall until the startup watchdog fires.
 */
export function isNeverNativeWebContainer(kind: WebContainerKind): boolean {
  return kind === 'dash'
    || kind === 'avi'
    || kind === 'flv'
    || kind === 'wmv';
}

/** Containers that are normally served as plain progressive HTTP media. */
export function isProgressiveWebContainer(kind: WebContainerKind): boolean {
  return kind === 'mp4' || kind === 'm4v' || kind === 'mov';
}

export interface WebContainerDecision {
  kind: WebContainerKind;
  /** True when the source must fail over instead of being attached. */
  rejects: boolean;
  /** True when the engine cannot demux an otherwise recognizable container. */
  unsupportedByEngine: boolean;
}

export function webContainerDecision(
  video: Pick<HTMLVideoElement, 'canPlayType'> | null | undefined,
  source: StreamSource,
): WebContainerDecision {
  const kind = webContainerKind(source);

  if (!kind || kind === 'hls' || isProgressiveWebContainer(kind)) {
    return { kind, rejects: false, unsupportedByEngine: false };
  }

  if (kind === 'webm' || kind === 'matroska') {
    const supported = browserAdvertisesContainer(video, kind);
    return { kind, rejects: !supported, unsupportedByEngine: !supported };
  }

  if (isNeverNativeWebContainer(kind)) {
    return { kind, rejects: true, unsupportedByEngine: true };
  }

  return { kind, rejects: false, unsupportedByEngine: false };
}

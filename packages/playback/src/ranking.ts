import type { StreamSource } from '../../core/src';
import { normalizeLanguageTag } from '../../core/src';

export interface PlaybackPreferences {
  preferredAudioLanguages: string[];
  originalLanguage?: string;
  preferWebCompatible?: boolean;
  /**
   * Whether the current web engine can demux Matroska. Chromium reports
   * `video/x-matroska` through `canPlayType` and plays MKV/H.264; WebKit has no
   * Matroska demuxer, so on Safari and every iOS browser an MKV source can only
   * fail over. When this is undefined the conservative web penalty is kept.
   */
  webMatroskaSupported?: boolean;
}

export interface RankedStreamSource {
  source: StreamSource;
  score: number;
  originalIndex: number;
}

function normalizedLanguageCandidates(source: StreamSource): string[] {
  const candidates = [source.language, ...(source.audioLanguages ?? [])]
    .map((language) => language?.trim())
    .filter((language): language is string => Boolean(language));

  const normalized = candidates
    .map((language) => normalizeLanguageTag(language))
    .filter((language): language is string => Boolean(language));

  return [...new Set(normalized)];
}

function baseLanguage(tag: string): string {
  return tag.split('-')[0]?.toLowerCase() ?? tag.toLowerCase();
}

function matchesLanguage(candidates: readonly string[], language: string | undefined): boolean {
  if (!language || candidates.length === 0) return false;
  const normalized = normalizeLanguageTag(language);
  if (!normalized) return false;
  if (candidates.includes(normalized)) return true;
  const base = baseLanguage(normalized);
  return candidates.some((candidate) => baseLanguage(candidate) === base);
}

function preferredLanguageRank(
  candidates: readonly string[],
  preferredLanguages: readonly string[],
): number | null {
  if (candidates.length === 0) return null;

  for (let index = 0; index < preferredLanguages.length; index += 1) {
    if (matchesLanguage(candidates, preferredLanguages[index])) return index;
  }

  return -1;
}

function mediaType(source: StreamSource): string {
  return source.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function qualityScore(value?: string): number {
  const quality = value?.trim().toLowerCase();
  if (!quality) return 100;
  if (/2160|4k|uhd/.test(quality)) return 500;
  if (/1440|2k/.test(quality)) return 425;
  if (/1080|fhd/.test(quality)) return 350;
  if (/720|\bhd\b/.test(quality)) return 250;
  if (/480/.test(quality)) return 150;
  if (/360/.test(quality)) return 75;
  return 100;
}

function looksLikeWebHls(source: StreamSource): boolean {
  const contentType = mediaType(source);
  const filename = source.filename?.trim().toLowerCase() ?? '';
  if (
    contentType === 'application/vnd.apple.mpegurl'
    || contentType === 'application/x-mpegurl'
    || contentType === 'application/mpegurl'
    || contentType === 'audio/mpegurl'
    || contentType === 'audio/x-mpegurl'
    || /\.m3u8(?:$|[?#])/i.test(source.url)
    || /\.m3u8$/i.test(filename)
  ) {
    return true;
  }

  try {
    const url = new URL(source.url);
    if (/(?:^|\/)hls(?:\/|$)/i.test(url.pathname)) return true;

    for (const [name, value] of url.searchParams) {
      if (!/format|type|mime|content|container|filename|file|stream|url|src|source|playlist|media/i.test(name)) continue;
      if (/m3u8|mpegurl|\bhls\b/i.test(value)) return true;
    }
  } catch {
    // Invalid URLs are filtered before playback ranking.
  }

  return false;
}

function webProgressiveMediaKind(
  source: StreamSource,
): 'mp4' | 'm4v' | 'mov' | 'webm' | null {
  const filename = source.filename?.trim().toLowerCase() ?? '';
  const contentType = mediaType(source);
  if (contentType === 'video/mp4') return 'mp4';
  if (contentType === 'video/x-m4v') return 'm4v';
  if (contentType === 'video/quicktime') return 'mov';
  if (contentType === 'video/webm') return 'webm';
  if (/\.mp4(?:$|[?#])/i.test(source.url) || /\.mp4$/i.test(filename)) return 'mp4';
  if (/\.m4v(?:$|[?#])/i.test(source.url) || /\.m4v$/i.test(filename)) return 'm4v';
  if (/\.mov(?:$|[?#])/i.test(source.url) || /\.mov$/i.test(filename)) return 'mov';
  if (/\.webm(?:$|[?#])/i.test(source.url) || /\.webm$/i.test(filename)) return 'webm';

  try {
    const url = new URL(source.url);
    for (const [name, value] of url.searchParams) {
      if (!/format|type|mime|container|filename|file|stream|url|src|source|playlist|media/i.test(name)) continue;
      if (/\b(?:mp4|video\/mp4)\b/i.test(value)) return 'mp4';
      if (/\bm4v\b/i.test(value)) return 'm4v';
      if (/\b(?:mov|quicktime|video\/quicktime)\b/i.test(value)) return 'mov';
      if (/\b(?:webm|video\/webm)\b/i.test(value)) return 'webm';
    }
  } catch {
    // Invalid URLs are filtered before playback ranking.
  }

  return null;
}

function looksLikeMatroskaContainer(source: StreamSource): boolean {
  const filename = source.filename?.trim().toLowerCase() ?? '';
  if (
    /\.(?:mkv|matroska)(?:$|[?#])/i.test(source.url)
    || /\.(?:mkv|matroska)$/i.test(filename)
  ) return true;
  if (mediaType(source) === 'video/x-matroska') return true;
  try {
    const url = new URL(source.url);
    for (const [name, value] of url.searchParams) {
      if (!/format|type|mime|container|filename|file|stream|url|src|source|playlist|media/i.test(name)) continue;
      if (/\b(?:mkv|matroska|video\/x-matroska)\b/i.test(value)) return true;
    }
  } catch {}
  return false;
}

function looksLikeUnsupportedWebContainer(source: StreamSource): boolean {
  const filename = source.filename?.trim().toLowerCase() ?? '';
  if (
    /\.(?:avi|mpd|flv|wmv)(?:$|[?#])/i.test(source.url)
    || /\.(?:avi|mpd|flv|wmv)$/i.test(filename)
  ) return true;
  if (/^(?:video\/(?:x-msvideo|x-flv|x-ms-wmv)|application\/dash\+xml)$/i.test(mediaType(source))) return true;
  try {
    const url = new URL(source.url);
    for (const [name, value] of url.searchParams) {
      if (!/format|type|mime|container|filename|file|stream|url|src|source|playlist|media/i.test(name)) continue;
      if (/\b(?:avi|mpd|dash|flv|wmv)\b/i.test(value)) return true;
    }
  } catch {}
  return false;
}

function browserAudioCodecPenalty(source: StreamSource): number {
  if (source.audioCodec === 'dts' || source.audioCodec === 'truehd') {
    return -750_000;
  }
  const label = `${source.filename ?? ''} ${source.name ?? ''}`.toLowerCase();
  return /\b(?:true[ ._-]?hd|dts(?:[ .:_-]?(?:hd|x|ma))?)\b/i.test(label)
    ? -750_000
    : 0;
}

function browserDynamicRangePenalty(source: StreamSource): number {
  if (source.dynamicRange === 'dolby-vision') return -6_000;
  if (source.dynamicRange === 'hdr') return -2_000;

  const label = `${source.filename ?? ''} ${source.name ?? ''}`.toLowerCase();
  if (/\b(?:dolby[ ._-]?vision|dovi|dvhe|dvh1|dv)\b/i.test(label)) {
    return -6_000;
  }
  if (/\bhdr(?:10(?:\+)?)?\b/i.test(label)) {
    return -2_000;
  }
  return 0;
}

function isBrowserForbiddenRequestHeader(name: string): boolean {
  const normalized = name.trim();
  return /^(?:accept-charset|accept-encoding|access-control-request-headers|access-control-request-method|connection|content-length|cookie|cookie2|date|dnt|expect|host|keep-alive|origin|permissions-policy|referer|set-cookie|te|trailer|transfer-encoding|upgrade|user-agent|via)$/i.test(normalized)
    || /^(?:sec-|proxy-)/i.test(normalized);
}

function browserRequestHeaderProfile(source: StreamSource): {
  hasSettable: boolean;
  hasBrowserManaged: boolean;
} {
  const names = Object.keys(source.headers ?? {});
  return {
    hasSettable: names.some((name) => !isBrowserForbiddenRequestHeader(name)),
    hasBrowserManaged: names.some(isBrowserForbiddenRequestHeader),
  };
}

function webCompatibilityScore(
  source: StreamSource,
  preferences: PlaybackPreferences,
): number {
  const isHls = looksLikeWebHls(source);
  const progressiveMediaKind = webProgressiveMediaKind(source);
  const isMatroska = looksLikeMatroskaContainer(source);
  const enginePlaysPlainMedia = progressiveMediaKind !== null
    || (isMatroska && preferences.webMatroskaSupported === true);
  const headerProfile = browserRequestHeaderProfile(source);
  const headerPenalty = headerProfile.hasSettable ? -7_000_000 : 0;
  // Browser-managed fields such as Referer/User-Agent cannot be injected by
  // JavaScript, but their presence should not make an otherwise browser-
  // playable source effectively unreachable. The browser may supply its own
  // value and playback can fail over normally if the upstream rejects it.
  const browserManagedHeaderPenalty = headerProfile.hasBrowserManaged
    ? -1_500_000
    : 0;
  const audioCodecPenalty = browserAudioCodecPenalty(source);
  const dynamicRangePenalty = browserDynamicRangePenalty(source);
  const headerDependentNonHlsPenalty = headerProfile.hasSettable && !isHls
    ? -10_000_000
    : 0;
  const codec = source.codec?.trim().toLowerCase();
  const browserCodecPenalty = codec && /^(?:h\.?265|x265|hevc|hvc1|hev1|dvhe|dvh1)\b/.test(codec)
    ? -5_000
    : codec && /^(?:av1|av01)\b/.test(codec)
      ? -1_000
      : 0;
  const insecureHttpPenalty = /^http:\/\//i.test(source.url)
    ? -12_000_000
    : 0;
  // Stremio's notWebReady hint can mean "not a plain HTTPS MP4".
  // Recognizable HLS is still browser-playable here through HLS.js/native HLS;
  // transport and header constraints are scored separately below.
  const providerWebReadinessPenalty = source.webReady === false && !isHls
    ? enginePlaysPlainMedia
      ? -2_000_000
      : -9_000_000
    : 0;
  if (isHls) {
    return 6_000_000
      + browserCodecPenalty
      + audioCodecPenalty
      + dynamicRangePenalty
      + headerPenalty
      + browserManagedHeaderPenalty
      + insecureHttpPenalty
      + providerWebReadinessPenalty;
  }
  if (isMatroska) {
    // Chromium demuxes Matroska and plays MKV/H.264, so once the engine
    // advertises it the container should not sink the whole source below
    // unrelated language mismatches. It still ranks below MP4/M4V/MOV because
    // Matroska often carries codecs a browser cannot decode.
    const containerScore = preferences.webMatroskaSupported
      ? 5_950_000
      : -8_000_000;
    return containerScore
      + browserCodecPenalty
      + audioCodecPenalty
      + dynamicRangePenalty
      + headerPenalty
      + browserManagedHeaderPenalty
      + insecureHttpPenalty
      + providerWebReadinessPenalty;
  }
  if (looksLikeUnsupportedWebContainer(source)) {
    return -8_000_000
      + audioCodecPenalty
      + dynamicRangePenalty
      + headerPenalty
      + browserManagedHeaderPenalty
      + insecureHttpPenalty
      + providerWebReadinessPenalty;
  }
  if (progressiveMediaKind === 'mp4') {
    return 5_995_000 + browserCodecPenalty + audioCodecPenalty + dynamicRangePenalty + headerPenalty + browserManagedHeaderPenalty + headerDependentNonHlsPenalty + insecureHttpPenalty + providerWebReadinessPenalty;
  }
  if (progressiveMediaKind === 'm4v') {
    return 5_990_000 + browserCodecPenalty + audioCodecPenalty + dynamicRangePenalty + headerPenalty + browserManagedHeaderPenalty + headerDependentNonHlsPenalty + insecureHttpPenalty + providerWebReadinessPenalty;
  }
  if (progressiveMediaKind === 'mov') {
    return 5_985_000 + browserCodecPenalty + audioCodecPenalty + dynamicRangePenalty + headerPenalty + browserManagedHeaderPenalty + headerDependentNonHlsPenalty + insecureHttpPenalty + providerWebReadinessPenalty;
  }
  if (progressiveMediaKind === 'webm') {
    return 3_000_000 + browserCodecPenalty + audioCodecPenalty + dynamicRangePenalty + headerPenalty + browserManagedHeaderPenalty + headerDependentNonHlsPenalty + insecureHttpPenalty + providerWebReadinessPenalty;
  }
  if (codec && /^(?:h\.?264|x264|avc|avc1)\b/.test(codec)) {
    return 1_000_000 + audioCodecPenalty + dynamicRangePenalty + headerPenalty + browserManagedHeaderPenalty + insecureHttpPenalty + providerWebReadinessPenalty;
  }
  return headerPenalty
    + browserManagedHeaderPenalty
    + audioCodecPenalty
    + dynamicRangePenalty
    + insecureHttpPenalty
    + providerWebReadinessPenalty
    + browserCodecPenalty
    + headerDependentNonHlsPenalty;
}

function sourceScore(source: StreamSource, preferences: PlaybackPreferences): number {
  const candidates = normalizedLanguageCandidates(source);
  const rank = preferredLanguageRank(candidates, preferences.preferredAudioLanguages);
  const quality = qualityScore(source.quality);

  let score: number;
  if (rank !== null && rank >= 0) {
    score = 3_000_000 + (preferences.preferredAudioLanguages.length - rank) * 10_000 + quality;
  } else if (matchesLanguage(candidates, preferences.originalLanguage)) {
    score = 2_000_000 + quality;
  } else if (rank === -1) {
    score = 1_000_000 + quality;
  } else {
    score = quality;
  }

  return score + (preferences.preferWebCompatible ? webCompatibilityScore(source, preferences) : 0);
}

export function rankStreamSources(
  sources: readonly StreamSource[],
  preferences: PlaybackPreferences,
): RankedStreamSource[] {
  return sources
    .map((source, originalIndex) => ({
      source,
      originalIndex,
      score: sourceScore(source, preferences),
    }))
    .sort((left, right) => right.score - left.score || left.originalIndex - right.originalIndex);
}

export function selectBestStreamSource(
  sources: readonly StreamSource[],
  preferences: PlaybackPreferences,
): StreamSource | undefined {
  return rankStreamSources(sources, preferences)[0]?.source;
}

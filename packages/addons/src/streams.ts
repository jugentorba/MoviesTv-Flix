import {
  LANGUAGE_DEFINITIONS,
  inferMediaLanguages,
  normalizeLanguageTag,
  stableTextCompare,
  type StreamSource,
} from '@moviestv/core';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(
  value: unknown,
  maxLength = 2_048,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > maxLength
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) return undefined;
  return normalized;
}

function safePlayableUrl(value: unknown): string | null {
  const raw = asString(value, 8_192);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    const normalized = url.toString();
    return normalized.length <= 8_192
      ? normalized
      : null;
  } catch {
    return null;
  }
}

function inferQuality(label: string): string | undefined {
  if (/2160|4k/i.test(label)) return '2160p';
  if (/1080/i.test(label)) return '1080p';
  if (/720/i.test(label)) return '720p';
  if (/480/i.test(label)) return '480p';
  return undefined;
}

const KNOWN_LANGUAGE_BASES = new Set(
  LANGUAGE_DEFINITIONS.map((language) => language.canonicalTag.toLowerCase()),
);

function normalizeDeclaredLanguage(value: unknown): string | undefined {
  const raw = asString(value, 128);
  if (!raw) return undefined;

  const normalized = normalizeLanguageTag(raw);
  if (!normalized) return raw;

  const base = normalized.split('-')[0]?.toLowerCase();
  return base && KNOWN_LANGUAGE_BASES.has(base) ? normalized : raw;
}

function normalizeDeclaredLanguages(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const languages: string[] = [];

  for (const entry of value.slice(0, 20)) {
    const language = normalizeDeclaredLanguage(entry);
    if (!language || seen.has(language)) continue;
    seen.add(language);
    languages.push(language);
  }

  return languages.length ? languages : undefined;
}

function looksLikeUnsupportedWebContainerLabel(label: string): boolean {
  // Provider labels also contain movie titles, release-group names and free
  // text. Only a filename-style extension is strong enough evidence to mark
  // the source non-web-ready here; URL/query checks happen again in playback.
  return /\.(?:mkv|avi|mpd|flv|wmv)(?:\b|$)/i.test(label);
}

function inferFilenameFromMetadata(value: unknown): string | undefined {
  const text = asString(value, 2_000);
  if (!text) return undefined;

  // Many Stremio providers put the real debrid filename in `title` or
  // `description` while returning an opaque signed URL. Preserve only a
  // filename-looking token so browser playback can make transport decisions
  // without treating ordinary movie/provider names as file metadata.
  const match = text.match(
    /(?:^|[\s|/\\])([^\s|/\\"'<>]{1,500}\.(?:m3u8|mp4|m4v|mov|webm|mkv|avi|mpd|flv|wmv))(?:$|[?#\s|])/i,
  );
  return match?.[1];
}

function normalizeStreamTags(
  stream: Record<string, unknown>,
): string[] {
  const candidates = [
    ...(Array.isArray(stream.tag) ? stream.tag.slice(0, 32) : [stream.tag]),
    ...(Array.isArray(stream.tags) ? stream.tags.slice(0, 32) : [stream.tags]),
  ];
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const candidate of candidates) {
    const tag = asString(candidate, 64);
    if (!tag) continue;
    const normalized = tag.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    tags.push(tag);
    if (tags.length >= 32) break;
  }

  return tags;
}

function contentTypeFromTags(tags: readonly string[]): string | undefined {
  const normalized = tags.map((tag) => tag.trim().toLowerCase());
  const declaredMediaTypes = normalized
    .map((tag) => normalizeContentType(tag))
    .filter((value): value is string => Boolean(value));
  if (
    declaredMediaTypes.some((type) => (
      type === 'application/vnd.apple.mpegurl'
      || type === 'application/x-mpegurl'
      || type === 'application/mpegurl'
      || type === 'audio/mpegurl'
      || type === 'audio/x-mpegurl'
    ))
    || normalized.some((tag) => (
      /(?:^|[\s._-])(?:hls|m3u8|mpegurl)(?:$|[\s._-])/.test(tag)
    ))
  ) {
    return 'application/vnd.apple.mpegurl';
  }
  if (
    declaredMediaTypes.includes('video/mp4')
    || normalized.some((tag) => (
      tag === 'video/mp4'
      || /(?:^|[\s._-])mp4(?:$|[\s._-])/.test(tag)
    ))
  ) {
    return 'video/mp4';
  }
  if (declaredMediaTypes.includes('video/x-m4v') || normalized.some((tag) => tag === 'm4v' || tag === 'video/x-m4v')) {
    return 'video/x-m4v';
  }
  if (declaredMediaTypes.includes('video/quicktime') || normalized.some((tag) => tag === 'mov' || tag === 'quicktime' || tag === 'video/quicktime')) {
    return 'video/quicktime';
  }
  if (declaredMediaTypes.includes('video/webm') || normalized.some((tag) => tag === 'webm' || tag === 'video/webm')) {
    return 'video/webm';
  }
  if (declaredMediaTypes.includes('video/x-matroska') || normalized.some((tag) => tag === 'mkv' || tag === 'matroska' || tag === 'video/x-matroska')) {
    return 'video/x-matroska';
  }
  if (declaredMediaTypes.includes('video/x-msvideo') || normalized.some((tag) => tag === 'avi' || tag === 'video/x-msvideo')) {
    return 'video/x-msvideo';
  }
  if (declaredMediaTypes.includes('application/dash+xml') || normalized.some((tag) => tag === 'dash' || tag === 'mpd' || tag === 'application/dash+xml')) {
    return 'application/dash+xml';
  }
  if (declaredMediaTypes.includes('video/x-flv') || normalized.some((tag) => tag === 'flv' || tag === 'video/x-flv')) {
    return 'video/x-flv';
  }
  if (declaredMediaTypes.includes('video/x-ms-wmv') || normalized.some((tag) => tag === 'wmv' || tag === 'video/x-ms-wmv')) {
    return 'video/x-ms-wmv';
  }
  return undefined;
}

function normalizeContentType(value: unknown): string | undefined {
  const text = asString(value, 128);
  if (!text) return undefined;
  const normalized = text.toLowerCase().split(';')[0]?.trim();
  if (
    !normalized
    || !/^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/i.test(normalized)
  ) return undefined;
  return normalized;
}

function declaredCodecTokensFromContentType(
  value: unknown,
): string[] {
  const text = asString(value, 128);
  if (!text) return [];
  const match = text.match(
    /(?:^|;)\s*codecs\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;]*))/i,
  );
  const declared = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!declared) return [];

  return declared
    .split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .slice(0, 16);
}

function inferVideoCodecFromContentType(
  value: unknown,
): string | undefined {
  for (const candidate of declaredCodecTokensFromContentType(value)) {
    const codec = normalizeVideoCodec(candidate);
    if (codec) return codec;
  }
  return undefined;
}

function normalizeVideoCodecDetail(
  value: unknown,
): string | undefined {
  const raw = asString(value, 64)?.trim();
  if (!raw) return undefined;
  return /^(?:avc1|hvc1|hev1|dvhe|dvh1|av01)(?:\.[A-Za-z0-9]+)+$/i.test(raw)
    ? raw
    : undefined;
}

function inferVideoCodecDetailFromContentType(
  value: unknown,
): string | undefined {
  for (const candidate of declaredCodecTokensFromContentType(value)) {
    const detail = normalizeVideoCodecDetail(candidate);
    if (detail) return detail;
  }
  return undefined;
}

function inferAudioCodecFromContentType(
  value: unknown,
): StreamSource['audioCodec'] | undefined {
  for (const candidate of declaredCodecTokensFromContentType(value)) {
    const codec = normalizeAudioCodec(candidate);
    if (codec) return codec;
  }
  return undefined;
}

function inferDynamicRangeFromContentType(
  value: unknown,
): StreamSource['dynamicRange'] | undefined {
  for (const raw of declaredCodecTokensFromContentType(value)) {
    const codec = raw.trim().toLowerCase();
    if (/^(?:dvhe|dvh1)(?:\b|[ .:_-])/.test(codec)) {
      return 'dolby-vision';
    }
  }
  return undefined;
}

function inferContentType(
  stream: Record<string, unknown>,
  behaviorHints: Record<string, unknown> | null,
  tags: readonly string[] = [],
): string | undefined {
  const structuredHints = [
    asString(stream.container, 64),
    asString(stream.format, 64),
    asString(behaviorHints?.container, 64),
    asString(behaviorHints?.format, 64),
  ].filter((value): value is string => Boolean(value));

  return normalizeContentType(stream.contentType)
    ?? normalizeContentType(stream.mimeType)
    ?? normalizeContentType(behaviorHints?.contentType)
    ?? normalizeContentType(behaviorHints?.mimeType)
    ?? contentTypeFromTags([...tags, ...structuredHints])
    ?? normalizeContentType(stream.type);
}

function isUnsupportedWebContentType(
  contentType: string | undefined,
): boolean {
  return /^(?:video\/(?:x-matroska|x-msvideo|x-flv|x-ms-wmv)|application\/dash\+xml)$/i.test(
    contentType ?? '',
  );
}

function inferCodec(label: string): string | undefined {
  if (/\b(?:h\.?265|x265|hevc|hvc1|hev1)\b/i.test(label)) return 'h265';
  if (/\b(?:h\.?264|x264|avc|avc1)\b/i.test(label)) return 'h264';
  if (/\b(?:av1|av01)\b/i.test(label)) return 'av1';
  return undefined;
}

function normalizeVideoCodec(
  value: unknown,
): string | undefined {
  const normalized = asString(value, 64)?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (/^(?:h\.?265|x265|hevc|hvc1|hev1|dvhe|dvh1)(?:\b|[ ._-])/.test(normalized)) {
    return 'h265';
  }
  if (/^(?:h\.?264|x264|avc|avc1)(?:\b|[ ._-])/.test(normalized)) {
    return 'h264';
  }
  if (/^(?:av1|av01)(?:\b|[ ._-])/.test(normalized)) {
    return 'av1';
  }
  return undefined;
}

function inferAudioCodec(
  label: string,
): StreamSource['audioCodec'] | undefined {
  if (/\btrue[ ._-]?hd\b/i.test(label)) return 'truehd';
  if (/\bdts(?:[ .:_-]?(?:hd|x|ma))?\b/i.test(label)) return 'dts';
  return undefined;
}

function inferDynamicRange(
  label: string,
): StreamSource['dynamicRange'] | undefined {
  if (/\b(?:dolby[ ._-]?vision|dovi|dvhe|dvh1|dv)\b/i.test(label)) {
    return 'dolby-vision';
  }
  if (/\bhdr(?:10(?:\+)?)?\b/i.test(label)) return 'hdr';
  return undefined;
}

function normalizeAudioCodec(
  value: unknown,
): StreamSource['audioCodec'] | undefined {
  const normalized = asString(value, 64)?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (
    /^true[ ._-]?hd(?:\b|[ .:_-])/.test(normalized)
    || /^mlpa(?:\b|[ .:_-])/.test(normalized)
  ) return 'truehd';
  if (
    /^dts(?:[ .:_-]?(?:hd(?:[ .:_-]?ma)?|x|ma))?(?:$|[ .:_-])/.test(normalized)
    || /^dts(?:c|h|e|l|x|y)(?:\b|[ .:_-])/.test(normalized)
  ) {
    return 'dts';
  }
  return undefined;
}

function normalizeDynamicRange(
  value: unknown,
): StreamSource['dynamicRange'] | undefined {
  const normalized = asString(value, 64)?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (/^(?:dolby[ ._-]?vision|dovi|dvhe|dvh1|dv)(?:$|[ .:_-])/.test(normalized)) {
    return 'dolby-vision';
  }
  if (/^hdr(?:10(?:\+)?)?(?:$|[ .:_-])/.test(normalized)) return 'hdr';
  return undefined;
}

function sanitizeHeaderRecord(
  request: Record<string, unknown>,
): Record<string, string> | undefined {
  const blocked =
    /^(host|content-length|connection|transfer-encoding|cookie|set-cookie)$/i;
  const headerName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
  const headers: Record<string, string> = {};
  const seen = new Set<string>();
  let inspected = 0;
  let accepted = 0;

  for (const rawName in request) {
    if (!Object.prototype.hasOwnProperty.call(request, rawName)) continue;
    inspected += 1;
    if (inspected > 64 || accepted >= 16) break;

    const name = rawName.trim();
    const normalizedName = name.toLowerCase();
    const rawValue = request[rawName];
    if (
      !name
      || name.length > 64
      || !headerName.test(name)
      || blocked.test(name)
      || seen.has(normalizedName)
      || typeof rawValue !== 'string'
    ) continue;

    const value = rawValue.trim();
    if (
      !value
      || value.length > 2_048
      || /[\u0000-\u001f\u007f]/.test(value)
    ) continue;

    seen.add(normalizedName);
    headers[name] = value;
    accepted += 1;
  }

  return accepted ? headers : undefined;
}

function mergeHeaderRecords(
  ...records: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const merged: Record<string, string> = {};
  const seen = new Set<string>();

  for (const record of records) {
    if (!record) continue;
    for (const [name, value] of Object.entries(record)) {
      if (Object.keys(merged).length >= 16) break;
      const normalizedName = name.toLowerCase();
      if (seen.has(normalizedName)) continue;
      seen.add(normalizedName);
      merged[name] = value;
    }
  }

  return Object.keys(merged).length ? merged : undefined;
}

function normalizeRequestHeaders(
  stream: Record<string, unknown>,
): Record<string, string> | undefined {
  const behaviorHints = asRecord(stream.behaviorHints);
  const proxyHeaders = asRecord(behaviorHints?.proxyHeaders);
  const proxyRequest = asRecord(proxyHeaders?.request);

  // Standard Stremio addons normally use behaviorHints.proxyHeaders.request.
  // TvVoo and a few compatible addons expose the same request header map
  // directly as behaviorHints.proxyHeaders and/or behaviorHints.headers.
  // Accept those legacy shapes too, while preserving the same sanitization and
  // case-insensitive precedence rules used for top-level stream.headers.
  const standardProxyRequest = proxyRequest
    ? sanitizeHeaderRecord(proxyRequest)
    : undefined;
  const flatProxyRequest = proxyHeaders && !proxyRequest
    ? sanitizeHeaderRecord(proxyHeaders)
    : undefined;
  const hintedRequest = asRecord(behaviorHints?.headers);
  const behaviorRequest = hintedRequest
    ? sanitizeHeaderRecord(hintedRequest)
    : undefined;
  const directRequest = asRecord(stream.headers);
  const direct = directRequest
    ? sanitizeHeaderRecord(directRequest)
    : undefined;

  return mergeHeaderRecords(
    standardProxyRequest,
    flatProxyRequest,
    behaviorRequest,
    direct,
  );
}

function inferSizeBytes(stream: Record<string, unknown>, label: string): number | undefined {
  const behaviorHints = asRecord(stream.behaviorHints);
  const declared = behaviorHints?.videoSize ?? stream.sizeBytes ?? stream.size;
  if (
    typeof declared === 'number'
    && Number.isSafeInteger(Math.round(declared))
    && declared > 0
  ) {
    return Math.round(declared);
  }

  const match = label.match(/(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB)\b/i);
  if (!match) return undefined;
  const amount = Number.parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multiplier = unit === 'TB'
    ? 1024 ** 4
    : unit === 'GB'
      ? 1024 ** 3
      : unit === 'MB'
        ? 1024 ** 2
        : 1024;
  const bytes = Math.round(amount * multiplier);
  return Number.isSafeInteger(bytes) && bytes > 0
    ? bytes
    : undefined;
}

export function normalizeStreamCandidates(providerId: string, payload: unknown): StreamSource[] {
  const normalizedProviderId = asString(providerId, 512);
  if (!normalizedProviderId) return [];

  const record = asRecord(payload);
  const nestedStreams = record?.streams;
  const nestedStream = record?.stream;
  const streams = Array.isArray(payload)
    ? payload.slice(0, 500)
    : Array.isArray(nestedStreams)
      ? nestedStreams.slice(0, 500)
      : asRecord(nestedStreams)
        ? [nestedStreams]
        : asRecord(nestedStream)
          ? [nestedStream]
          : record && safePlayableUrl(record.url)
            ? [record]
            : [];
  const output: StreamSource[] = [];

  streams.forEach((entry, index) => {
    const stream = asRecord(entry);
    if (!stream) return;
    const url = safePlayableUrl(stream.url);
    if (!url) return;

    const behaviorHints = asRecord(stream.behaviorHints);
    const streamTags = normalizeStreamTags(stream);
    const streamName = asString(stream.name, 500);
    const streamTitle = asString(stream.title, 500);
    const description = asString(stream.description, 2_000);
    const hintedFilename = asString(behaviorHints?.filename, 2_000);
    const declaredFilename = asString(stream.filename, 2_000);
    const inferredFilename = declaredFilename
      ?? hintedFilename
      ?? inferFilenameFromMetadata(streamTitle)
      ?? inferFilenameFromMetadata(description)
      ?? inferFilenameFromMetadata(streamName);
    const name = streamName ?? streamTitle ?? description;
    const label = [...new Set(
      [streamName, streamTitle, description, inferredFilename, ...streamTags]
        .filter((value): value is string => Boolean(value)),
    )].join(' ');
    const sourceId = asString(stream.id, 512) ?? `${index + 1}`;
    const inferredLanguages = inferMediaLanguages(label);
    const language = normalizeDeclaredLanguage(stream.language)
      ?? inferredLanguages[0];
    const declaredAudioLanguages = normalizeDeclaredLanguages(
      stream.audioLanguages,
    );
    const audioLanguages = declaredAudioLanguages
      ?? (
        inferredLanguages.length > 1
          ? inferredLanguages
          : undefined
      );
    const quality = inferQuality(label);
    const codec = normalizeVideoCodec(stream.codec)
      ?? normalizeVideoCodec(behaviorHints?.codec)
      ?? inferVideoCodecFromContentType(stream.contentType)
      ?? inferVideoCodecFromContentType(stream.mimeType)
      ?? inferVideoCodecFromContentType(behaviorHints?.contentType)
      ?? inferVideoCodecFromContentType(behaviorHints?.mimeType)
      ?? inferVideoCodecFromContentType(stream.type)
      ?? streamTags.map(inferVideoCodecFromContentType).find(Boolean)
      ?? inferCodec(label);
    const codecDetail = normalizeVideoCodecDetail(stream.codec)
      ?? normalizeVideoCodecDetail(behaviorHints?.codec)
      ?? inferVideoCodecDetailFromContentType(stream.contentType)
      ?? inferVideoCodecDetailFromContentType(stream.mimeType)
      ?? inferVideoCodecDetailFromContentType(behaviorHints?.contentType)
      ?? inferVideoCodecDetailFromContentType(behaviorHints?.mimeType)
      ?? inferVideoCodecDetailFromContentType(stream.type)
      ?? streamTags.map(inferVideoCodecDetailFromContentType).find(Boolean);
    const audioCodec = normalizeAudioCodec(stream.audioCodec)
      ?? normalizeAudioCodec(behaviorHints?.audioCodec)
      ?? inferAudioCodecFromContentType(stream.contentType)
      ?? inferAudioCodecFromContentType(stream.mimeType)
      ?? inferAudioCodecFromContentType(behaviorHints?.contentType)
      ?? inferAudioCodecFromContentType(behaviorHints?.mimeType)
      ?? inferAudioCodecFromContentType(stream.type)
      ?? streamTags.map(inferAudioCodecFromContentType).find(Boolean)
      ?? inferAudioCodec(label);
    const dynamicRange = normalizeDynamicRange(stream.dynamicRange)
      ?? normalizeDynamicRange(behaviorHints?.dynamicRange)
      ?? inferDynamicRangeFromContentType(stream.contentType)
      ?? inferDynamicRangeFromContentType(stream.mimeType)
      ?? inferDynamicRangeFromContentType(behaviorHints?.contentType)
      ?? inferDynamicRangeFromContentType(behaviorHints?.mimeType)
      ?? inferDynamicRangeFromContentType(stream.type)
      ?? streamTags.map(inferDynamicRangeFromContentType).find(Boolean)
      ?? inferDynamicRange(label);
    const contentType = inferContentType(
      stream,
      behaviorHints,
      streamTags,
    );
    const sizeBytes = inferSizeBytes(stream, label);
    const headers = normalizeRequestHeaders(stream);
    const webReady = (
      behaviorHints?.notWebReady === true
      || looksLikeUnsupportedWebContainerLabel(label)
      || isUnsupportedWebContentType(contentType)
    )
      ? false
      : undefined;

    output.push({
      id: `${normalizedProviderId}:${sourceId}`,
      sourceId,
      providerId: normalizedProviderId,
      url,
      ...(name ? { name } : {}),
      ...(inferredFilename ? { filename: inferredFilename } : {}),
      ...(quality ? { quality } : {}),
      ...(language ? { language } : {}),
      ...(audioLanguages ? { audioLanguages } : {}),
      ...(codec ? { codec } : {}),
      ...(codecDetail ? { codecDetail } : {}),
      ...(audioCodec ? { audioCodec } : {}),
      ...(dynamicRange ? { dynamicRange } : {}),
      ...(contentType ? { contentType } : {}),
      ...(sizeBytes ? { sizeBytes } : {}),
      ...(headers ? { headers } : {}),
      ...(webReady === false ? { webReady } : {}),
    });
  });

  return output;
}

function sanitizeResolvedHeaders(
  value: unknown,
): Record<string, string> | undefined {
  const request = asRecord(value);
  return request ? sanitizeHeaderRecord(request) : undefined;
}

function normalizeResolvedStreamSource(
  value: unknown,
): StreamSource | null {
  const source = asRecord(value);
  if (!source) return null;

  const id = asString(source.id, 512);
  const url = safePlayableUrl(source.url);
  if (!id || !url) return null;

  const providerId = asString(source.providerId, 512);
  const sourceId = asString(source.sourceId, 512);
  const name = asString(source.name, 500);
  const filename = asString(source.filename, 2_000);
  const quality = asString(source.quality, 128);
  const language = normalizeDeclaredLanguage(source.language);
  const codec = asString(source.codec, 64)
    ?? inferVideoCodecFromContentType(source.contentType);
  const codecDetail = normalizeVideoCodecDetail(source.codecDetail)
    ?? normalizeVideoCodecDetail(source.codec)
    ?? inferVideoCodecDetailFromContentType(source.contentType);
  const audioCodec = normalizeAudioCodec(source.audioCodec)
    ?? inferAudioCodecFromContentType(source.contentType);
  const dynamicRange = normalizeDynamicRange(source.dynamicRange)
    ?? inferDynamicRangeFromContentType(source.contentType);
  const contentType = normalizeContentType(source.contentType);
  const headers = sanitizeResolvedHeaders(source.headers);
  const audioLanguages = normalizeDeclaredLanguages(
    source.audioLanguages,
  );
  const subtitleLanguages = normalizeDeclaredLanguages(
    source.subtitleLanguages,
  );
  const sizeBytes = (
    typeof source.sizeBytes === 'number'
    && Number.isSafeInteger(source.sizeBytes)
    && source.sizeBytes > 0
  )
    ? source.sizeBytes
    : undefined;
  const webReady = typeof source.webReady === 'boolean'
    ? source.webReady
    : undefined;

  return {
    id,
    url,
    ...(providerId ? { providerId } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(name ? { name } : {}),
    ...(filename ? { filename } : {}),
    ...(quality ? { quality } : {}),
    ...(language ? { language } : {}),
    ...(codec ? { codec } : {}),
    ...(codecDetail ? { codecDetail } : {}),
    ...(audioCodec ? { audioCodec } : {}),
    ...(dynamicRange ? { dynamicRange } : {}),
    ...(contentType ? { contentType } : {}),
    ...(sizeBytes ? { sizeBytes } : {}),
    ...(headers ? { headers } : {}),
    ...(webReady !== undefined ? { webReady } : {}),
    ...(audioLanguages ? { audioLanguages } : {}),
    ...(subtitleLanguages ? { subtitleLanguages } : {}),
  };
}

function mergeLanguages(
  primary: readonly string[] | undefined,
  secondary: readonly string[] | undefined,
): string[] | undefined {
  const merged = [...new Set([
    ...(primary ?? []),
    ...(secondary ?? []),
  ])];
  return merged.length ? merged : undefined;
}

function canonicalRequestHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): string {
  if (!headers) return '';
  return Object.entries(headers)
    .map(([name, value]) => [name.trim().toLowerCase(), value.trim()] as const)
    .filter(([name, value]) => Boolean(name && value))
    .sort(([leftName, leftValue], [rightName, rightValue]) => (
      stableTextCompare(leftName, rightName)
      || stableTextCompare(leftValue, rightValue)
    ))
    .map(([name, value]) => `${name}:${value}`)
    .join('\n');
}

export function dedupeStreamSources(groupsByPriority: StreamSource[][]): StreamSource[] {
  const variantIndexes = new Map<string, number>();
  const usedIds = new Set<string>();
  const result: StreamSource[] = [];

  const withUniqueId = (source: StreamSource): StreamSource => {
    if (!usedIds.has(source.id)) {
      usedIds.add(source.id);
      return source;
    }

    let suffix = 2;
    let id = `${source.id}:${suffix}`;
    while (usedIds.has(id)) {
      suffix += 1;
      id = `${source.id}:${suffix}`;
    }
    usedIds.add(id);
    return { ...source, id };
  };

  for (const group of groupsByPriority.slice(0, 100)) {
    if (!Array.isArray(group)) continue;
    for (const candidate of group.slice(0, 1_000)) {
      const source = normalizeResolvedStreamSource(candidate);
      if (!source) continue;

      const url = new URL(source.url);
      url.hash = '';
      const key =
        `${url.toString()}\u0000${canonicalRequestHeaders(source.headers)}`;
      const existingIndex = variantIndexes.get(key);
      if (existingIndex !== undefined) {
        const existing = result[existingIndex];
        if (existing) {
          // Keep the first source's priority/order/identity, but do not throw
          // away later transport evidence for the exact same URL+headers.
          // Providers sometimes repeat one signed URL with richer filename,
          // MIME or web-readiness metadata on a later entry.
          result[existingIndex] = {
            ...existing,
            ...(!existing.name && source.name
              ? { name: source.name }
              : {}),
            ...(!existing.filename && source.filename
              ? { filename: source.filename }
              : {}),
            ...(!existing.contentType && source.contentType
              ? { contentType: source.contentType }
              : {}),
            ...(!existing.codec && source.codec
              ? { codec: source.codec }
              : {}),
            ...(!existing.codecDetail && source.codecDetail
              ? { codecDetail: source.codecDetail }
              : {}),
            ...(!existing.audioCodec && source.audioCodec
              ? { audioCodec: source.audioCodec }
              : {}),
            ...(!existing.dynamicRange && source.dynamicRange
              ? { dynamicRange: source.dynamicRange }
              : {}),
            ...(!existing.quality && source.quality
              ? { quality: source.quality }
              : {}),
            ...(existing.sizeBytes === undefined && source.sizeBytes !== undefined
              ? { sizeBytes: source.sizeBytes }
              : {}),
            ...(!existing.language && source.language
              ? { language: source.language }
              : {}),
            ...(mergeLanguages(
              existing.audioLanguages,
              source.audioLanguages,
            )
              ? {
                  audioLanguages: mergeLanguages(
                    existing.audioLanguages,
                    source.audioLanguages,
                  ),
                }
              : {}),
            ...(mergeLanguages(
              existing.subtitleLanguages,
              source.subtitleLanguages,
            )
              ? {
                  subtitleLanguages: mergeLanguages(
                    existing.subtitleLanguages,
                    source.subtitleLanguages,
                  ),
                }
              : {}),
            ...(existing.webReady !== false && source.webReady === false
              ? { webReady: false }
              : {}),
          };
        }
        continue;
      }
      const uniqueSource = withUniqueId(source);
      variantIndexes.set(key, result.length);
      result.push(uniqueSource);
      if (result.length >= 1_000) return result;
    }
  }

  return result;
}

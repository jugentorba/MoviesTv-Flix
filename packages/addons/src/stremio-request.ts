import type {
  AddonDescriptor,
  AddonMediaRequest,
  AddonStreamProtocol,
  AddonSubtitleProtocol,
} from './types';

export interface StremioStreamRequest {
  type: 'movie' | 'series';
  id: string;
  path: string;
}

export interface StremioSubtitleRequest {
  type: 'movie' | 'series';
  id: string;
  path: string;
}

type RequestProtocol = AddonStreamProtocol | AddonSubtitleProtocol;

function boundedIdentifier(
  value: unknown,
  maxLength: number,
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

function acceptsId(protocol: RequestProtocol, candidate: string): boolean {
  if (!Array.isArray(protocol.idPrefixes)) return false;
  if (protocol.idPrefixes.length === 0) return true;

  const prefixes = protocol.idPrefixes
    .filter((prefix): prefix is string => typeof prefix === 'string')
    .map((prefix) => prefix.trim())
    .filter(Boolean);
  if (!prefixes.length) return false;

  const normalizedCandidate = candidate.toLowerCase();
  return prefixes.some((prefix) => (
    normalizedCandidate.startsWith(prefix.toLowerCase())
  ));
}

function inferredImdbId(request: AddonMediaRequest): string | undefined {
  const explicit = boundedIdentifier(request.externalIds.imdb, 32);
  const explicitMatch = explicit?.match(/^(?:imdb:)?(tt\d+)$/i);
  if (explicitMatch?.[1]) return explicitMatch[1].toLowerCase();

  const identities = request.kind === 'episode'
    ? [request.seriesMediaId, request.mediaId]
    : [request.mediaId];
  for (const identity of identities) {
    const mediaId = boundedIdentifier(identity, 2_048);
    if (!mediaId) continue;
    const match = mediaId.match(/(?:^|:)(tt\d+)(?::|$)/i);
    const inferred = boundedIdentifier(match?.[1], 32);
    if (inferred && /^tt\d+$/i.test(inferred)) return inferred;
  }
  return undefined;
}

function inferredCatalogResourceId(
  request: AddonMediaRequest,
): string | undefined {
  const canonicalId = request.kind === 'episode'
    ? request.seriesMediaId
    : request.mediaId;
  const marker = request.kind === 'episode'
    ? ':series:'
    : ':movie:';
  const normalized = boundedIdentifier(canonicalId, 2_048);
  if (!normalized || !normalized.startsWith('stremio-')) {
    return undefined;
  }

  const markerIndex = normalized.indexOf(marker);
  if (markerIndex <= 'stremio-'.length) return undefined;
  const encoded = normalized.slice(markerIndex + marker.length);
  if (!encoded) return undefined;

  try {
    return boundedIdentifier(decodeURIComponent(encoded), 512);
  } catch {
    return undefined;
  }
}

function inferredTmdbId(request: AddonMediaRequest): string | undefined {
  const explicit = boundedIdentifier(request.externalIds.tmdb, 32);
  const explicitMatch = explicit?.match(
    /^(?:tmdb:(?:(?:movie|series):)?)?(\d+)$/i,
  );
  if (explicitMatch?.[1]) return explicitMatch[1];

  const identities = request.kind === 'episode'
    ? [request.seriesMediaId, request.mediaId]
    : [request.mediaId];
  for (const identity of identities) {
    const mediaId = boundedIdentifier(identity, 2_048);
    if (!mediaId) continue;
    const match = mediaId.match(
      /^tmdb:(?:(?:movie|series):)?(\d+)(?::|$)/i,
    );
    const inferred = boundedIdentifier(match?.[1], 32);
    if (inferred && /^\d+$/.test(inferred)) return inferred;
  }
  return undefined;
}

function baseStremioIds(
  protocol: RequestProtocol,
  request: AddonMediaRequest,
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: string | undefined) => {
    if (!candidate || !acceptsId(protocol, candidate)) return;
    const key = candidate.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  push(inferredImdbId(request));

  const tmdbId = inferredTmdbId(request);
  if (tmdbId) {
    push(`tmdb:${tmdbId}`);
    push(
      request.kind === 'movie'
        ? `tmdb:movie:${tmdbId}`
        : `tmdb:series:${tmdbId}`,
    );
  }

  push(inferredCatalogResourceId(request));

  return candidates.slice(0, 4);
}

function stremioMediaIds(
  protocol: RequestProtocol,
  request: AddonMediaRequest,
): Array<{ type: 'movie' | 'series'; id: string }> {
  if (!Array.isArray(protocol.types)) return [];
  const supportedTypes = protocol.types.filter(
    (type): type is 'movie' | 'series' => (
      type === 'movie' || type === 'series'
    ),
  );
  if (!supportedTypes.length) return [];

  const baseIds = baseStremioIds(protocol, request);
  if (!baseIds.length) return [];

  if (request.kind === 'movie') {
    if (!supportedTypes.includes('movie')) return [];
    return baseIds.map((id) => ({ type: 'movie' as const, id }));
  }

  if (request.kind === 'episode') {
    if (!supportedTypes.includes('series')) return [];
    if (
      !Number.isInteger(request.seasonNumber)
      || (request.seasonNumber ?? -1) < 0
      || (request.seasonNumber ?? 0) > 10_000
    ) return [];
    if (
      !Number.isInteger(request.episodeNumber)
      || (request.episodeNumber ?? 0) <= 0
      || (request.episodeNumber ?? 0) > 100_000
    ) return [];

    return baseIds.map((id) => ({
      type: 'series' as const,
      id: `${id}:${request.seasonNumber}:${request.episodeNumber}`,
    }));
  }

  return [];
}

export function toStremioStreamRequests(
  descriptor: AddonDescriptor,
  request: AddonMediaRequest,
): StremioStreamRequest[] {
  if (!descriptor.stream) return [];
  return stremioMediaIds(descriptor.stream, request).map((media) => ({
    ...media,
    path: `/stream/${media.type}/${encodeURIComponent(media.id)}.json`,
  }));
}

export function toStremioStreamRequest(
  descriptor: AddonDescriptor,
  request: AddonMediaRequest,
): StremioStreamRequest | null {
  return toStremioStreamRequests(descriptor, request)[0] ?? null;
}

export function toStremioSubtitleRequests(
  descriptor: AddonDescriptor,
  request: AddonMediaRequest,
): StremioSubtitleRequest[] {
  if (!descriptor.subtitle) return [];
  return stremioMediaIds(descriptor.subtitle, request).map((media) => ({
    ...media,
    path: `/subtitles/${media.type}/${encodeURIComponent(media.id)}.json`,
  }));
}

export function toStremioSubtitleRequest(
  descriptor: AddonDescriptor,
  request: AddonMediaRequest,
): StremioSubtitleRequest | null {
  return toStremioSubtitleRequests(descriptor, request)[0] ?? null;
}

export function supportsStreamRequest(
  descriptor: AddonDescriptor,
  request: AddonMediaRequest,
): boolean {
  return toStremioStreamRequest(descriptor, request) !== null;
}

export function supportsSubtitleRequest(
  descriptor: AddonDescriptor,
  request: AddonMediaRequest,
): boolean {
  return toStremioSubtitleRequest(descriptor, request) !== null;
}

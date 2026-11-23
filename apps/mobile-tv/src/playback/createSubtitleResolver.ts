import {
  normalizeSubtitleCandidates,
  toStremioSubtitleRequests,
  type AddonMediaRequest,
  type AddonStateRecord,
} from '@moviestv/addons';
import {
  normalizeLanguageTag,
  stableTextCompare,
  type SubtitleTrack,
} from '@moviestv/core';
import {
  DEFAULT_PROVIDER_MAX_BYTES,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  defaultHttpFetcher,
  fetchBoundedJson,
  type HttpFetcher,
} from '../addons/HttpJsonLoader';

const MAX_SUBTITLE_PROVIDER_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!, index);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );
  return results;
}

export interface SubtitleSourceResolver {
  resolve(
    request: AddonMediaRequest,
    preferredLanguages: readonly string[],
  ): Promise<SubtitleTrack[]>;
}

function providerRequestUrl(manifestUrl: string, requestPath: string): string {
  const manifest = new URL(manifestUrl);
  const hostname = manifest.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  const loopbackHttp = manifest.protocol === 'http:'
    && ['localhost', '127.0.0.1', '::1'].includes(hostname);
  if (
    (manifest.protocol !== 'https:' && !loopbackHttp)
    || manifest.username
    || manifest.password
  ) {
    throw new Error('Provider manifest URL must be secure HTTPS');
  }
  manifest.hash = '';
  if (!manifest.pathname.endsWith('/manifest.json')) {
    throw new Error('Provider manifest URL is invalid');
  }
  const hasTraversalSegment = requestPath
    .split('/')
    .some((segment) => segment === '.' || segment === '..');
  if (
    !requestPath.startsWith('/')
    || requestPath.includes('\\')
    || hasTraversalSegment
  ) {
    throw new Error('Provider request path is invalid');
  }
  const basePath = manifest.pathname.slice(0, -'/manifest.json'.length);
  return `${manifest.origin}${basePath}${requestPath}${manifest.search}`;
}

function baseLanguage(value: string): string {
  return value.split('-')[0]?.toLowerCase() ?? value.toLowerCase();
}

function languageRank(track: SubtitleTrack, preferredLanguages: readonly string[]): number {
  const normalizedTrack = normalizeLanguageTag(track.language) ?? track.language.toLowerCase();
  for (let index = 0; index < preferredLanguages.length; index += 1) {
    const preferred = normalizeLanguageTag(preferredLanguages[index]) ?? preferredLanguages[index].toLowerCase();
    if (
      normalizedTrack === preferred
      || baseLanguage(normalizedTrack) === baseLanguage(preferred)
    ) {
      return index;
    }
  }
  return preferredLanguages.length + 1;
}

export function createSubtitleResolver(
  records: readonly AddonStateRecord[],
  fetcher: HttpFetcher = defaultHttpFetcher,
  timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
  maxBytes = DEFAULT_PROVIDER_MAX_BYTES,
): SubtitleSourceResolver {
  const providers = records
    .filter((record) => (
      record.installed.enabled
      && !record.installed.setupIncomplete
      && record.installed.sourceType === 'stremio-manifest'
      && record.descriptor?.sourceType === 'stremio-manifest'
      && Array.isArray(record.descriptor.capabilities)
      && record.descriptor.capabilities.includes('subtitle')
      && Boolean(record.descriptor.subtitle)
      && Boolean(record.descriptor.manifestUrl)
    ))
    .sort((left, right) => (
      right.installed.priority - left.installed.priority
      || stableTextCompare(left.installed.addonId, right.installed.addonId)
    ))
    .slice(0, 100);

  return {
    async resolve(request, preferredLanguages) {
      const totalBudgetMs = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : 1;
      const workerCount = Math.max(
        1,
        Math.min(MAX_SUBTITLE_PROVIDER_CONCURRENCY, providers.length || 1),
      );
      const waves = Math.max(
        1,
        Math.ceil(providers.length / workerCount),
      );
      const providerBudgetMs = Math.max(
        1,
        Math.floor(totalBudgetMs / waves),
      );
      const globalDeadline = Date.now() + totalBudgetMs;

      const groups = await mapWithConcurrency(
        providers,
        MAX_SUBTITLE_PROVIDER_CONCURRENCY,
        async (record, providerIndex) => {
          const descriptor = record.descriptor!;
          const protocolRequests = toStremioSubtitleRequests(
            descriptor,
            request,
          );
          const manifestUrl = descriptor.manifestUrl;
          if (!protocolRequests.length || !manifestUrl) return [];

          for (
            let requestIndex = 0;
            requestIndex < protocolRequests.length;
            requestIndex += 1
          ) {
            const protocolRequest = protocolRequests[requestIndex]!;
            const globalRemainingMs = globalDeadline - Date.now();
            if (globalRemainingMs <= 0) break;
            const remainingRequests = (
              protocolRequests.length - requestIndex
            );
            const attemptTimeoutMs = Math.max(
              1,
              Math.min(
                globalRemainingMs,
                Math.floor(providerBudgetMs / remainingRequests),
              ),
            );

            try {
              const url = providerRequestUrl(
                manifestUrl,
                protocolRequest.path,
              );
              const payload = await fetchBoundedJson(
                fetcher,
                url,
                attemptTimeoutMs,
                maxBytes,
              );
              const tracks = normalizeSubtitleCandidates(
                descriptor.id,
                payload,
              );
              if (tracks.length) {
                return tracks.map((track, trackIndex) => ({
                  track,
                  providerIndex,
                  trackIndex,
                }));
              }
            } catch {
              // Try another accepted IMDb/TMDB route before abandoning provider.
            }
          }

          return [];
        },
      );

      const uniqueByUrl = new Map<
        string,
        { track: SubtitleTrack; providerIndex: number; trackIndex: number }
      >();
      for (const item of groups.flat()) {
        const existing = uniqueByUrl.get(item.track.url);
        if (!existing) {
          uniqueByUrl.set(item.track.url, item);
          continue;
        }

        const richerLanguage = (
          existing.track.language === 'und'
          && item.track.language !== 'und'
        )
          ? item.track.language
          : existing.track.language;
        const richerLabel = (
          existing.track.label === existing.track.language
          && item.track.label !== item.track.language
        )
          ? item.track.label
          : existing.track.label;
        uniqueByUrl.set(item.track.url, {
          ...existing,
          track: {
            ...existing.track,
            language: richerLanguage,
            label: richerLabel,
          },
        });
      }

      return [...uniqueByUrl.values()]
        .sort((left, right) => (
          languageRank(left.track, preferredLanguages)
            - languageRank(right.track, preferredLanguages)
          || left.providerIndex - right.providerIndex
          || left.trackIndex - right.trackIndex
        ))
        .slice(0, 1_000)
        .map(({ track }) => track);
    },
  };
}

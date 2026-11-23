import {
  dedupeStreamSources,
  normalizeStreamCandidates,
} from '@moviestv/addons';
import { stableTextCompare, type StreamSource } from '@moviestv/core';
import {
  liveTvCatalogRequestPath,
  liveTvStreamRequestPath,
  parseLiveTvCatalog,
  type LiveTvChannel,
  type LiveTvProviderDescriptor,
} from '@moviestv/live-tv';
import {
  DEFAULT_PROVIDER_MAX_BYTES,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  defaultHttpFetcher,
  fetchBoundedJson,
  type HttpFetcher,
} from '../addons/HttpJsonLoader';

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
    throw new Error('Live TV provider manifest URL must be secure HTTPS');
  }
  manifest.hash = '';
  if (!manifest.pathname.endsWith('/manifest.json')) {
    throw new Error('Live TV provider manifest URL is invalid');
  }
  const basePath = manifest.pathname.slice(0, -'/manifest.json'.length);
  const hasTraversalSegment = requestPath
    .split('/')
    .some((segment) => segment === '.' || segment === '..');
  if (
    !requestPath.startsWith('/')
    || requestPath.includes('\\')
    || hasTraversalSegment
  ) {
    throw new Error('Live TV provider request path is invalid');
  }
  return `${manifest.origin}${basePath}${requestPath}${manifest.search}`;
}

const MAX_LIVE_TV_CATALOGS_PER_PROVIDER = 100;
const MAX_LIVE_TV_CATALOG_CONCURRENCY = 8;
const MAX_LIVE_TV_CHANNELS_PER_PROVIDER = 20_000;

async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  if (!items.length) return [];

  const results = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;

      try {
        results[index] = {
          status: 'fulfilled',
          value: await mapper(items[index]!, index),
        };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
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

export class StremioLiveTvAdapter {
  constructor(
    private readonly fetcher: HttpFetcher = defaultHttpFetcher,
    private readonly timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS,
    private readonly maxBytes = DEFAULT_PROVIDER_MAX_BYTES,
  ) {}

  async listChannels(
    provider: LiveTvProviderDescriptor,
    options: { timeoutMs?: number } = {},
  ): Promise<LiveTvChannel[]> {
    if (!provider.addonId.trim() || !provider.liveTv.catalogs.length) return [];
    const catalogs = provider.liveTv.catalogs
      .filter((catalog) => (
        Boolean(catalog.id?.trim())
        && Boolean(catalog.type?.trim())
        && !(catalog.requiredExtras?.length)
      ))
      .filter((catalog, index, list) => (
        list.findIndex((candidate) => (
          candidate.id === catalog.id
          && candidate.type === catalog.type
        )) === index
      ))
      .slice(0, MAX_LIVE_TV_CATALOGS_PER_PROVIDER);

    const requestedTimeoutMs = (
      typeof options.timeoutMs === 'number'
      && Number.isFinite(options.timeoutMs)
      && options.timeoutMs > 0
    )
      ? Math.max(1, Math.trunc(options.timeoutMs))
      : this.timeoutMs;
    const totalBudgetMs = (
      Number.isFinite(this.timeoutMs)
      && this.timeoutMs > 0
    )
      ? Math.min(this.timeoutMs, requestedTimeoutMs)
      : 1;
    const workerCount = Math.max(
      1,
      Math.min(MAX_LIVE_TV_CATALOG_CONCURRENCY, catalogs.length || 1),
    );
    const waves = Math.max(1, Math.ceil(catalogs.length / workerCount));
    const catalogBudgetMs = Math.max(
      1,
      Math.floor(totalBudgetMs / waves),
    );
    const deadline = Date.now() + totalBudgetMs;
    const results = await mapSettledWithConcurrency(
      catalogs,
      MAX_LIVE_TV_CATALOG_CONCURRENCY,
      async (catalog) => {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw new Error('Live TV provider catalogs timed out');
        }

        const payload = await fetchBoundedJson(
          this.fetcher,
          providerRequestUrl(
            provider.manifestUrl,
            liveTvCatalogRequestPath(catalog),
          ),
          Math.max(1, Math.min(catalogBudgetMs, remainingMs)),
          this.maxBytes,
        );
        return parseLiveTvCatalog(
          payload,
          provider.addonId,
          catalog.type,
          {
            catalogId: catalog.id,
            catalogName: catalog.name,
          },
        );
      },
    );

    const groups = results.flatMap((result) => (
      result.status === 'fulfilled' ? [result.value] : []
    ));

    if (!groups.length && results.some((result) => result.status === 'rejected')) {
      const rejected = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (rejected?.reason instanceof Error) throw rejected.reason;
      throw new Error('Live TV provider catalogs unavailable');
    }

    const seen = new Set<string>();
    return groups
      .flat()
      .filter((channel) => {
        if (seen.has(channel.id)) return false;
        seen.add(channel.id);
        return true;
      })
      .sort((left, right) => (
        stableTextCompare(
          left.title.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase(),
          right.title.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase(),
        )
        || stableTextCompare(left.title, right.title)
      ))
      .slice(0, MAX_LIVE_TV_CHANNELS_PER_PROVIDER);
  }

  async resolveChannel(
    provider: LiveTvProviderDescriptor,
    channel: LiveTvChannel,
    options: { timeoutMs?: number } = {},
  ): Promise<StreamSource[]> {
    if (channel.providerId !== provider.addonId
      || !channel.remoteId?.trim()
      || !channel.resourceType?.trim()
      || !provider.liveTv.streamTypes.includes(channel.resourceType)) {
      throw new Error('Channel does not belong to this Live TV provider');
    }

    const requestedTimeoutMs = (
      typeof options.timeoutMs === 'number'
      && Number.isFinite(options.timeoutMs)
      && options.timeoutMs > 0
    )
      ? Math.max(1, Math.trunc(options.timeoutMs))
      : this.timeoutMs;
    const effectiveTimeoutMs = (
      Number.isFinite(this.timeoutMs)
      && this.timeoutMs > 0
    )
      ? Math.min(this.timeoutMs, requestedTimeoutMs)
      : 1;

    const payload = await fetchBoundedJson(
      this.fetcher,
      providerRequestUrl(
        provider.manifestUrl,
        liveTvStreamRequestPath(channel.resourceType, channel.remoteId),
      ),
      effectiveTimeoutMs,
      this.maxBytes,
    );
    return dedupeStreamSources([
      normalizeStreamCandidates(provider.addonId, payload),
    ]).filter((source) => Boolean(source.url?.trim()));
  }
}

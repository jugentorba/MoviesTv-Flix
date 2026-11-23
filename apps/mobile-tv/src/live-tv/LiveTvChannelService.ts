import { stableTextCompare } from '@moviestv/core';
import type { LiveTvChannel, LiveTvProviderDescriptor } from '@moviestv/live-tv';
import {
  aggregateLiveTvChannels,
  type LiveTvBrowserChannel,
} from './live-tv-aggregation';

interface ChannelListOptions {
  timeoutMs?: number;
}

interface ChannelAdapter {
  listChannels(
    provider: LiveTvProviderDescriptor,
    options?: ChannelListOptions,
  ): Promise<LiveTvChannel[]>;
  truncatedProviderIds?(): readonly string[];
}

export interface LiveTvChannelLoadResult {
  channels: LiveTvBrowserChannel[];
  failedProviderIds: string[];
  providerCount: number;
  /**
   * Providers whose channel list was cut by the adapter's own bound, so the
   * screen can say the import was not complete. Empty when nothing was cut.
   */
  truncatedProviderIds: string[];
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const STALE_CACHE_MAX_MS = 24 * 60 * 60 * 1000;
const MAX_LIVE_TV_PROVIDERS = 100;
const MAX_CONCURRENT_LIVE_TV_PROVIDERS = 8;
const DEFAULT_LIVE_TV_PROVIDER_DISCOVERY_TIMEOUT_MS = 8_000;
const MAX_CACHED_CHANNELS_PER_PROVIDER = 20_000;
const MAX_LIVE_TV_CACHE_ENTRIES = 200;

function providerCacheKey(provider: LiveTvProviderDescriptor): string {
  const catalogs = provider.liveTv.catalogs
    .map((catalog) => {
      const requiredExtras = [...(catalog.requiredExtras ?? [])]
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean)
        .sort();
      return JSON.stringify([
        catalog.type,
        catalog.id,
        catalog.name?.trim() ?? '',
        requiredExtras,
      ]);
    })
    .slice()
    .sort();
  const streamTypes = [...provider.liveTv.streamTypes].sort();
  return JSON.stringify([
    provider.addonId,
    provider.manifestUrl,
    catalogs,
    streamTypes,
  ]);
}

function safeText(
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

function hasCredentialPathSegment(pathname: string): boolean {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  const credentialSegment =
    /^(?:access[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|sig|credential|session|debrid|alldebrid|realdebrid)(?:=|:).+/i;
  return decoded
    .split('/')
    .some((segment) => credentialSegment.test(segment));
}

function safePoster(value: unknown): string | undefined {
  const normalized = safeText(value, 2_048);
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    const sensitive =
      /token|key|secret|auth|signature|session|credential/i;
    const hasSensitiveQuery = [...url.searchParams.entries()].some(
      ([key, queryValue]) => (
        sensitive.test(key)
        || sensitive.test(queryValue)
      ),
    );
    let fragment = url.hash.slice(1);
    try {
      fragment = decodeURIComponent(fragment);
    } catch {
      return undefined;
    }
    const hasSensitiveFragment = sensitive.test(fragment);
    return (
      url.protocol === 'https:'
      && !url.username
      && !url.password
      && !hasSensitiveQuery
      && !hasSensitiveFragment
      && !hasCredentialPathSegment(url.pathname)
      && url.href.length <= 2_048
    )
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Live TV provider timed out')),
      Math.max(1, timeoutMs),
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

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

function safeDirectStreamUrl(value: unknown): string | undefined {
  const normalized = safeText(value, 4_096);
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/**
 * Reduce a provider channel to the fields Live TV keeps.
 *
 * `directStreamUrl` is preserved only for playlist providers, and only after
 * re-validation. It is runtime-only: the channel cache lives in memory and is
 * dropped when the identity changes, so the URL never reaches disk or a sync
 * payload.
 */
function metadataOnly(
  channel: LiveTvChannel,
  options: { allowDirectStream?: boolean } = {},
): LiveTvChannel | null {
  const id = safeText(channel.id, 512);
  const providerId = safeText(channel.providerId, 512);
  const remoteId = safeText(channel.remoteId, 512);
  const title = safeText(channel.title, 500);
  const resourceType = channel.resourceType;
  if (
    !id
    || !providerId
    || !remoteId
    || !title
    || (resourceType !== 'channel' && resourceType !== 'tv')
  ) return null;

  const directStreamUrl = options.allowDirectStream
    ? safeDirectStreamUrl(channel.directStreamUrl)
    : undefined;
  const posterUrl = safePoster(channel.posterUrl);
  const countryCode = safeText(channel.countryCode, 2)?.toUpperCase();
  const genres = Array.isArray(channel.genres)
    ? [...new Set(
      channel.genres
        .slice(0, 100)
        .flatMap((genre) => {
          const normalized = safeText(genre, 128);
          return normalized ? [normalized] : [];
        }),
    )]
    : [];

  return {
    id,
    providerId,
    remoteId,
    resourceType,
    title,
    ...(posterUrl ? { posterUrl } : {}),
    ...(countryCode && /^[A-Z]{2}$/.test(countryCode)
      ? { countryCode }
      : {}),
    ...(genres.length ? { genres } : {}),
    ...(directStreamUrl ? { directStreamUrl } : {}),
  };
}

export class LiveTvChannelService {
  private readonly cache = new Map<string, {
    expiresAt: number;
    staleUntil: number;
    channels: LiveTvChannel[];
  }>();
  private readonly loadGenerations = new Map<string, number>();
  private nextLoadGeneration = 1;

  constructor(
    private readonly adapter: ChannelAdapter,
    private readonly now: () => number = Date.now,
    private readonly providerTimeoutMs =
      DEFAULT_LIVE_TV_PROVIDER_DISCOVERY_TIMEOUT_MS,
  ) {}

  private pruneCache(nowMs: number): void {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.staleUntil <= nowMs) this.cache.delete(key);
    }

    if (this.cache.size <= MAX_LIVE_TV_CACHE_ENTRIES) return;
    const ordered = [...this.cache.entries()]
      .sort((left, right) => (
        left[1].staleUntil - right[1].staleUntil
        || stableTextCompare(left[0], right[0])
      ));
    const excess = ordered.length - MAX_LIVE_TV_CACHE_ENTRIES;
    for (let index = 0; index < excess; index += 1) {
      const key = ordered[index]?.[0];
      if (key) this.cache.delete(key);
    }
  }

  async load(
    providers: readonly LiveTvProviderDescriptor[],
    options: { refresh?: boolean } = {},
  ): Promise<LiveTvChannelLoadResult> {
    this.pruneCache(this.now());
    const failedProviderIds: string[] = [];
    const uniqueProviders = providers
      .filter((provider) => Boolean(provider?.addonId?.trim()))
      .slice()
      .sort((left, right) => (
        right.priority - left.priority
        || stableTextCompare(left.addonId, right.addonId)
      ))
      .filter((provider, index, list) => (
        list.findIndex((candidate) => (
          providerCacheKey(candidate) === providerCacheKey(provider)
        )) === index
      ))
      .slice(0, MAX_LIVE_TV_PROVIDERS);
    const totalBudgetMs = Number.isFinite(this.providerTimeoutMs)
      && this.providerTimeoutMs > 0
      ? this.providerTimeoutMs
      : 1;
    const networkProviderCount = uniqueProviders.reduce(
      (count, provider) => {
        const cached = this.cache.get(providerCacheKey(provider));
        const freshCacheHit = (
          !options.refresh
          && cached
          && cached.expiresAt > this.now()
        );
        return freshCacheHit ? count : count + 1;
      },
      0,
    );
    const workerCount = Math.max(
      1,
      Math.min(
        MAX_CONCURRENT_LIVE_TV_PROVIDERS,
        networkProviderCount || 1,
      ),
    );
    const waves = Math.max(
      1,
      Math.ceil(networkProviderCount / workerCount),
    );
    const providerBudgetMs = Math.max(
      1,
      Math.floor(totalBudgetMs / waves),
    );
    const deadline = this.now() + totalBudgetMs;

    const groups = await mapWithConcurrency(
      uniqueProviders,
      MAX_CONCURRENT_LIVE_TV_PROVIDERS,
      async (provider) => {
      const cacheKey = providerCacheKey(provider);
      const cached = this.cache.get(cacheKey);
      // Playlist providers own their stream URLs; add-on providers must not.
      const keepDirectStream = (channel: LiveTvChannel) =>
        metadataOnly(channel, { allowDirectStream: provider.kind === 'playlist' });
      if (!options.refresh && cached && cached.expiresAt > this.now()) {
        return {
          provider,
          channels: cached.channels
            .map(keepDirectStream)
            .filter((channel): channel is LiveTvChannel => channel !== null),
        };
      }
      const generation = this.nextLoadGeneration;
      this.nextLoadGeneration = (
        this.nextLoadGeneration >= Number.MAX_SAFE_INTEGER
          ? 1
          : this.nextLoadGeneration + 1
      );
      this.loadGenerations.set(cacheKey, generation);
      try {
        const remainingMs = deadline - this.now();
        if (remainingMs <= 0) {
          throw new Error('Live TV provider discovery timed out');
        }
        const attemptTimeoutMs = Math.max(
          1,
          Math.min(providerBudgetMs, remainingMs),
        );
        const channels = (await withTimeout(
          this.adapter.listChannels(
            provider,
            { timeoutMs: attemptTimeoutMs },
          ),
          attemptTimeoutMs,
        ))
          .slice(0, MAX_CACHED_CHANNELS_PER_PROVIDER)
          .map(keepDirectStream)
          .filter((channel): channel is LiveTvChannel => (
            channel !== null
            && channel.providerId === provider.addonId
          ));
        const loadedAt = this.now();
        if (this.loadGenerations.get(cacheKey) === generation) {
          this.cache.set(cacheKey, {
            expiresAt: loadedAt + CACHE_TTL_MS,
            staleUntil: loadedAt + STALE_CACHE_MAX_MS,
            channels: channels
              .map(keepDirectStream)
              .filter((channel): channel is LiveTvChannel => channel !== null),
          });
          this.pruneCache(loadedAt);
        }
        return { provider, channels };
      } catch {
        if (!failedProviderIds.includes(provider.addonId)) failedProviderIds.push(provider.addonId);
        if (cached && cached.staleUntil > this.now()) {
          return {
            provider,
            channels: cached.channels
            .map(keepDirectStream)
            .filter((channel): channel is LiveTvChannel => channel !== null),
          };
        }
        return { provider, channels: [] as LiveTvChannel[] };
      } finally {
        if (this.loadGenerations.get(cacheKey) === generation) {
          this.loadGenerations.delete(cacheKey);
        }
      }
      },
    );

    const loadedProviderIds = new Set(
      uniqueProviders.map((provider) => provider.addonId),
    );

    return {
      channels: aggregateLiveTvChannels(groups),
      failedProviderIds: failedProviderIds.sort(),
      providerCount: uniqueProviders.length,
      truncatedProviderIds: [...new Set(
        (this.adapter.truncatedProviderIds?.() ?? [])
          .filter((addonId) => loadedProviderIds.has(addonId)),
      )].sort(),
    };
  }
}

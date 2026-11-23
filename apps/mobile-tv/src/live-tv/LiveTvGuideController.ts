import {
  guideNowNext,
  matchGuideChannels,
  type GuideNowNext,
  type GuideProgramme,
  type GuideSnapshot,
  type LiveTvChannel,
} from '@moviestv/live-tv';
import type { GuideConfigState } from './LiveTvGuideRepository';
import { isLiveTvBrowserChannel } from './live-tv-aggregation';

const GUIDE_FRESH_MS = 30 * 60 * 1000;
const GUIDE_STALE_MAX_MS = 6 * 60 * 60 * 1000;

export type LiveTvGuideStatus = 'unconfigured' | 'ready' | 'stale' | 'unavailable';

export interface LiveTvGuideState {
  status: LiveTvGuideStatus;
  snapshot: GuideSnapshot | undefined;
  matches: Map<string, string>;
  message?: string;
}

export interface LiveTvGuideRepositoryLike {
  loadConfig(): Promise<GuideConfigState>;
  resolveUrl(): Promise<string | null>;
  loadCache(sourceRevision: number): Promise<GuideSnapshot | null>;
  saveCache(snapshot: GuideSnapshot): Promise<void>;
}

export interface LiveTvGuideProviderLike {
  load(url: string, sourceRevision: number): Promise<GuideSnapshot>;
}

function stableTextCompare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function guideCandidates(channels: readonly LiveTvChannel[]) {
  return channels.map((channel) => ({
    id: channel.id,
    title: channel.title,
    countryCode: channel.countryCode,
    remoteIds: isLiveTvBrowserChannel(channel)
      ? channel.variants.map((variant) => variant.channel.remoteId)
      : [channel.remoteId],
  }));
}

function matchesFor(
  channels: readonly LiveTvChannel[],
  snapshot: GuideSnapshot | undefined,
): Map<string, string> {
  return snapshot
    ? matchGuideChannels(guideCandidates(channels), snapshot.channels)
    : new Map();
}

function cacheAge(snapshot: GuideSnapshot, nowMs: number): number {
  return Math.max(0, nowMs - snapshot.fetchedAtMs);
}

export class LiveTvGuideController {
  private loadGeneration = 0;
  private readonly programmeGroups = new WeakMap<
    GuideSnapshot,
    Map<string, readonly GuideProgramme[]>
  >();

  constructor(
    private readonly repository: LiveTvGuideRepositoryLike,
    private readonly provider: LiveTvGuideProviderLike,
  ) {}

  load(channels: readonly LiveTvChannel[], nowMs: number): Promise<LiveTvGuideState> {
    return this.loadInternal(channels, nowMs, false);
  }

  refresh(
    channels: readonly LiveTvChannel[],
    nowMs: number,
  ): Promise<LiveTvGuideState> {
    return this.loadInternal(channels, nowMs, true);
  }

  private async loadInternal(
    channels: readonly LiveTvChannel[],
    nowMs: number,
    forceRefresh: boolean,
  ): Promise<LiveTvGuideState> {
    if (!Number.isFinite(nowMs) || nowMs < 0) {
      return { status: 'unavailable', snapshot: undefined, matches: new Map(), message: 'Programme guide unavailable.' };
    }
    const generation = ++this.loadGeneration;
    let config: GuideConfigState;
    try {
      config = await this.repository.loadConfig();
    } catch {
      return {
        status: 'unavailable',
        snapshot: undefined,
        matches: new Map(),
        message: 'Programme guide unavailable.',
      };
    }
    if (!config.configured) {
      return {
        status: 'unconfigured',
        snapshot: undefined,
        matches: new Map(),
      };
    }

    let url: string | null;
    try {
      url = await this.repository.resolveUrl();
    } catch {
      return {
        status: 'unavailable',
        snapshot: undefined,
        matches: new Map(),
        message: 'Programme guide unavailable.',
      };
    }
    if (!url) {
      return {
        status: 'unavailable',
        snapshot: undefined,
        matches: new Map(),
        message: 'Guide source is missing on this device.',
      };
    }

    let cache: GuideSnapshot | null = null;
    try {
      cache = await this.repository.loadCache(config.sourceRevision);
    } catch {
      // Cache is optional. A local storage failure must not block a fresh
      // network guide load when the configured source is still available.
    }
    const usableCache = cache && cache.fetchedAtMs <= nowMs + 5 * 60 * 1000 ? cache : null;
    if (!forceRefresh && usableCache && cacheAge(usableCache, nowMs) <= GUIDE_FRESH_MS) {
      return {
        status: 'ready',
        snapshot: usableCache,
        matches: matchesFor(channels, usableCache),
      };
    }

    try {
      const fresh = await this.provider.load(url, config.sourceRevision);
      if (generation !== this.loadGeneration) {
        return usableCache
          ? { status: 'stale', snapshot: usableCache, matches: matchesFor(channels, usableCache), message: 'Guide may be outdated because refresh was superseded.' }
          : { status: 'unavailable', snapshot: undefined, matches: new Map(), message: 'Programme guide unavailable.' };
      }
      if (fresh.sourceRevision !== config.sourceRevision) throw new Error('Guide revision mismatch');
      if (generation === this.loadGeneration) {
        try {
          await this.repository.saveCache(fresh);
        } catch {
          // Fresh guide data is already usable in memory. Cache persistence is
          // best effort and must not downgrade a successful refresh.
        }
      }
      return {
        status: 'ready',
        snapshot: fresh,
        matches: matchesFor(channels, fresh),
      };
    } catch {
      if (usableCache && cacheAge(usableCache, nowMs) <= GUIDE_STALE_MAX_MS) {
        return {
          status: 'stale',
          snapshot: usableCache,
          matches: matchesFor(channels, usableCache),
          message: 'Guide may be outdated because refresh failed.',
        };
      }

      return {
        status: 'unavailable',
        snapshot: undefined,
        matches: new Map(),
        message: 'Programme guide unavailable.',
      };
    }
  }

  private programmesForChannel(
    snapshot: GuideSnapshot,
    channelId: string,
  ): readonly GuideProgramme[] {
    let groups = this.programmeGroups.get(snapshot);
    if (!groups) {
      const mutable = new Map<string, GuideProgramme[]>();
      for (const programme of snapshot.programmes) {
        const group = mutable.get(programme.channelId);
        if (group) group.push(programme);
        else mutable.set(programme.channelId, [programme]);
      }

      groups = new Map(
        [...mutable.entries()].map(([id, programmes]) => [
          id,
          programmes,
        ]),
      );
      this.programmeGroups.set(snapshot, groups);
    }

    return groups.get(channelId) ?? [];
  }

  nowNext(
    state: LiveTvGuideState,
    channelId: string,
    nowMs: number,
  ): GuideNowNext {
    if (!Number.isFinite(nowMs) || nowMs < 0) return { now: undefined, next: undefined };
    const guideChannelId = state.matches.get(channelId);
    if (!state.snapshot || !guideChannelId) {
      return { now: undefined, next: undefined };
    }
    return guideNowNext(
      this.programmesForChannel(state.snapshot, guideChannelId),
      guideChannelId,
      nowMs,
    );
  }

  timeline(
    state: LiveTvGuideState,
    channelId: string,
    nowMs: number,
  ) {
    if (!Number.isFinite(nowMs) || nowMs < 0) return [];
    const guideChannelId = state.matches.get(channelId);
    if (!state.snapshot || !guideChannelId) return [];

    const ordered = this.programmesForChannel(
      state.snapshot,
      guideChannelId,
    )
      .filter((programme) => (
        Number.isFinite(programme.startAtMs)
        && Number.isFinite(programme.endAtMs)
        && programme.endAtMs > programme.startAtMs
      ))
      .slice()
      .sort((left, right) => (
        left.startAtMs - right.startAtMs
        || left.endAtMs - right.endAtMs
        || stableTextCompare(left.title, right.title)
      ));
    const current = ordered.find((programme) => (
      programme.startAtMs <= nowMs
      && nowMs < programme.endAtMs
    ));
    const future = ordered.filter(
      (programme) => programme.startAtMs > nowMs,
    );

    return current ? [current, ...future] : future;
  }
}

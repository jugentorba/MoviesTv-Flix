import type { StreamSource } from '@moviestv/core';
import {
  MAX_M3U_TEXT_LENGTH,
  isPlaylistLiveTvChannel,
  m3uChannelsToLiveTvChannels,
  m3uProviderDescriptor,
  parseM3uPlaylist,
  type LiveTvChannel,
  type LiveTvProviderDescriptor,
} from '@moviestv/live-tv';
import { defaultHttpFetcher, type HttpFetcher } from '../addons/HttpJsonLoader';
import { DEFAULT_GUIDE_TIMEOUT_MS, fetchBoundedText } from './HttpTextLoader';

export interface ChannelListOptions {
  timeoutMs?: number;
}

/**
 * One stored playlist.
 *
 * `url` normally embeds provider credentials in the path, so the whole record
 * is secret: it belongs in secure storage on native, in memory on web, and
 * never in a sync payload, a log or an error message.
 */
export interface M3uPlaylistRecord {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  url: string;
}

export interface M3uPlaylistSource {
  list(): Promise<readonly M3uPlaylistRecord[]>;
}

const MAX_URL_LENGTH = 4_096;

function playableUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.href;
}

/**
 * Live TV adapter for imported M3U playlists.
 *
 * Unlike a Stremio add-on, a playlist has no stream endpoint: the channel's
 * own URL is the stream, so `resolveChannel` never performs a request. Only
 * `listChannels` fetches, and it re-fetches the playlist so that a refresh
 * picks up provider-side changes.
 */
export class M3uLiveTvAdapter {
  /** Providers whose last fetch was cut at `MAX_M3U_CHANNELS`. */
  private readonly truncated = new Set<string>();

  constructor(
    private readonly source: M3uPlaylistSource,
    private readonly fetcher: HttpFetcher = defaultHttpFetcher,
    private readonly timeoutMs = DEFAULT_GUIDE_TIMEOUT_MS,
    private readonly maxBytes = MAX_M3U_TEXT_LENGTH,
  ) {}

  /** Enabled playlists as Live TV provider descriptors. */
  async providers(): Promise<LiveTvProviderDescriptor[]> {
    let records: readonly M3uPlaylistRecord[];
    try {
      records = await this.source.list();
    } catch {
      return [];
    }
    if (!Array.isArray(records)) return [];

    const providers: LiveTvProviderDescriptor[] = [];
    const seen = new Set<string>();
    for (const record of records) {
      if (!record || record.enabled === false) continue;
      if (!playableUrl(record.url)) continue;
      const descriptor = m3uProviderDescriptor({
        id: record.id,
        name: record.name,
        priority: record.priority,
      });
      if (!descriptor || seen.has(descriptor.addonId)) continue;
      seen.add(descriptor.addonId);
      providers.push(descriptor);
    }

    return providers.sort((left, right) => (
      right.priority - left.priority
      || left.addonId.localeCompare(right.addonId)
    ));
  }

  async listChannels(
    provider: LiveTvProviderDescriptor,
    options: ChannelListOptions = {},
  ): Promise<LiveTvChannel[]> {
    if (provider.kind !== 'playlist') return [];
    const record = await this.recordFor(provider);
    if (!record) return [];

    const url = playableUrl(record.url);
    if (!url) throw new Error('Playlist URL is not playable');

    const requestedTimeoutMs = (
      typeof options.timeoutMs === 'number'
      && Number.isFinite(options.timeoutMs)
      && options.timeoutMs > 0
    )
      ? Math.max(1, Math.trunc(options.timeoutMs))
      : this.timeoutMs;
    const effectiveTimeoutMs = Math.max(
      1,
      Math.min(this.timeoutMs, requestedTimeoutMs),
    );

    const text = await fetchBoundedText(
      this.fetcher,
      url,
      effectiveTimeoutMs,
      this.maxBytes,
      { allowHttp: true, label: 'Playlist' },
    );

    const parsed = parseM3uPlaylist(text);
    if (!parsed.playlist) throw new Error('Playlist could not be read');
    // A single stream manifest is valid M3U but not a channel list.
    if (parsed.playlist.kind !== 'playlist') return [];

    // Keep the truncation state so the screen can tell the user that the
    // playlist was not imported in full; `listChannels` has no other channel
    // to carry it.
    if (parsed.playlist.truncated) this.truncated.add(provider.addonId);
    else this.truncated.delete(provider.addonId);

    return m3uChannelsToLiveTvChannels(
      provider,
      parsed.playlist.channels,
    );
  }

  /**
   * Providers whose last `listChannels` call dropped entries at the channel
   * cap. A provider that no longer exists simply never appears here.
   */
  truncatedProviderIds(): string[] {
    return [...this.truncated].sort();
  }

  /**
   * A playlist channel carries its own URL, so resolution is local. The URL is
   * re-validated here because the channel may have travelled through the
   * aggregation layer.
   */
  async resolveChannel(
    provider: LiveTvProviderDescriptor,
    channel: LiveTvChannel,
  ): Promise<StreamSource[]> {
    if (
      provider.kind !== 'playlist'
      || channel.providerId !== provider.addonId
    ) {
      throw new Error('Channel does not belong to this Live TV provider');
    }
    const url = isPlaylistLiveTvChannel(channel)
      ? playableUrl(channel.directStreamUrl)
      : null;
    if (!url) throw new Error('Channel has no playable stream');

    return [{
      id: `${provider.addonId}:${channel.id}`,
      providerId: provider.addonId,
      sourceId: channel.remoteId,
      name: channel.title,
      url,
    }];
  }

  private async recordFor(
    provider: LiveTvProviderDescriptor,
  ): Promise<M3uPlaylistRecord | null> {
    let records: readonly M3uPlaylistRecord[];
    try {
      records = await this.source.list();
    } catch {
      return null;
    }
    if (!Array.isArray(records)) return null;
    return records.find((record) => (
      record
      && record.enabled !== false
      // Compare through the descriptor so a stored id is normalized exactly
      // the same way as when the provider was created.
      && m3uProviderDescriptor({
        id: record.id,
        name: record.name,
        priority: 0,
      })?.addonId === provider.addonId
    )) ?? null;
  }
}

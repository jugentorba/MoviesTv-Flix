import type { StreamSource } from '@moviestv/core';
import type {
  LiveTvChannel,
  LiveTvProviderDescriptor,
} from '@moviestv/live-tv';

export interface ChannelListOptions {
  timeoutMs?: number;
}

/**
 * What Live TV needs from a provider backend: the channel list and a way to
 * turn one channel into playable sources.
 */
export interface LiveTvChannelAdapter {
  listChannels(
    provider: LiveTvProviderDescriptor,
    options?: ChannelListOptions,
  ): Promise<LiveTvChannel[]>;
  /**
   * Optional: providers whose last channel list was cut by the backend's own
   * bound, so the screen can say the import was not complete.
   */
  truncatedProviderIds?(): readonly string[];
  resolveChannel(
    provider: LiveTvProviderDescriptor,
    channel: LiveTvChannel,
    options?: ChannelListOptions,
  ): Promise<StreamSource[]>;
}

/**
 * Sends each provider to the backend that owns it.
 *
 * Add-on providers are fetched over HTTP; playlist providers already hold
 * their stream URLs. Routing lives here so `LiveTvChannelService` and
 * `LiveTvPlaybackController` keep one adapter and never branch on provider
 * kind themselves.
 */
export class RoutedLiveTvAdapter implements LiveTvChannelAdapter {
  constructor(
    private readonly addon: LiveTvChannelAdapter,
    private readonly playlist: LiveTvChannelAdapter,
  ) {}

  listChannels(
    provider: LiveTvProviderDescriptor,
    options: ChannelListOptions = {},
  ): Promise<LiveTvChannel[]> {
    return this.forProvider(provider).listChannels(provider, options);
  }

  resolveChannel(
    provider: LiveTvProviderDescriptor,
    channel: LiveTvChannel,
    options: ChannelListOptions = {},
  ): Promise<StreamSource[]> {
    return this.forProvider(provider).resolveChannel(provider, channel, options);
  }

  truncatedProviderIds(): readonly string[] {
    return [
      ...new Set([
        ...(this.addon.truncatedProviderIds?.() ?? []),
        ...(this.playlist.truncatedProviderIds?.() ?? []),
      ]),
    ].sort();
  }

  private forProvider(
    provider: LiveTvProviderDescriptor,
  ): LiveTvChannelAdapter {
    return provider?.kind === 'playlist' ? this.playlist : this.addon;
  }
}

import type { StreamSource } from '@moviestv/core';
import type {
  LiveTvChannel,
  LiveTvProviderDescriptor,
} from '@moviestv/live-tv';
import {
  RoutedLiveTvAdapter,
  type LiveTvChannelAdapter,
} from '../RoutedLiveTvAdapter';

function provider(kind?: 'addon' | 'playlist'): LiveTvProviderDescriptor {
  return {
    addonId: kind === 'playlist' ? 'm3u:one' : 'org.example.tv',
    name: 'Provider',
    manifestUrl: kind === 'playlist' ? '' : 'https://provider.example/manifest.json',
    priority: 10,
    liveTv: { catalogs: [], streamTypes: ['channel'] },
    ...(kind ? { kind } : {}),
  };
}

const channel: LiveTvChannel = {
  id: 'channel-1',
  providerId: 'org.example.tv',
  remoteId: 'channel-1',
  resourceType: 'channel',
  title: 'Channel 1',
};

const source: StreamSource = {
  id: 'source-1',
  url: 'https://stream.example/one.m3u8',
};

function stub(label: string): LiveTvChannelAdapter & {
  listChannels: jest.Mock;
  resolveChannel: jest.Mock;
} {
  return {
    listChannels: jest.fn(async () => [{
      ...channel,
      title: `listed by ${label}`,
    }]),
    resolveChannel: jest.fn(async () => [{
      ...source,
      id: `source-${label}`,
    }]),
  };
}

describe('RoutedLiveTvAdapter', () => {
  test('routes an add-on provider to the add-on adapter', async () => {
    const addon = stub('addon');
    const playlist = stub('playlist');
    const router = new RoutedLiveTvAdapter(addon, playlist);

    const channels = await router.listChannels(provider('addon'));
    const sources = await router.resolveChannel(provider('addon'), channel);

    expect(channels[0]?.title).toBe('listed by addon');
    expect(sources[0]?.id).toBe('source-addon');
    expect(playlist.listChannels).not.toHaveBeenCalled();
    expect(playlist.resolveChannel).not.toHaveBeenCalled();
  });


  test('merges truncation state from both backends', () => {
    const addon: LiveTvChannelAdapter = {
      ...stub('addon'),
      truncatedProviderIds: () => ['org.example.tv'],
    };
    const playlist: LiveTvChannelAdapter = {
      ...stub('playlist'),
      truncatedProviderIds: () => ['m3u:one', 'org.example.tv'],
    };

    expect(new RoutedLiveTvAdapter(addon, playlist).truncatedProviderIds())
      .toEqual(['m3u:one', 'org.example.tv']);
    expect(new RoutedLiveTvAdapter(stub('addon'), stub('playlist'))
      .truncatedProviderIds()).toEqual([]);
  });

  test('treats an absent kind as an add-on provider', async () => {
    const addon = stub('addon');
    const playlist = stub('playlist');
    const router = new RoutedLiveTvAdapter(addon, playlist);

    await router.listChannels(provider());

    expect(addon.listChannels).toHaveBeenCalled();
    expect(playlist.listChannels).not.toHaveBeenCalled();
  });

  test('routes a playlist provider to the playlist adapter', async () => {
    const addon = stub('addon');
    const playlist = stub('playlist');
    const router = new RoutedLiveTvAdapter(addon, playlist);

    const channels = await router.listChannels(provider('playlist'));
    const sources = await router.resolveChannel(provider('playlist'), channel);

    expect(channels[0]?.title).toBe('listed by playlist');
    expect(sources[0]?.id).toBe('source-playlist');
    expect(addon.listChannels).not.toHaveBeenCalled();
    expect(addon.resolveChannel).not.toHaveBeenCalled();
  });

  test('forwards the caller budget unchanged', async () => {
    const addon = stub('addon');
    const router = new RoutedLiveTvAdapter(addon, stub('playlist'));

    await router.listChannels(provider('addon'), { timeoutMs: 1_234 });

    expect(addon.listChannels).toHaveBeenCalledWith(
      expect.objectContaining({ addonId: 'org.example.tv' }),
      { timeoutMs: 1_234 },
    );
  });
});

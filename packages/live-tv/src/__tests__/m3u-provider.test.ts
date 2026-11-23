import type { M3uChannel } from '../m3u';
import {
  MAX_M3U_PLAYLIST_NAME_LENGTH,
  MAX_M3U_PROVIDER_CHANNELS,
  isPlaylistLiveTvChannel,
  m3uChannelsToLiveTvChannels,
  m3uProviderAddonId,
  m3uProviderDescriptor,
} from '../m3u-provider';

function entry(overrides: Partial<M3uChannel> = {}): M3uChannel {
  return {
    id: 'm3u:news.fr',
    name: 'France Info',
    streamUrl: 'https://stream.example/news.m3u8',
    ...overrides,
  };
}

const descriptor = m3uProviderDescriptor({
  id: 'playlist-1',
  name: 'My Playlist',
  priority: 50,
})!;

describe('M3U provider descriptor', () => {
  test('is a playlist provider with no manifest or catalogs', () => {
    expect(descriptor).toEqual({
      addonId: 'm3u:playlist-1',
      name: 'My Playlist',
      manifestUrl: '',
      priority: 50,
      liveTv: { catalogs: [], streamTypes: ['channel'] },
      kind: 'playlist',
    });
  });

  test('namespaces the provider id so it cannot collide with an add-on', () => {
    expect(m3uProviderAddonId('abc')).toBe('m3u:abc');
  });

  test('truncates a long name and floors a fractional priority', () => {
    const long = m3uProviderDescriptor({
      id: 'playlist-1',
      name: 'N'.repeat(400),
      priority: 12.8,
    })!;

    expect(long.name).toHaveLength(MAX_M3U_PLAYLIST_NAME_LENGTH);
    expect(long.priority).toBe(12);
  });

  test('rejects a missing, empty or unsafe id and a missing name', () => {
    expect(m3uProviderDescriptor({ id: '', name: 'X', priority: 0 })).toBeNull();
    expect(m3uProviderDescriptor({ id: '   ', name: 'X', priority: 0 })).toBeNull();
    expect(m3uProviderDescriptor({ id: 'a/b', name: 'X', priority: 0 })).toBeNull();
    expect(m3uProviderDescriptor({ id: 'a b', name: 'X', priority: 0 })).toBeNull();
    expect(m3uProviderDescriptor({ id: 'ok', name: '  ', priority: 0 })).toBeNull();
  });
});

describe('M3U channels as Live TV channels', () => {
  test('carries the stream URL and playlist metadata', () => {
    const [channel] = m3uChannelsToLiveTvChannels(descriptor, [
      entry({
        logoUrl: 'https://img.example/news.png',
        group: 'News',
        countryCode: 'fr',
      }),
    ]);

    expect(channel).toEqual({
      id: 'm3u:news.fr',
      providerId: 'm3u:playlist-1',
      remoteId: 'm3u:news.fr',
      resourceType: 'channel',
      title: 'France Info',
      posterUrl: 'https://img.example/news.png',
      countryCode: 'FR',
      genres: ['News'],
      directStreamUrl: 'https://stream.example/news.m3u8',
    });
  });

  test('omits metadata that is absent', () => {
    const [channel] = m3uChannelsToLiveTvChannels(descriptor, [entry()]);

    expect(channel).not.toHaveProperty('posterUrl');
    expect(channel).not.toHaveProperty('countryCode');
    expect(channel).not.toHaveProperty('genres');
  });

  test('drops entries with no playable URL', () => {
    const channels = m3uChannelsToLiveTvChannels(descriptor, [
      entry({ streamUrl: 'file:///etc/passwd' }),
      entry({ id: 'm3u:two', streamUrl: 'ftp://example/stream' }),
      entry({ id: 'm3u:three', streamUrl: 'https://user:pass@example/secret' }),
      entry({ id: 'm3u:four' }),
    ]);

    expect(channels.map((channel) => channel.id)).toEqual(['m3u:four']);
  });

  test('keeps path credentials, which IPTV providers use', () => {
    const [channel] = m3uChannelsToLiveTvChannels(descriptor, [
      entry({ streamUrl: 'http://host.example:8080/live/user/pass/12.ts' }),
    ]);

    expect(channel?.directStreamUrl)
      .toBe('http://host.example:8080/live/user/pass/12.ts');
  });

  test('drops an entry with no title', () => {
    expect(m3uChannelsToLiveTvChannels(descriptor, [
      entry({ name: '   ' }),
    ])).toEqual([]);
  });

  test('deduplicates by channel id', () => {
    const channels = m3uChannelsToLiveTvChannels(descriptor, [
      entry(),
      entry({ streamUrl: 'https://stream.example/other.m3u8' }),
    ]);

    expect(channels).toHaveLength(1);
    expect(channels[0]?.directStreamUrl).toBe('https://stream.example/news.m3u8');
  });

  test('ignores channels belonging to an add-on provider', () => {
    const addonProvider = {
      ...descriptor,
      addonId: 'org.example.tv',
      kind: 'addon' as const,
    };

    expect(m3uChannelsToLiveTvChannels(addonProvider, [entry()])).toEqual([]);
  });

  test('stops at the per-provider channel cap', () => {
    const many: M3uChannel[] = [];
    for (let index = 0; index < MAX_M3U_PROVIDER_CHANNELS + 3; index += 1) {
      many.push(entry({
        id: `m3u:${index}`,
        name: `Channel ${index}`,
        streamUrl: `https://stream.example/${index}.m3u8`,
      }));
    }

    expect(m3uChannelsToLiveTvChannels(descriptor, many))
      .toHaveLength(MAX_M3U_PROVIDER_CHANNELS);
  });
});

describe('playlist channel detection', () => {
  test('is true only when a direct stream URL is present', () => {
    const [withUrl] = m3uChannelsToLiveTvChannels(descriptor, [entry()]);

    expect(isPlaylistLiveTvChannel(withUrl)).toBe(true);
    expect(isPlaylistLiveTvChannel({ ...withUrl!, directStreamUrl: '' })).toBe(false);
    expect(isPlaylistLiveTvChannel(null)).toBe(false);
  });
});

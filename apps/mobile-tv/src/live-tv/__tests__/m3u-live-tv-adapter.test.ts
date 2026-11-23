import type { LiveTvProviderDescriptor } from '@moviestv/live-tv';
import {
  M3uLiveTvAdapter,
  type M3uPlaylistRecord,
  type M3uPlaylistSource,
} from '../M3uLiveTvAdapter';

function response(payload: string) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (
        name.toLowerCase() === 'content-length'
          ? String(Buffer.byteLength(payload))
          : null
      ),
    },
    text: async () => payload,
  };
}

function source(records: readonly M3uPlaylistRecord[]): M3uPlaylistSource {
  return { list: async () => records };
}

const PLAYLIST = [
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="news.fr" tvg-logo="https://img.example/news.png" group-title="News",France Info',
  'https://stream.example/news.m3u8',
  '#EXTINF:-1 tvg-id="sport.fr",Sport 1',
  'https://stream.example/sport.m3u8',
].join('\n');

const record: M3uPlaylistRecord = {
  id: 'playlist-1',
  name: 'My Playlist',
  priority: 50,
  enabled: true,
  url: 'http://iptv.example/get.php?user=u&pass=p',
};

const provider: LiveTvProviderDescriptor = {
  addonId: 'm3u:playlist-1',
  name: 'My Playlist',
  manifestUrl: '',
  priority: 50,
  liveTv: { catalogs: [], streamTypes: ['channel'] },
  kind: 'playlist',
};

describe('M3U provider discovery', () => {
  test('lists only enabled playlists with a playable URL', async () => {
    const adapter = new M3uLiveTvAdapter(source([
      record,
      { ...record, id: 'disabled', enabled: false },
      { ...record, id: 'insecure', url: 'file:///etc/passwd' },
      { ...record, id: 'creds', url: 'https://user:secret@iptv.example/list.m3u' },
    ]));

    const providers = await adapter.providers();

    expect(providers.map((item) => item.addonId)).toEqual(['m3u:playlist-1']);
    expect(providers[0]?.kind).toBe('playlist');
  });

  test('never exposes the playlist URL in a descriptor', async () => {
    const adapter = new M3uLiveTvAdapter(source([record]));

    const serialized = JSON.stringify(await adapter.providers());

    expect(serialized).not.toContain('iptv.example');
    expect(serialized).not.toContain('pass=p');
  });

  test('orders providers by priority, then id', async () => {
    const adapter = new M3uLiveTvAdapter(source([
      { ...record, id: 'b', priority: 10 },
      { ...record, id: 'a', priority: 10 },
      { ...record, id: 'c', priority: 90 },
    ]));

    expect((await adapter.providers()).map((item) => item.addonId))
      .toEqual(['m3u:c', 'm3u:a', 'm3u:b']);
  });

  test('survives a failing source', async () => {
    const adapter = new M3uLiveTvAdapter({
      list: async () => { throw new Error('storage unavailable'); },
    });

    expect(await adapter.providers()).toEqual([]);
  });
});

describe('M3U channel loading', () => {
  test('fetches the playlist and maps its channels', async () => {
    const calls: string[] = [];
    const adapter = new M3uLiveTvAdapter(
      source([record]),
      async (url) => {
        calls.push(url);
        return response(PLAYLIST);
      },
    );

    const channels = await adapter.listChannels(provider);

    expect(calls).toEqual(['http://iptv.example/get.php?user=u&pass=p']);
    expect(channels).toHaveLength(2);
    expect(channels[0]).toEqual({
      id: 'm3u:news.fr',
      providerId: 'm3u:playlist-1',
      remoteId: 'm3u:news.fr',
      resourceType: 'channel',
      title: 'France Info',
      posterUrl: 'https://img.example/news.png',
      countryCode: undefined,
      genres: ['News'],
      directStreamUrl: 'https://stream.example/news.m3u8',
    });
  });


  test('reports a playlist that was cut at the channel cap', async () => {
    const oversized = [
      '#EXTM3U',
      ...Array.from({ length: 5_001 }, (_, index) => (
        `#EXTINF:-1,Channel ${index}\nhttps://stream.example/${index}.m3u8`
      )),
    ].join('\n');
    const adapter = new M3uLiveTvAdapter(
      source([record]),
      async () => response(oversized),
    );

    expect(adapter.truncatedProviderIds()).toEqual([]);
    const channels = await adapter.listChannels(provider);

    expect(channels).toHaveLength(5_000);
    expect(adapter.truncatedProviderIds()).toEqual(['m3u:playlist-1']);
  });

  test('clears the truncation state after a playlist that fits', async () => {
    let payload = [
      '#EXTM3U',
      ...Array.from({ length: 5_001 }, (_, index) => (
        `#EXTINF:-1,Channel ${index}\nhttps://stream.example/${index}.m3u8`
      )),
    ].join('\n');
    const adapter = new M3uLiveTvAdapter(
      source([record]),
      async () => response(payload),
    );

    await adapter.listChannels(provider);
    expect(adapter.truncatedProviderIds()).toEqual(['m3u:playlist-1']);

    payload = PLAYLIST;
    await adapter.listChannels(provider);

    expect(adapter.truncatedProviderIds()).toEqual([]);
  });

  test('returns no channels for a provider it does not own', async () => {
    const adapter = new M3uLiveTvAdapter(source([record]), async () => {
      throw new Error('must not fetch');
    });

    expect(await adapter.listChannels({
      ...provider,
      addonId: 'm3u:unknown',
    })).toEqual([]);
  });

  test('returns no channels when the provider is not a playlist', async () => {
    const adapter = new M3uLiveTvAdapter(source([record]), async () => {
      throw new Error('must not fetch');
    });

    expect(await adapter.listChannels({ ...provider, kind: 'addon' }))
      .toEqual([]);
  });

  test('treats a single HLS manifest as an empty channel list', async () => {
    const adapter = new M3uLiveTvAdapter(source([record]), async () => response([
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXTINF:6.0,',
      'segment1.ts',
    ].join('\n')));

    expect(await adapter.listChannels(provider)).toEqual([]);
  });

  test('rejects an HTML login page served instead of a playlist', async () => {
    const adapter = new M3uLiveTvAdapter(
      source([record]),
      async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (
            name.toLowerCase() === 'content-type' ? 'text/html' : null
          ),
        },
        text: async () => '<html><body>login</body></html>',
      }),
    );

    await expect(adapter.listChannels(provider))
      .rejects.toThrow('Playlist response is HTML');
  });

  test('rejects text that is not a playlist', async () => {
    const adapter = new M3uLiveTvAdapter(
      source([record]),
      async () => response('<html><body>login</body></html>'),
    );

    await expect(adapter.listChannels(provider))
      .rejects.toThrow('Playlist could not be read');
  });

  test('propagates a fetch failure so the provider is reported as failed', async () => {
    const adapter = new M3uLiveTvAdapter(source([record]), async () => {
      throw new Error('network down');
    });

    await expect(adapter.listChannels(provider))
      .rejects.toThrow('network down');
  });

  test('honours a shorter caller budget', async () => {
    const adapter = new M3uLiveTvAdapter(
      source([record]),
      () => new Promise(() => undefined),
    );

    await expect(adapter.listChannels(provider, { timeoutMs: 5 }))
      .rejects.toThrow('Playlist request timed out');
  });
});

describe('M3U stream resolution', () => {
  const adapter = new M3uLiveTvAdapter(source([record]));

  test('returns the channel URL without a network request', async () => {
    const sources = await adapter.resolveChannel(provider, {
      id: 'm3u:news.fr',
      providerId: 'm3u:playlist-1',
      remoteId: 'm3u:news.fr',
      resourceType: 'channel',
      title: 'France Info',
      directStreamUrl: 'http://host.example:8080/live/user/pass/12.ts',
    });

    expect(sources).toEqual([{
      id: 'm3u:playlist-1:m3u:news.fr',
      providerId: 'm3u:playlist-1',
      sourceId: 'm3u:news.fr',
      name: 'France Info',
      url: 'http://host.example:8080/live/user/pass/12.ts',
    }]);
  });

  test('rejects a channel owned by another provider', async () => {
    await expect(adapter.resolveChannel(provider, {
      id: 'm3u:other',
      providerId: 'org.example.tv',
      remoteId: 'm3u:other',
      resourceType: 'channel',
      title: 'Other',
      directStreamUrl: 'https://stream.example/x.m3u8',
    })).rejects.toThrow('does not belong');
  });

  test('rejects a channel without a usable URL', async () => {
    await expect(adapter.resolveChannel(provider, {
      id: 'm3u:none',
      providerId: 'm3u:playlist-1',
      remoteId: 'm3u:none',
      resourceType: 'channel',
      title: 'None',
      directStreamUrl: 'file:///etc/passwd',
    })).rejects.toThrow('no playable stream');
  });
});

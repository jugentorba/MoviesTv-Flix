import type { LiveTvProviderDescriptor } from '@moviestv/live-tv';
import { StremioLiveTvAdapter } from '../StremioLiveTvAdapter';

function response(payload: unknown) {
  const body = JSON.stringify(payload);
  return {
    ok: true,
    status: 200,
    headers: { get: () => String(Buffer.byteLength(body)) },
    text: async () => body,
  };
}

const provider: LiveTvProviderDescriptor = {
  addonId: 'org.stremio.vavoo.clean',
  name: 'TvVoo',
  manifestUrl: 'https://tvvoo.hayd.uk/cfg-fr-al-bk/manifest.json',
  priority: 100,
  liveTv: {
    catalogs: [
      { type: 'tv', id: 'vavoo_tv_fr', name: 'France' },
      { type: 'tv', id: 'vavoo_tv_al', name: 'Albania' },
      { type: 'tv', id: 'vavoo_tv_bk', name: 'Balkans' },
    ],
    streamTypes: ['tv'],
  },
};

describe('TvVoo configured manifest compatibility', () => {
  test('keeps the cfg path when requesting France/Albania/Balkans catalogs', async () => {
    const calls: string[] = [];
    const adapter = new StremioLiveTvAdapter(async (url) => {
      calls.push(url);
      return response({ metas: [] });
    });

    await adapter.listChannels(provider);

    expect(calls).toEqual([
      'https://tvvoo.hayd.uk/cfg-fr-al-bk/catalog/tv/vavoo_tv_fr.json',
      'https://tvvoo.hayd.uk/cfg-fr-al-bk/catalog/tv/vavoo_tv_al.json',
      'https://tvvoo.hayd.uk/cfg-fr-al-bk/catalog/tv/vavoo_tv_bk.json',
    ]);
  });



  test('skips TvVoo search-only catalogs during normal channel loading', async () => {
    const calls: string[] = [];
    const adapter = new StremioLiveTvAdapter(async (url) => {
      calls.push(url);
      return response({ metas: [] });
    });
    const configured = {
      ...provider,
      liveTv: {
        ...provider.liveTv,
        catalogs: [
          ...provider.liveTv.catalogs,
          {
            type: 'tv' as const,
            id: 'vavoo_search_fr',
            name: 'Search France',
            requiredExtras: ['search'],
          },
          {
            type: 'tv' as const,
            id: 'vavoo_search_al',
            name: 'Search Albania',
            requiredExtras: ['search'],
          },
          {
            type: 'tv' as const,
            id: 'vavoo_search_bk',
            name: 'Search Balkans',
            requiredExtras: ['search'],
          },
        ],
      },
    };

    await adapter.listChannels(configured);

    expect(calls).toEqual([
      'https://tvvoo.hayd.uk/cfg-fr-al-bk/catalog/tv/vavoo_tv_fr.json',
      'https://tvvoo.hayd.uk/cfg-fr-al-bk/catalog/tv/vavoo_tv_al.json',
      'https://tvvoo.hayd.uk/cfg-fr-al-bk/catalog/tv/vavoo_tv_bk.json',
    ]);
  });

  test('preserves TvVoo encoded channel ids when building stream routes', async () => {
    const calls: string[] = [];
    const adapter = new StremioLiveTvAdapter(async (url) => {
      calls.push(url);
      return response({ streams: [] });
    });
    const channel = {
      id: 'org.stremio.vavoo.clean:tv:vavoo_TF1%20HD|group:fr',
      providerId: 'org.stremio.vavoo.clean',
      remoteId: 'vavoo_TF1%20HD|group:fr',
      resourceType: 'tv' as const,
      title: 'TF1 HD',
      countryCode: 'FR',
    };

    await adapter.resolveChannel(provider, channel);

    expect(calls).toEqual([
      'https://tvvoo.hayd.uk/cfg-fr-al-bk/stream/tv/vavoo_TF1%2520HD%7Cgroup%3Afr.json',
    ]);
  });

  test('normalizes TvVoo clean-stream legacy headers for native and web failover', async () => {
    const adapter = new StremioLiveTvAdapter(async () => response({
      streams: [{
        name: 'Vavoo',
        title: '[🏠] TF1 HD',
        url: 'https://stream.example/live.m3u8',
        behaviorHints: {
          notWebReady: true,
          headers: {
            'User-Agent': 'okhttp/4.11.0',
            Referer: 'https://vavoo.to/',
            Origin: 'https://vavoo.to',
          },
          proxyHeaders: {
            'User-Agent': 'okhttp/4.11.0',
            Referer: 'https://vavoo.to/',
            Origin: 'https://vavoo.to',
          },
          proxyUseFallback: true,
        },
      }],
    }));
    const channel = {
      id: 'org.stremio.vavoo.clean:tv:tf1',
      providerId: 'org.stremio.vavoo.clean',
      remoteId: 'tf1',
      resourceType: 'tv' as const,
      title: 'TF1',
    };

    const [source] = await adapter.resolveChannel(provider, channel);

    expect(source).toEqual(expect.objectContaining({
      providerId: 'org.stremio.vavoo.clean',
      url: 'https://stream.example/live.m3u8',
      webReady: false,
      headers: {
        'User-Agent': 'okhttp/4.11.0',
        Referer: 'https://vavoo.to/',
        Origin: 'https://vavoo.to',
      },
    }));
  });
});

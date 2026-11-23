import * as addons from '../index';
import type { StreamSource } from '@moviestv/core';

function exported<T>(name: string): T | undefined {
  return (addons as any)[name] as T | undefined;
}

const request = {
  mediaId: 'tmdb:movie:550',
  kind: 'movie' as const,
  externalIds: { imdb: 'tt0137523', tmdb: '550' },
};

function descriptor(id: string) {
  return {
    id,
    name: id,
    version: '1.0.0',
    sourceType: 'native' as const,
    capabilities: ['stream' as const],
    requiresConfiguration: false,
    configurationFields: [],
    supportedMediaKinds: ['movie' as const],
  };
}

function installed(addonId: string, priority: number, overrides: Record<string, unknown> = {}) {
  return {
    addonId,
    sourceType: 'native' as const,
    enabled: true,
    priority,
    installedAt: '2026-09-05T15:00:00.000Z',
    updatedAt: '2026-09-05T15:00:00.000Z',
    setupIncomplete: false,
    ...overrides,
  };
}

function adapter(id: string, result: StreamSource[] | Error | 'never') {
  return {
    descriptor: () => descriptor(id),
    resolve: jest.fn(async () => {
      if (result === 'never') return await new Promise<StreamSource[]>(() => undefined);
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

test('addon registry provider ties are locale independent', () => {
  const AddonRegistry = exported<any>('AddonRegistry');
  expect(AddonRegistry).toBeDefined();
  const localeCompare = jest.spyOn(
    String.prototype,
    'localeCompare',
  ).mockImplementation(() => 99);

  try {
    const registry = new AddonRegistry([
      {
        installed: installed('é-provider', 100),
        adapter: adapter('é-provider', []),
      },
      {
        installed: installed('a-provider', 100),
        adapter: adapter('a-provider', []),
      },
    ]);

    expect(
      registry.enabledConfigured().map(
        (entry: any) => entry.installed.addonId,
      ),
    ).toEqual(['a-provider', 'é-provider']);
    expect(localeCompare).not.toHaveBeenCalled();
  } finally {
    localeCompare.mockRestore();
  }
});

describe('stream candidate normalization', () => {
  it('accepts loose single-stream and top-level array payloads', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');

    expect(normalizeStreamCandidates?.('provider', {
      stream: {
        id: 'single',
        title: 'Single 1080p',
        url: 'https://cdn.example/single.mp4',
      },
    })).toEqual([
      expect.objectContaining({
        id: 'provider:single',
        url: 'https://cdn.example/single.mp4',
        quality: '1080p',
      }),
    ]);

    expect(normalizeStreamCandidates?.('provider', [
      {
        id: 'array-one',
        url: 'https://cdn.example/one.mp4',
      },
      {
        id: 'array-two',
        url: 'https://cdn.example/two.m3u8',
      },
    ])).toHaveLength(2);
  });

  it('keeps safe HTTP(S) URL streams and discards malformed or unsafe entries', () => {
    const normalizeStreamCandidates = exported<(providerId: string, payload: unknown) => StreamSource[]>('normalizeStreamCandidates');
    expect(normalizeStreamCandidates).toBeDefined();

    expect(normalizeStreamCandidates?.('public-domain', {
      streams: [
        { name: '1080p English H264', url: 'https://cdn.example/video.mp4' },
        { title: '4K', url: 'http://media.example/movie.m3u8' },
        { name: 'bad', url: 'javascript:alert(1)' },
        { name: 'data', url: 'data:text/plain,nope' },
        { name: 'torrent-only', infoHash: 'abcdef' },
        null,
      ],
    })).toEqual([
      expect.objectContaining({
        providerId: 'public-domain',
        url: 'https://cdn.example/video.mp4',
        name: '1080p English H264',
        quality: '1080p',
        language: 'en',
        codec: 'h264',
      }),
      expect.objectContaining({
        providerId: 'public-domain',
        url: 'http://media.example/movie.m3u8',
        quality: '2160p',
      }),
    ]);
  });

  it('rejects stream URLs that expand beyond the normalized URL ceiling', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');
    expect(normalizeStreamCandidates).toBeDefined();

    const expanded = `https://cdn.example/${'é'.repeat(2_000)}.mp4`;
    expect(expanded.length).toBeLessThan(8_192);

    expect(normalizeStreamCandidates?.('provider', {
      streams: [{ id: 'expanded', url: expanded }],
    })).toEqual([]);
  });

  it('uses Stremio title metadata for playback compatibility inference', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');
    expect(normalizeStreamCandidates).toBeDefined();

    const [source] = normalizeStreamCandidates?.('torrent-provider', {
      streams: [
        {
          id: 'main',
          name: 'Provider 1080p',
          title: 'Movie.Name.2026.French.H264.2.5GB.mkv',
          url: 'https://cdn.example/play/opaque-id',
        },
      ],
    }) ?? [];

    expect(source).toEqual(expect.objectContaining({
      id: 'torrent-provider:main',
      name: 'Provider 1080p',
      quality: '1080p',
      language: 'fr',
      codec: 'h264',
      sizeBytes: Math.round(2.5 * 1024 ** 3),
      webReady: false,
    }));
  });

  it('preserves normalized playback compatibility metadata from rich titles', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');

    const [source] = normalizeStreamCandidates?.('provider', {
      streams: [{
        id: 'rich',
        name: 'Lumio',
        title: 'French 4K H265 Dolby Vision TrueHD',
        url: 'https://cdn.example/movie.mp4',
      }],
    }) ?? [];

    expect(source).toEqual(expect.objectContaining({
      name: 'Lumio',
      codec: 'h265',
      audioCodec: 'truehd',
      dynamicRange: 'dolby-vision',
    }));
  });

  it('normalizes DTS and HDR compatibility metadata', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');

    const [source] = normalizeStreamCandidates?.('provider', {
      streams: [{
        id: 'hdr',
        name: 'Provider',
        description: '1080p HDR10 DTS-HD',
        url: 'https://cdn.example/movie.mp4',
      }],
    }) ?? [];

    expect(source).toEqual(expect.objectContaining({
      audioCodec: 'dts',
      dynamicRange: 'hdr',
    }));
  });

  it('normalizes x264/x265 codec labels and marks legacy containers non-web-ready', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');

    const sources = normalizeStreamCandidates?.('provider', {
      streams: [
        {
          id: 'x265',
          title: 'French 1080p x265',
          url: 'https://cdn.example/movie.mp4',
        },
        {
          id: 'x264-flv',
          title: 'English 720p x264 release.flv',
          url: 'https://cdn.example/play/opaque',
        },
      ],
    }) ?? [];

    expect(sources[0]).toEqual(expect.objectContaining({
      codec: 'h265',
      quality: '1080p',
    }));
    expect(sources[1]).toEqual(expect.objectContaining({
      codec: 'h264',
      quality: '720p',
      webReady: false,
    }));
  });

  it('does not mark free-text provider labels as browser-incompatible containers', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');
    expect(normalizeStreamCandidates).toBeDefined();

    const sources = normalizeStreamCandidates?.('provider', {
      streams: [
        {
          id: 'dash-name',
          name: 'Dash',
          title: 'Avi Club 1080p H264',
          url: 'https://cdn.example/play?id=valid-direct-stream',
        },
      ],
    }) ?? [];

    expect(sources[0]).toEqual(expect.objectContaining({
      id: 'provider:dash-name',
      codec: 'h264',
      quality: '1080p',
    }));
    expect(sources[0]?.webReady).toBeUndefined();
  });

  it('uses Stremio behaviorHints.filename for playback compatibility inference', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');
    expect(normalizeStreamCandidates).toBeDefined();

    const [source] = normalizeStreamCandidates?.('torrent-provider', {
      streams: [
        {
          id: 'hinted-file',
          name: 'Provider stream',
          url: 'https://cdn.example/play/opaque-id',
          behaviorHints: {
            filename: 'Movie.Name.2026.French.H264.2.5GB.mkv',
          },
        },
      ],
    }) ?? [];

    expect(source).toEqual(expect.objectContaining({
      id: 'torrent-provider:hinted-file',
      name: 'Provider stream',
      filename: 'Movie.Name.2026.French.H264.2.5GB.mkv',
      language: 'fr',
      codec: 'h264',
      sizeBytes: Math.round(2.5 * 1024 ** 3),
      webReady: false,
    }));
  });

  it('bounds stream candidates and rejects unsafe request headers', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');
    expect(normalizeStreamCandidates).toBeDefined();

    const streams = Array.from({ length: 550 }, (_, index) => ({
      id: `stream-${index}`,
      name: index === 0 ? 'x'.repeat(501) : `Stream ${index}`,
      url: `https://cdn.example/${index}.mp4`,
      audioLanguages: Array.from(
        { length: 30 },
        (_, language) => language % 2 ? 'en' : 'fr',
      ),
      headers: {
        'X-Good': 'ok',
        'Bad Header': 'nope',
        'X-Injection': 'value\r\nInjected: true',
      },
    }));

    const sources = normalizeStreamCandidates?.('provider', { streams })
      ?? [];

    expect(sources).toHaveLength(500);
    expect(sources[0]?.name).toBeUndefined();
    expect(sources[0]?.audioLanguages).toEqual(['fr', 'en']);
    expect(sources[0]?.headers).toEqual({ 'X-Good': 'ok' });
  });

  it('merges proxy request headers with direct stream headers', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');

    const [source] = normalizeStreamCandidates?.('provider', {
      streams: [{
        id: 'stream',
        url: 'https://cdn.example/video.m3u8',
        behaviorHints: {
          proxyHeaders: {
            request: {
              Referer: 'https://player.example/',
              Authorization: 'Bearer proxy-wins',
            },
          },
        },
        headers: {
          authorization: 'Bearer direct-loses',
          'X-Provider': 'runtime',
        },
      }],
    }) ?? [];

    expect(source?.headers).toEqual({
      Referer: 'https://player.example/',
      Authorization: 'Bearer proxy-wins',
      'X-Provider': 'runtime',
    });
  });

  it('deduplicates provider request header names case-insensitively', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');

    const [source] = normalizeStreamCandidates?.('provider', {
      streams: [{
        id: 'stream',
        url: 'https://cdn.example/video.mp4',
        headers: {
          Authorization: 'Bearer first',
          authorization: 'Bearer second',
          'X-Good': 'ok',
        },
      }],
    }) ?? [];

    expect(source?.headers).toEqual({
      Authorization: 'Bearer first',
      'X-Good': 'ok',
    });
    expect(Object.keys(source?.headers ?? {})).toHaveLength(2);
  });

  it('preserves provider notWebReady hints for browser ranking', () => {
    const normalizeStreamCandidates = exported<(providerId: string, payload: unknown) => StreamSource[]>('normalizeStreamCandidates');
    expect(normalizeStreamCandidates).toBeDefined();

    const sources = normalizeStreamCandidates?.('provider', {
      streams: [
        {
          id: 'browser-risky',
          url: 'https://cdn.example/stream',
          behaviorHints: { notWebReady: true },
        },
        {
          id: 'browser-ready',
          url: 'https://cdn.example/movie.mp4',
        },
      ],
    }) ?? [];

    expect(sources[0]).toEqual(expect.objectContaining({
      id: 'provider:browser-risky',
      webReady: false,
    }));
    expect(sources[1]?.webReady).toBeUndefined();
  });

  it('deduplicates equivalent URLs while preserving the highest-priority first source', () => {
    const dedupeStreamSources = exported<(groups: StreamSource[][]) => StreamSource[]>('dedupeStreamSources');
    expect(dedupeStreamSources).toBeDefined();

    const high: StreamSource = { id: 'high:1', providerId: 'high', url: 'https://cdn.example/video.mp4', quality: '1080p' };
    const lowDuplicate: StreamSource = { id: 'low:1', providerId: 'low', url: 'https://cdn.example/video.mp4', quality: '720p' };
    const lowUnique: StreamSource = { id: 'low:2', providerId: 'low', url: 'https://cdn.example/other.mp4' };

    expect(dedupeStreamSources?.([[high], [lowDuplicate, lowUnique]])).toEqual([high, lowUnique]);
  });


  it('enriches duplicate streams with a missing display name used by web ranking', () => {
    const dedupeStreamSources = exported<
      (groups: StreamSource[][]) => StreamSource[]
    >('dedupeStreamSources');
    expect(dedupeStreamSources).toBeDefined();

    const primary: StreamSource = {
      id: 'high:1',
      providerId: 'high',
      url: 'https://cdn.example/video.mp4',
    };
    const duplicate: StreamSource = {
      id: 'low:1',
      providerId: 'low',
      url: 'https://cdn.example/video.mp4',
      name: '1080p DTS HDR',
    };

    expect(dedupeStreamSources?.([[primary], [duplicate]])).toEqual([
      {
        ...primary,
        name: '1080p DTS HDR',
      },
    ]);
  });

  it('keeps distinct signed URL variants even when only query tokens differ', () => {
    const dedupeStreamSources = exported<
      (groups: StreamSource[][]) => StreamSource[]
    >('dedupeStreamSources');
    expect(dedupeStreamSources).toBeDefined();

    const first: StreamSource = {
      id: 'provider:token-a',
      providerId: 'provider',
      url: 'https://cdn.example/video.mp4?token=alpha',
    };
    const second: StreamSource = {
      id: 'provider:token-b',
      providerId: 'provider',
      url: 'https://cdn.example/video.mp4?token=beta',
    };

    expect(dedupeStreamSources?.([[first, second]])).toEqual([
      first,
      second,
    ]);
  });

  it('assigns unique runtime ids when a provider reuses a stream id', () => {
    const dedupeStreamSources = exported<(groups: StreamSource[][]) => StreamSource[]>('dedupeStreamSources');
    expect(dedupeStreamSources).toBeDefined();

    const first: StreamSource = {
      id: 'provider:main',
      providerId: 'provider',
      sourceId: 'main',
      url: 'https://cdn.example/first.mp4',
    };
    const reservedSuffix: StreamSource = {
      id: 'provider:main:2',
      providerId: 'provider',
      sourceId: 'main:2',
      url: 'https://cdn.example/reserved.mp4',
    };
    const duplicateId: StreamSource = {
      id: 'provider:main',
      providerId: 'provider',
      sourceId: 'main',
      url: 'https://cdn.example/second.mp4',
    };

    expect(
      dedupeStreamSources?.([[first, reservedSuffix, duplicateId]])
        .map((source) => source.id),
    ).toEqual([
      'provider:main',
      'provider:main:2',
      'provider:main:3',
    ]);
  });

  it('bounds the final deduplicated playback source list', () => {
    const dedupeStreamSources = exported<
      (groups: StreamSource[][]) => StreamSource[]
    >('dedupeStreamSources');
    expect(dedupeStreamSources).toBeDefined();

    const group = Array.from({ length: 1_100 }, (_, index) => ({
      id: `provider:${index}`,
      providerId: 'provider',
      url: `https://cdn.example/${index}.mp4`,
    }));

    expect(dedupeStreamSources?.([group])).toHaveLength(1_000);
  });

  it('dedupes request headers without locale-sensitive ordering', () => {
    const dedupeStreamSources = exported<
      (groups: StreamSource[][]) => StreamSource[]
    >('dedupeStreamSources');
    expect(dedupeStreamSources).toBeDefined();
    const localeCompare = jest.spyOn(
      String.prototype,
      'localeCompare',
    ).mockImplementation(() => 99);

    try {
      const first: StreamSource = {
        id: 'provider:first',
        providerId: 'provider',
        url: 'https://cdn.example/video.mp4',
        headers: {
          'X-Z': 'value-b',
          'X-A': 'value-a',
        },
      };
      const duplicate: StreamSource = {
        ...first,
        id: 'provider:second',
        headers: {
          'x-a': 'value-a',
          'x-z': 'value-b',
        },
      };

      expect(dedupeStreamSources?.([[first, duplicate]]))
        .toEqual([first]);
      expect(localeCompare).not.toHaveBeenCalled();
    } finally {
      localeCompare.mockRestore();
    }
  });

  it('keeps same-URL fallbacks when request headers differ', () => {
    const dedupeStreamSources = exported<(groups: StreamSource[][]) => StreamSource[]>('dedupeStreamSources');
    expect(dedupeStreamSources).toBeDefined();

    const direct: StreamSource = {
      id: 'high:1',
      providerId: 'high',
      url: 'https://cdn.example/video.mp4',
    };
    const headerVariant: StreamSource = {
      id: 'low:1',
      providerId: 'low',
      url: 'https://cdn.example/video.mp4',
      headers: { Referer: 'https://player.example/' },
    };

    expect(dedupeStreamSources?.([[direct], [headerVariant]])).toEqual([
      direct,
      headerVariant,
    ]);
  });

  it('deduplicates equivalent headers regardless of name casing or order', () => {
    const dedupeStreamSources = exported<(groups: StreamSource[][]) => StreamSource[]>('dedupeStreamSources');
    expect(dedupeStreamSources).toBeDefined();

    const high: StreamSource = {
      id: 'high:1',
      providerId: 'high',
      url: 'https://cdn.example/video.mp4',
      headers: {
        Referer: 'https://player.example/',
        'User-Agent': 'MoviesTv',
      },
    };
    const lowEquivalent: StreamSource = {
      id: 'low:1',
      providerId: 'low',
      url: 'https://cdn.example/video.mp4',
      headers: {
        'user-agent': 'MoviesTv',
        referer: 'https://player.example/',
      },
    };

    expect(dedupeStreamSources?.([[high], [lowEquivalent]])).toEqual([high]);
  });

});

describe('provider registry and resolver', () => {
  it('orders only enabled, configured stream providers by descending priority', () => {
    const AddonRegistry = exported<any>('AddonRegistry');
    expect(AddonRegistry).toBeDefined();

    const registry = new AddonRegistry!([
      { installed: installed('low', 10), adapter: adapter('low', []) },
      { installed: installed('high', 100), adapter: adapter('high', []) },
      { installed: installed('disabled', 999, { enabled: false }), adapter: adapter('disabled', []) },
      { installed: installed('incomplete', 800, { setupIncomplete: true }), adapter: adapter('incomplete', []) },
      {
        installed: installed('catalog-only', 700),
        adapter: { descriptor: () => ({ ...descriptor('catalog-only'), capabilities: ['catalog'] }), resolve: jest.fn(async () => []) },
      },
    ]);

    expect(registry.enabledConfigured().map((entry: any) => entry.installed.addonId)).toEqual(['high', 'low']);
  });

  it('skips providers whose descriptor throws instead of breaking the registry', () => {
    const AddonRegistry = exported<any>('AddonRegistry');
    const broken = {
      descriptor: jest.fn(() => {
        throw new Error('broken descriptor');
      }),
      resolve: jest.fn(async () => []),
    };
    const registry = new AddonRegistry!([
      {
        installed: installed('broken', 999),
        adapter: broken,
      },
      {
        installed: installed('healthy', 100),
        adapter: adapter('healthy', []),
      },
    ]);

    expect(
      registry.enabledConfigured().map(
        (entry: any) => entry.installed.addonId,
      ),
    ).toEqual(['healthy']);
    expect(broken.descriptor).toHaveBeenCalledTimes(1);
  });

  it('caps enabled stream providers after priority ordering', () => {
    const AddonRegistry = exported<any>('AddonRegistry');
    const entries = Array.from({ length: 105 }, (_, index) => ({
      installed: installed(`provider-${index}`, index),
      adapter: adapter(`provider-${index}`, []),
    }));
    const registry = new AddonRegistry!(entries);

    const enabled = registry.enabledConfigured();

    expect(enabled).toHaveLength(100);
    expect(enabled[0]?.installed.addonId).toBe('provider-104');
    expect(
      enabled.some((entry: any) => (
        entry.installed.addonId === 'provider-0'
      )),
    ).toBe(false);
  });

  it('returns successful providers when another provider fails', async () => {
    const AddonRegistry = exported<any>('AddonRegistry');
    const AddonSourceResolver = exported<any>('AddonSourceResolver');
    expect(AddonRegistry).toBeDefined();
    expect(AddonSourceResolver).toBeDefined();

    const goodSource: StreamSource = { id: 'good:1', providerId: 'good', url: 'https://cdn.example/good.mp4' };
    const registry = new AddonRegistry!([
      { installed: installed('bad', 100), adapter: adapter('bad', new Error('offline')) },
      { installed: installed('good', 50), adapter: adapter('good', [goodSource]) },
    ]);
    const resolver = new AddonSourceResolver!(registry, 50);

    await expect(resolver.resolve(request)).resolves.toEqual([goodSource]);
  });

  it('deduplicates lower-priority duplicate URLs across provider results', async () => {
    const AddonRegistry = exported<any>('AddonRegistry');
    const AddonSourceResolver = exported<any>('AddonSourceResolver');
    const high: StreamSource = { id: 'high:1', providerId: 'high', url: 'https://cdn.example/shared.mp4', quality: '1080p' };
    const low: StreamSource = { id: 'low:1', providerId: 'low', url: 'https://cdn.example/shared.mp4', quality: '720p' };
    const unique: StreamSource = { id: 'low:2', providerId: 'low', url: 'https://cdn.example/unique.mp4' };
    const resolver = new AddonSourceResolver!(new AddonRegistry!([
      { installed: installed('high', 100), adapter: adapter('high', [high]) },
      { installed: installed('low', 50), adapter: adapter('low', [low, unique]) },
    ]), 50);

    await expect(resolver.resolve(request)).resolves.toEqual([high, unique]);
  });

  it('returns an empty list when every provider fails or has no result', async () => {
    const AddonRegistry = exported<any>('AddonRegistry');
    const AddonSourceResolver = exported<any>('AddonSourceResolver');
    const resolver = new AddonSourceResolver!(new AddonRegistry!([
      { installed: installed('bad', 100), adapter: adapter('bad', new Error('offline')) },
      { installed: installed('empty', 50), adapter: adapter('empty', []) },
    ]), 50);

    await expect(resolver.resolve(request)).resolves.toEqual([]);
  });

  it('reports provider unavailability when every provider fails', async () => {
    const AddonRegistry = exported<any>('AddonRegistry');
    const AddonSourceResolver = exported<any>('AddonSourceResolver');
    const resolver = new AddonSourceResolver!(new AddonRegistry!([
      { installed: installed('bad-a', 100), adapter: adapter('bad-a', new Error('CORS blocked')) },
      { installed: installed('bad-b', 50), adapter: adapter('bad-b', new Error('offline')) },
    ]), 50);

    await expect(resolver.resolve(request))
      .rejects.toThrow('Playback providers are unavailable');
  });

  it('reports provider unavailability when every provider times out', async () => {
    const AddonRegistry = exported<any>('AddonRegistry');
    const AddonSourceResolver = exported<any>('AddonSourceResolver');
    const resolver = new AddonSourceResolver!(new AddonRegistry!([
      { installed: installed('slow-a', 100), adapter: adapter('slow-a', 'never') },
      { installed: installed('slow-b', 50), adapter: adapter('slow-b', 'never') },
    ]), 2);

    await expect(resolver.resolve(request))
      .rejects.toThrow('Playback providers are unavailable');
  });

  it('times out one provider without blocking a fast provider', async () => {
    jest.useFakeTimers();
    try {
      const AddonRegistry = exported<any>('AddonRegistry');
      const AddonSourceResolver = exported<any>('AddonSourceResolver');
      const fastSource: StreamSource = { id: 'fast:1', providerId: 'fast', url: 'https://cdn.example/fast.mp4' };
      const slow = adapter('slow', 'never');
      const fast = adapter('fast', [fastSource]);
      const resolver = new AddonSourceResolver!(new AddonRegistry!([
        { installed: installed('slow', 100), adapter: slow },
        { installed: installed('fast', 50), adapter: fast },
      ]), 10);

      const pending = resolver.resolve(request);
      await jest.advanceTimersByTimeAsync(10);
      await expect(pending).resolves.toEqual([fastSource]);
      expect(slow.resolve).toHaveBeenCalledTimes(1);
      expect(fast.resolve).toHaveBeenCalledTimes(1);
      expect(slow.resolve).toHaveBeenCalledWith(
        request,
        { timeoutMs: 10 },
      );
      expect(fast.resolve).toHaveBeenCalledWith(
        request,
        { timeoutMs: 10 },
      );
    } finally {
      jest.useRealTimers();
    }
  });
});


test('sanitizes arbitrary adapter stream sources at the final resolver boundary', () => {
  const dedupeStreamSources = exported<
    (groups: StreamSource[][]) => StreamSource[]
  >('dedupeStreamSources');
  expect(dedupeStreamSources).toBeDefined();

  const result = dedupeStreamSources?.([[
    {
      id: 'safe',
      providerId: ' provider ',
      sourceId: ' source ',
      url: 'https://cdn.example/video.mp4#fragment',
      name: ' Movie ',
      quality: ' 1080p ',
      language: 'ENG',
      audioLanguages: Array.from(
        { length: 30 },
        (_, index) => index % 2 ? 'fr' : 'en',
      ),
      subtitleLanguages: ['FRE', 'en', 'fre'],
      codec: ' h264 ',
      sizeBytes: 1_000,
      headers: {
        Referer: ' https://player.example/ ',
        Cookie: 'secret',
        'Bad Header': 'nope',
        'X-Injection': 'ok\r\nInjected: yes',
      },
      webReady: true,
    },
    {
      id: 'ftp',
      url: 'ftp://cdn.example/video.mp4',
    },
    {
      id: 'credentials',
      url: 'https://user:pass@cdn.example/video.mp4',
    },
    {
      id: 'oversized',
      url: `https://cdn.example/${'x'.repeat(8_200)}`,
    },
  ]] as any) ?? [];

  expect(result).toHaveLength(1);
  expect(result[0]).toEqual(expect.objectContaining({
    id: 'safe',
    providerId: 'provider',
    sourceId: 'source',
    url: 'https://cdn.example/video.mp4#fragment',
    name: 'Movie',
    quality: '1080p',
    language: 'en',
    audioLanguages: ['en', 'fr'],
    subtitleLanguages: ['fr', 'en'],
    codec: 'h264',
    sizeBytes: 1_000,
    headers: {
      Referer: 'https://player.example/',
    },
    webReady: true,
  }));
});

test('bounds malformed adapter source fanout before normalization work', () => {
  const dedupeStreamSources = exported<
    (groups: StreamSource[][]) => StreamSource[]
  >('dedupeStreamSources');
  expect(dedupeStreamSources).toBeDefined();

  const groups = Array.from({ length: 105 }, (_, groupIndex) => (
    Array.from({ length: 1_005 }, (_, index) => ({
      id: `provider-${groupIndex}:${index}`,
      url: index < 1_000
        ? `https://cdn.example/${groupIndex}/${index}.mp4`
        : 'javascript:alert(1)',
    }))
  ));

  const result = dedupeStreamSources?.(groups) ?? [];

  expect(result).toHaveLength(1_000);
  expect(result.every((source) => source.id.startsWith('provider-0:')))
    .toBe(true);
});


it('treats malformed provider resolution payloads as provider failures', async () => {
  const AddonRegistry = exported<any>('AddonRegistry');
  const AddonSourceResolver = exported<any>('AddonSourceResolver');
  const malformed = {
    descriptor: () => descriptor('malformed'),
    resolve: jest.fn(async () => ({ streams: [] }) as any),
  };
  const resolver = new AddonSourceResolver!(new AddonRegistry!([
    { installed: installed('malformed', 100), adapter: malformed },
  ]), 50);

  await expect(resolver.resolve(request))
    .rejects.toThrow('Playback providers are unavailable');
});


test('wrong-media stream providers cannot hide a movie provider outage', async () => {
  const AddonRegistry = exported<any>('AddonRegistry');
  const AddonSourceResolver = exported<any>('AddonSourceResolver');
  const movieProvider = adapter(
    'movie-provider',
    new Error('movie provider offline'),
  );
  const seriesOnly = {
    descriptor: () => ({
      ...descriptor('series-only'),
      supportedMediaKinds: ['series' as const],
    }),
    resolve: jest.fn(async () => []),
  };

  const resolver = new AddonSourceResolver!(new AddonRegistry!([
    {
      installed: installed('movie-provider', 100),
      adapter: movieProvider,
    },
    {
      installed: installed('series-only', 50),
      adapter: seriesOnly,
    },
  ]), 50);

  await expect(resolver.resolve(request))
    .rejects.toThrow('Playback providers are unavailable');
  expect(movieProvider.resolve).toHaveBeenCalledTimes(1);
  expect(seriesOnly.resolve).not.toHaveBeenCalled();
});

test('Stremio series-only providers are skipped for movie source resolution', async () => {
  const AddonRegistry = exported<any>('AddonRegistry');
  const AddonSourceResolver = exported<any>('AddonSourceResolver');
  const seriesOnly = {
    descriptor: () => ({
      ...descriptor('stremio-series-only'),
      sourceType: 'stremio-manifest' as const,
      manifestUrl: 'https://series.example/manifest.json',
      supportedMediaKinds: ['series' as const],
      stream: {
        types: ['series' as const],
        idPrefixes: ['tt'],
      },
    }),
    resolve: jest.fn(async () => [{
      id: 'should-not-run',
      url: 'https://series.example/movie.mp4',
    }]),
  };

  const resolver = new AddonSourceResolver!(new AddonRegistry!([
    {
      installed: installed('stremio-series-only', 100, {
        sourceType: 'stremio-manifest',
        manifestUrl: 'https://series.example/manifest.json',
      }),
      adapter: seriesOnly,
    },
  ]), 50);

  await expect(resolver.resolve(request)).resolves.toEqual([]);
  expect(seriesOnly.resolve).not.toHaveBeenCalled();
});


test('broken provider descriptors do not block a healthy playback provider', async () => {
  const AddonRegistry = exported<any>('AddonRegistry');
  const AddonSourceResolver = exported<any>('AddonSourceResolver');
  const healthySource: StreamSource = {
    id: 'healthy:1',
    providerId: 'healthy',
    url: 'https://cdn.example/healthy.mp4',
  };
  const broken = {
    descriptor: jest.fn(() => {
      throw new Error('descriptor is malformed');
    }),
    resolve: jest.fn(async () => [{
      id: 'should-not-run',
      url: 'https://broken.example/video.mp4',
    }]),
  };
  const healthy = adapter('healthy', [healthySource]);

  const resolver = new AddonSourceResolver!(new AddonRegistry!([
    {
      installed: installed('broken', 100),
      adapter: broken,
    },
    {
      installed: installed('healthy', 50),
      adapter: healthy,
    },
  ]), 50);

  await expect(resolver.resolve(request)).resolves.toEqual([
    healthySource,
  ]);
  expect(broken.descriptor).toHaveBeenCalledTimes(1);
  expect(broken.resolve).not.toHaveBeenCalled();
  expect(healthy.resolve).toHaveBeenCalledTimes(1);
});

test('malformed Stremio protocol metadata is isolated during provider filtering', async () => {
  const AddonRegistry = exported<any>('AddonRegistry');
  const AddonSourceResolver = exported<any>('AddonSourceResolver');
  const malformed = {
    descriptor: () => ({
      ...descriptor('malformed-stremio'),
      sourceType: 'stremio-manifest' as const,
      manifestUrl: 'https://malformed.example/manifest.json',
      stream: {
        types: null,
        idPrefixes: 'tt',
      },
    }),
    resolve: jest.fn(async () => [{
      id: 'should-not-run',
      url: 'https://malformed.example/video.mp4',
    }]),
  };

  const resolver = new AddonSourceResolver!(new AddonRegistry!([
    {
      installed: installed('malformed-stremio', 100, {
        sourceType: 'stremio-manifest',
        manifestUrl: 'https://malformed.example/manifest.json',
      }),
      adapter: malformed,
    },
  ]), 50);

  await expect(resolver.resolve(request)).resolves.toEqual([]);
  expect(malformed.resolve).not.toHaveBeenCalled();
});


  it('uses explicit provider compatibility fields when labels are generic', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');

    const [source] = normalizeStreamCandidates?.('provider', {
      streams: [{
        id: 'explicit',
        name: 'Lumio',
        url: 'https://cdn.example/movie.mp4',
        codec: 'HEVC',
        audioCodec: 'TrueHD',
        dynamicRange: 'Dolby Vision',
      }],
    }) ?? [];

    expect(source).toEqual(expect.objectContaining({
      codec: 'h265',
      audioCodec: 'truehd',
      dynamicRange: 'dolby-vision',
    }));
  });

  it('accepts explicit compatibility hints from behaviorHints', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');

    const [source] = normalizeStreamCandidates?.('provider', {
      streams: [{
        id: 'hinted',
        name: 'Provider',
        url: 'https://cdn.example/movie.mp4',
        behaviorHints: {
          codec: 'H.264',
          audioCodec: 'DTS-HD',
          dynamicRange: 'HDR10+',
        },
      }],
    }) ?? [];

    expect(source).toEqual(expect.objectContaining({
      codec: 'h264',
      audioCodec: 'dts',
      dynamicRange: 'hdr',
    }));
  });


  it('normalizes qualified explicit compatibility labels', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');

    const [source] = normalizeStreamCandidates?.('provider', {
      streams: [{
        id: 'qualified',
        name: 'Provider',
        url: 'https://cdn.example/movie.mp4',
        codec: 'HEVC Main 10',
        audioCodec: 'DTS-HD MA',
        dynamicRange: 'Dolby Vision Profile 8.1',
      }],
    }) ?? [];

    expect(source).toEqual(expect.objectContaining({
      codec: 'h265',
      audioCodec: 'dts',
      dynamicRange: 'dolby-vision',
    }));
  });


  it('uses standard Stremio stream tags as compatibility hints', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');

    const sources = normalizeStreamCandidates?.('provider', {
      streams: [
        {
          id: 'opaque-hls',
          name: 'Provider',
          url: 'https://cdn.example/play/opaque-hls-id',
          tag: ['hls', '1080p', 'French', 'H264'],
        },
        {
          id: 'opaque-mp4',
          name: 'Provider',
          url: 'https://cdn.example/play/opaque-mp4-id',
          tag: ['mp4', '720p', 'English', 'H264'],
        },
      ],
    }) ?? [];

    expect(sources[0]).toEqual(expect.objectContaining({
      id: 'provider:opaque-hls',
      contentType: 'application/vnd.apple.mpegurl',
      quality: '1080p',
      language: 'fr',
      codec: 'h264',
    }));
    expect(sources[1]).toEqual(expect.objectContaining({
      id: 'provider:opaque-mp4',
      contentType: 'video/mp4',
      quality: '720p',
      language: 'en',
      codec: 'h264',
    }));
  });

  it('bounds malformed stream tags and accepts a legacy scalar tag', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');

    const [source] = normalizeStreamCandidates?.('provider', {
      streams: [{
        id: 'legacy',
        name: 'Provider',
        url: 'https://cdn.example/play/opaque',
        tag: 'hls',
        tags: [
          ...Array.from({ length: 40 }, (_, index) => `tag-${index}`),
          'x'.repeat(200),
        ],
      }],
    }) ?? [];

    expect(source).toEqual(expect.objectContaining({
      contentType: 'application/vnd.apple.mpegurl',
    }));
  });


  it('maps container tags into browser compatibility MIME metadata', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');

    const sources = normalizeStreamCandidates?.('provider', {
      streams: [
        {
          id: 'mkv',
          url: 'https://cdn.example/play/opaque-mkv',
          tag: ['mkv', '1080p'],
        },
        {
          id: 'dash',
          url: 'https://cdn.example/play/opaque-dash',
          tag: ['dash', '2160p'],
        },
        {
          id: 'webm',
          url: 'https://cdn.example/play/opaque-webm',
          tag: ['webm', '720p'],
        },
      ],
    }) ?? [];

    expect(sources[0]).toEqual(expect.objectContaining({
      contentType: 'video/x-matroska',
      webReady: false,
    }));
    expect(sources[1]).toEqual(expect.objectContaining({
      contentType: 'application/dash+xml',
      webReady: false,
    }));
    expect(sources[2]).toEqual(expect.objectContaining({
      contentType: 'video/webm',
    }));
  });


  it('recognizes combined Stremio transport tags', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');

    const [source] = normalizeStreamCandidates?.('provider', {
      streams: [{
        id: 'combined',
        url: 'https://cdn.example/play/opaque',
        tag: ['HLS 1080p', 'French H264'],
      }],
    }) ?? [];

    expect(source).toEqual(expect.objectContaining({
      contentType: 'application/vnd.apple.mpegurl',
      quality: '1080p',
      language: 'fr',
      codec: 'h264',
    }));
  });


  it('uses structured container and format compatibility hints', () => {
    const normalizeStreamCandidates = exported<
      (providerId: string, payload: unknown) => StreamSource[]
    >('normalizeStreamCandidates');

    const sources = normalizeStreamCandidates?.('provider', {
      streams: [
        {
          id: 'format-hls',
          url: 'https://cdn.example/play/opaque-a',
          format: 'hls',
        },
        {
          id: 'container-mp4',
          url: 'https://cdn.example/play/opaque-b',
          container: 'mp4',
        },
        {
          id: 'hinted-mkv',
          url: 'https://cdn.example/play/opaque-c',
          behaviorHints: { container: 'mkv' },
        },
      ],
    }) ?? [];

    expect(sources[0]).toEqual(expect.objectContaining({
      contentType: 'application/vnd.apple.mpegurl',
    }));
    expect(sources[1]).toEqual(expect.objectContaining({
      contentType: 'video/mp4',
    }));
    expect(sources[2]).toEqual(expect.objectContaining({
      contentType: 'video/x-matroska',
      webReady: false,
    }));
  });


test('bounds concurrent movie and series provider resolution', async () => {
  const AddonRegistry = exported<any>('AddonRegistry');
  const AddonSourceResolver = exported<any>('AddonSourceResolver');
  expect(AddonRegistry).toBeDefined();
  expect(AddonSourceResolver).toBeDefined();

  let active = 0;
  let maxActive = 0;
  const entries = Array.from({ length: 20 }, (_, index) => ({
    installed: installed(`provider-${index}`, 1_000 - index),
    adapter: {
      descriptor: () => descriptor(`provider-${index}`),
      resolve: jest.fn(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        return [];
      }),
    },
  }));

  const resolver = new AddonSourceResolver!(
    new AddonRegistry!(entries),
    1_000,
  );

  await expect(resolver.resolve(request)).resolves.toEqual([]);
  expect(maxActive).toBeLessThanOrEqual(8);
  expect(
    entries.reduce(
      (count, entry) => count + entry.adapter.resolve.mock.calls.length,
      0,
    ),
  ).toBe(20);
});


test('does not starve a healthy queued provider behind slow higher-priority providers', async () => {
  jest.useFakeTimers();
  try {
    const AddonRegistry = exported<any>('AddonRegistry');
    const AddonSourceResolver = exported<any>('AddonSourceResolver');
    expect(AddonRegistry).toBeDefined();
    expect(AddonSourceResolver).toBeDefined();

    const slowEntries = Array.from({ length: 8 }, (_, index) => ({
      installed: installed(`slow-${index}`, 1_000 - index),
      adapter: adapter(`slow-${index}`, 'never'),
    }));
    const healthySource: StreamSource = {
      id: 'healthy:1',
      providerId: 'healthy',
      url: 'https://cdn.example/healthy.mp4',
    };
    const healthy = {
      installed: installed('healthy', 100),
      adapter: adapter('healthy', [healthySource]),
    };
    const resolver = new AddonSourceResolver!(
      new AddonRegistry!([...slowEntries, healthy]),
      20,
    );

    const pending = resolver.resolve(request);
    await jest.advanceTimersByTimeAsync(20);
    await expect(pending).resolves.toEqual([healthySource]);
    expect(healthy.adapter.resolve).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

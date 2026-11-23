import { normalizeStreamCandidates } from '../streams';

describe('TvVoo-compatible stream request headers', () => {
  test('accepts flat behaviorHints.proxyHeaders maps', () => {
    const [source] = normalizeStreamCandidates('tvvoo', {
      streams: [{
        id: 'tf1',
        url: 'https://cdn.example/live.m3u8',
        behaviorHints: {
          notWebReady: true,
          proxyHeaders: {
            Referer: 'https://www.vavoo.tv/',
            'X-Playback-Token': 'runtime-token',
          },
        },
      }],
    });

    expect(source).toEqual(expect.objectContaining({
      id: 'tvvoo:tf1',
      url: 'https://cdn.example/live.m3u8',
      webReady: false,
      headers: {
        Referer: 'https://www.vavoo.tv/',
        'X-Playback-Token': 'runtime-token',
      },
    }));
  });

  test('accepts TvVoo behaviorHints.headers maps', () => {
    const [source] = normalizeStreamCandidates('tvvoo', {
      streams: [{
        id: 'france2',
        url: 'https://cdn.example/live.m3u8',
        behaviorHints: {
          headers: {
            'X-Provider': 'tvvoo',
          },
        },
      }],
    });

    expect(source?.headers).toEqual({
      'X-Provider': 'tvvoo',
    });
  });

  test('keeps standard proxy request headers first and merges safe fallbacks', () => {
    const [source] = normalizeStreamCandidates('provider', {
      streams: [{
        id: 'stream',
        url: 'https://cdn.example/live.m3u8',
        behaviorHints: {
          proxyHeaders: {
            request: {
              Authorization: 'Bearer standard',
              'X-Shared': 'standard-wins',
            },
          },
          headers: {
            'x-shared': 'hint-loses',
            'X-Hint': 'yes',
          },
        },
        headers: {
          authorization: 'Bearer direct-loses',
          'X-Direct': 'yes',
        },
      }],
    });

    expect(source?.headers).toEqual({
      Authorization: 'Bearer standard',
      'X-Shared': 'standard-wins',
      'X-Hint': 'yes',
      'X-Direct': 'yes',
    });
  });

  test('still rejects unsafe header names and injected values from legacy shapes', () => {
    const [source] = normalizeStreamCandidates('tvvoo', {
      streams: [{
        id: 'safe',
        url: 'https://cdn.example/live.m3u8',
        behaviorHints: {
          proxyHeaders: {
            Host: 'evil.example',
            'Bad Header': 'nope',
            'X-Injection': 'ok\r\nInjected: true',
            'X-Good': 'ok',
          },
        },
      }],
    });

    expect(source?.headers).toEqual({
      'X-Good': 'ok',
    });
  });
});

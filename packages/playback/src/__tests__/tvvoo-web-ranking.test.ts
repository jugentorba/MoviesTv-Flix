import type { StreamSource } from '@moviestv/core';
import { rankStreamSources } from '../ranking';

function source(
  id: string,
  overrides: Partial<StreamSource>,
): StreamSource {
  return {
    id,
    providerId: 'org.stremio.vavoo.clean',
    url: `https://stream.example/${id}.m3u8`,
    ...overrides,
  };
}

describe('TvVoo web source ranking', () => {
  test('prefers a browser-ready proxy HLS source over a clean header-dependent source', () => {
    const clean = source('clean', {
      name: 'Vavoo',
      webReady: false,
      headers: {
        'User-Agent': 'okhttp/4.11.0',
        Referer: 'https://vavoo.to/',
        Origin: 'https://vavoo.to',
      },
    });
    const proxy = source('proxy', {
      name: 'Proxy',
    });

    const ranked = rankStreamSources([clean, proxy], {
      preferredAudioLanguages: [],
      preferWebCompatible: true,
    });

    expect(ranked.map(({ source: candidate }) => candidate.id))
      .toEqual(['proxy', 'clean']);
  });

  test('keeps provider order on native when web compatibility is not requested', () => {
    const clean = source('clean', {
      name: 'Vavoo',
      webReady: false,
      headers: {
        'User-Agent': 'okhttp/4.11.0',
        Referer: 'https://vavoo.to/',
      },
    });
    const proxy = source('proxy', {
      name: 'Proxy',
    });

    const ranked = rankStreamSources([clean, proxy], {
      preferredAudioLanguages: [],
      preferWebCompatible: false,
    });

    expect(ranked.map(({ source: candidate }) => candidate.id))
      .toEqual(['clean', 'proxy']);
  });
});

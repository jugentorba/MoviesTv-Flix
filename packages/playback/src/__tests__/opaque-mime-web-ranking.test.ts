import type { StreamSource } from '@moviestv/core';
import { rankStreamSources } from '../ranking';

function source(
  id: string,
  contentType?: string,
): StreamSource {
  return {
    id,
    providerId: 'provider',
    url: `https://cdn.example/play/${id}`,
    ...(contentType ? { contentType } : {}),
  };
}

describe('opaque web stream MIME ranking', () => {
  test('prefers opaque HLS and MP4 over an unknown opaque URL', () => {
    const ranked = rankStreamSources([
      source('unknown'),
      source('mp4', 'video/mp4'),
      source('hls', 'application/vnd.apple.mpegurl'),
    ], {
      preferredAudioLanguages: [],
      preferWebCompatible: true,
    });

    expect(ranked.map(({ source: item }) => item.id)).toEqual([
      'hls',
      'mp4',
      'unknown',
    ]);
  });

  test('pushes opaque DASH and Matroska sources behind browser-safe options', () => {
    const ranked = rankStreamSources([
      source('dash', 'application/dash+xml'),
      source('mkv', 'video/x-matroska'),
      source('mp4', 'video/mp4'),
    ], {
      preferredAudioLanguages: [],
      preferWebCompatible: true,
    });

    expect(ranked[0]?.source.id).toBe('mp4');
    expect(ranked.slice(1).map(({ source: item }) => item.id))
      .toEqual(['dash', 'mkv']);
  });

  test('normalizes MIME parameters before web compatibility ranking', () => {
    const ranked = rankStreamSources([
      source('dash', 'Application/Dash+Xml; charset=utf-8'),
      source('hls', 'Application/Vnd.Apple.MpegURL; charset=utf-8'),
      source('mp4', 'Video/MP4; codecs="avc1.42E01E"'),
    ], {
      preferredAudioLanguages: [],
      preferWebCompatible: true,
    });

    expect(ranked.map(({ source: item }) => item.id)).toEqual([
      'hls',
      'mp4',
      'dash',
    ]);
  });

  test('does not change native ordering just because MIME metadata exists', () => {
    const ranked = rankStreamSources([
      source('unknown'),
      source('hls', 'application/vnd.apple.mpegurl'),
    ], {
      preferredAudioLanguages: [],
      preferWebCompatible: false,
    });

    expect(ranked.map(({ source: item }) => item.id))
      .toEqual(['unknown', 'hls']);
  });
});

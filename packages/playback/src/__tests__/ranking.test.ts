import type { StreamSource } from '../../../core/src';
import { rankStreamSources, selectBestStreamSource } from '../ranking';

function stream(
  id: string,
  language: string | undefined,
  quality: string,
  extra: Partial<StreamSource> = {},
): StreamSource {
  return {
    id,
    url: `https://example.invalid/${id}`,
    providerId: extra.providerId ?? 'provider',
    sourceId: extra.sourceId ?? id,
    language,
    quality,
    ...extra,
  };
}

test('earlier preferred audio language outranks higher video quality', () => {
  const sources = [
    stream('english-4k', 'en', '2160p'),
    stream('french-1080', 'fr', '1080p'),
  ];

  expect(selectBestStreamSource(sources, { preferredAudioLanguages: ['fr', 'en', 'de'] })?.id)
    .toBe('french-1080');
});

test('default English-first order beats later German even when German is 4K', () => {
  const sources = [
    stream('german-4k', 'de', '4K'),
    stream('english-720', 'eng', '720p'),
  ];

  expect(rankStreamSources(sources, { preferredAudioLanguages: ['en', 'fr', 'de'] })
    .map(({ source }) => source.id))
    .toEqual(['english-720', 'german-4k']);
});

test('quality resolves ties inside the same preferred-language rank', () => {
  const sources = [
    stream('french-720', 'fr-FR', '720p'),
    stream('french-4k', 'fra', '2160p'),
    stream('french-1080', 'fr', '1080p'),
  ];

  expect(rankStreamSources(sources, { preferredAudioLanguages: ['fr', 'en'] })
    .map(({ source }) => source.id))
    .toEqual(['french-4k', 'french-1080', 'french-720']);
});

test('matches any advertised audio track and keeps unknown-language sources eligible', () => {
  const sources = [
    stream('unknown-4k', undefined, '4K'),
    stream('multi-1080', undefined, '1080p', { audioLanguages: ['de', 'fr'] }),
    stream('spanish-4k', 'es', '4K'),
  ];

  expect(rankStreamSources(sources, { preferredAudioLanguages: ['fr', 'en', 'de'] })
    .map(({ source }) => source.id))
    .toEqual(['multi-1080', 'spanish-4k', 'unknown-4k']);
});

test('known original language ranks after explicit preferences and before other languages', () => {
  const sources = [
    stream('english-4k', 'en', '2160p'),
    stream('albanian-1080', 'alb', '1080p'),
    stream('french-720', 'fr', '720p'),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr'],
    originalLanguage: 'sq',
  }).map(({ source }) => source.id))
    .toEqual(['french-720', 'albanian-1080', 'english-4k']);
});

test('equal-ranked sources preserve resolver order for provider/source priority', () => {
  const sources = [
    stream('high-provider-first', 'en', '1080p', { providerId: 'provider-z', sourceId: '03' }),
    stream('same-provider-next', 'en', '1080p', { providerId: 'provider-a', sourceId: '01' }),
    stream('third', 'en', '1080p', { providerId: 'provider-b', sourceId: '02' }),
  ];

  expect(rankStreamSources(sources, { preferredAudioLanguages: ['en'] })
    .map(({ source }) => source.id))
    .toEqual(['high-provider-first', 'same-provider-next', 'third']);
});

test('ranking never mutates resolver output order', () => {
  const sources = [
    stream('french', 'fr', '1080p'),
    stream('english', 'en', '1080p'),
  ];
  const original = [...sources];

  rankStreamSources(sources, { preferredAudioLanguages: ['en', 'fr'] });

  expect(sources).toEqual(original);
});


test('web playback prefers MP4/HLS over an otherwise higher-ranked MKV source', () => {
  const sources = [
    stream('preferred-mkv', 'fr', '2160p', { url: 'https://cdn.example/movie.mkv' }),
    stream('english-mp4', 'en', '1080p', { url: 'https://cdn.example/movie.mp4', codec: 'h264' }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual(['english-mp4', 'preferred-mkv']);
});


test('web playback keeps penalizing MKV when the engine cannot demux Matroska', () => {
  const sources = [
    stream('preferred-mkv', 'fr', '2160p', { url: 'https://cdn.example/movie.mkv' }),
    stream('unwanted-language-mp4', 'de', '1080p', {
      url: 'https://cdn.example/movie.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
    webMatroskaSupported: false,
  }).map(({ source }) => source.id)).toEqual([
    'unwanted-language-mp4',
    'preferred-mkv',
  ]);
});


test('web playback lets a preferred-language MKV win when the engine demuxes Matroska', () => {
  const sources = [
    stream('preferred-mkv', 'fr', '2160p', { url: 'https://cdn.example/movie.mkv' }),
    stream('unwanted-language-mp4', 'de', '1080p', {
      url: 'https://cdn.example/movie.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
    webMatroskaSupported: true,
  }).map(({ source }) => source.id)).toEqual([
    'preferred-mkv',
    'unwanted-language-mp4',
  ]);
});


test('web playback still ranks same-language MP4 above MKV on a Matroska-capable engine', () => {
  const sources = [
    stream('mkv', 'en', '1080p', { url: 'https://cdn.example/movie.mkv' }),
    stream('mp4', 'en', '1080p', { url: 'https://cdn.example/movie.mp4' }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
    webMatroskaSupported: true,
  }).map(({ source }) => source.id)).toEqual(['mp4', 'mkv']);
});


test('web playback softens a notWebReady hint for MKV on a Matroska-capable engine', () => {
  const sources = [
    stream('hinted-mkv', 'en', '1080p', {
      url: 'https://cdn.example/play/opaque-mkv',
      filename: 'Movie.Name.2026.1080p.mkv',
      webReady: false,
    }),
    stream('unknown', 'en', '1080p', {
      url: 'https://cdn.example/play/opaque-unknown',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
    webMatroskaSupported: true,
  }).map(({ source }) => source.id)).toEqual(['hinted-mkv', 'unknown']);

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
    webMatroskaSupported: false,
  }).map(({ source }) => source.id)).toEqual(['unknown', 'hinted-mkv']);
});


test('web playback recognizes HLS from preserved Stremio filename', () => {
  const sources = [
    stream('unknown', 'en', '1080p', {
      url: 'https://cdn.example/play/opaque-a',
    }),
    stream('hinted-hls', 'en', '1080p', {
      url: 'https://cdn.example/play/opaque-b',
      filename: 'Movie.Name.2026.1080p.m3u8',
      webReady: false,
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'hinted-hls',
    'unknown',
  ]);
});

test('web playback recognizes extensionless MP4 URL hints during ranking', () => {
  const sources = [
    stream('opaque', 'en', '1080p', {
      url: 'https://cdn.example/play/opaque-id',
    }),
    stream('hinted-mp4', 'en', '1080p', {
      url: 'https://cdn.example/play?id=123&format=mp4',
      webReady: false,
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'hinted-mp4',
    'opaque',
  ]);
});

test('web playback recognizes HLS hidden in provider file query fields', () => {
  const sources = [
    stream('hidden-hls', 'en', '1080p', {
      url: 'https://cdn.example/play?file=live.m3u8&token=public',
    }),
    stream('opaque', 'en', '1080p', {
      url: 'https://cdn.example/play/opaque',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'hidden-hls',
    'opaque',
  ]);
});

test('web playback recognizes extensionless HLS URL hints during ranking', () => {
  const sources = [
    stream('preferred-mkv', 'fr', '2160p', {
      url: 'https://cdn.example/movie.mkv',
    }),
    stream('english-hls', 'en', '1080p', {
      url: 'https://cdn.example/stream?format=m3u8&token=public',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'english-hls',
    'preferred-mkv',
  ]);
});

test('web playback recognizes an HLS path without a file extension', () => {
  const sources = [
    stream('unknown', 'en', '1080p', {
      url: 'https://cdn.example/video',
    }),
    stream('hls-path', 'en', '1080p', {
      url: 'https://cdn.example/hls/session/abc123',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'hls-path',
    'unknown',
  ]);
});

test('web playback prefers a headerless playable source over a header-dependent equivalent', () => {
  const sources = [
    stream('protected', 'en', '1080p', {
      url: 'https://cdn.example/protected.mp4',
      codec: 'h264',
      headers: { Authorization: 'Bearer runtime-only' },
    }),
    stream('plain', 'en', '1080p', {
      url: 'https://cdn.example/plain.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual(['plain', 'protected']);
});


test('web playback treats QuickTime MOV as an iPhone-compatible fallback', () => {
  const sources = [
    stream('opaque', 'en', '1080p', {
      url: 'https://cdn.example/play/opaque-id',
    }),
    stream('quicktime', 'en', '1080p', {
      url: 'https://cdn.example/movie.mov',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'quicktime',
    'opaque',
  ]);
});

test('web playback recognizes HLS hidden behind a proxy url query field', () => {
  const sources = [
    stream('proxy-hls', 'en', '1080p', {
      url: 'https://proxy.example/play?url=https%3A%2F%2Fmedia.example%2Flive%2Fmaster.m3u8',
    }),
    stream('opaque', 'en', '1080p', {
      url: 'https://cdn.example/play/opaque',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'proxy-hls',
    'opaque',
  ]);
});

test('web playback recognizes MP4 hidden behind a proxy url query field', () => {
  const sources = [
    stream('proxy-mp4', 'en', '1080p', {
      url: 'https://proxy.example/play?url=https%3A%2F%2Fmedia.example%2Fmovie.mp4',
    }),
    stream('opaque', 'en', '1080p', {
      url: 'https://cdn.example/play/opaque',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'proxy-mp4',
    'opaque',
  ]);
});

test('web ranking keeps explicit HLS ahead of conflicting file-container hints', () => {
  const sources = [
    stream('hls-with-mkv-name', 'en', '1080p', {
      url: 'https://cdn.example/live.m3u8',
      filename: 'Movie.Name.2026.mkv',
      contentType: 'application/vnd.apple.mpegurl',
      codec: 'h264',
    }),
    stream('safe-mp4', 'en', '1080p', {
      url: 'https://cdn.example/movie.mp4',
      contentType: 'video/mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'hls-with-mkv-name',
    'safe-mp4',
  ]);
});

test('web ranking lets unsupported container hints override conflicting MP4 MIME metadata', () => {
  const sources = [
    stream('conflicting-mkv', 'en', '1080p', {
      url: 'https://cdn.example/play/opaque',
      filename: 'Movie.Name.2026.1080p.mkv',
      contentType: 'video/mp4',
      codec: 'h264',
    }),
    stream('safe-mp4', 'en', '1080p', {
      url: 'https://cdn.example/movie.mp4',
      contentType: 'video/mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'safe-mp4',
    'conflicting-mkv',
  ]);
});

test('web playback penalizes unsupported containers hidden behind proxy url fields', () => {
  const sources = [
    stream('proxy-mkv', 'en', '1080p', {
      url: 'https://proxy.example/play?url=https%3A%2F%2Fmedia.example%2Fmovie.mkv',
    }),
    stream('opaque', 'en', '1080p', {
      url: 'https://cdn.example/play/opaque',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'opaque',
    'proxy-mkv',
  ]);
});

test('web playback recognizes MP4 hidden in a provider stream query field', () => {
  const sources = [
    stream('nested-mp4', 'en', '1080p', {
      url: 'https://cdn.example/play?stream=https%3A%2F%2Fmedia.example%2Fmovie.mp4',
    }),
    stream('opaque', 'en', '1080p', {
      url: 'https://cdn.example/play/opaque',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'nested-mp4',
    'opaque',
  ]);
});

test('web playback still prefers an explicit MP4 over an opaque source when both are otherwise equal', () => {
  const sources = [
    stream('opaque', 'en', '1080p', {
      url: 'https://cdn.example/play/opaque-id',
    }),
    stream('direct-mp4', 'en', '1080p', {
      url: 'https://cdn.example/movie.mp4',
      webReady: false,
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'direct-mp4',
    'opaque',
  ]);
});

test('web playback tries provider-marked web-ready sources before notWebReady sources', () => {
  const sources = [
    stream('preferred-risky', 'fr', '2160p', {
      url: 'https://cdn.example/protected.mp4',
      webReady: false,
    }),
    stream('english-ready', 'en', '720p', {
      url: 'https://cdn.example/browser-ready.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'english-ready',
    'preferred-risky',
  ]);
});

test('web playback ranks HTTPS media ahead of insecure HTTP media', () => {
  const sources = [
    stream('preferred-http', 'fr', '2160p', {
      url: 'http://cdn.example/movie.mp4',
      codec: 'h264',
    }),
    stream('english-https', 'en', '720p', {
      url: 'https://cdn.example/movie.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'english-https',
    'preferred-http',
  ]);
});


test('web playback ranks FLV behind a browser-playable MP4 fallback', () => {
  const sources = [
    stream('legacy-flv', 'fr', '2160p', {
      url: 'https://cdn.example/movie.flv',
    }),
    stream('safe-mp4', 'en', '720p', {
      url: 'https://cdn.example/movie.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'safe-mp4',
    'legacy-flv',
  ]);
});

test('web playback ranks extensionless MKV hints behind browser-playable MP4', () => {
  const sources = [
    stream('hidden-mkv', 'fr', '2160p', {
      url: 'https://cdn.example/play?file=movie.mkv&token=public',
    }),
    stream('safe-mp4', 'en', '720p', {
      url: 'https://cdn.example/movie.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual(['safe-mp4', 'hidden-mkv']);
});


test('web playback treats x264 and x265 like their H264 and H265 equivalents', () => {
  const sources = [
    stream('x265-source', 'fr', '2160p', {
      url: 'https://cdn.example/play?id=x265',
      codec: 'x265 10bit',
    }),
    stream('x264-source', 'en', '1080p', {
      url: 'https://cdn.example/play?id=x264',
      codec: 'x264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'x264-source',
    'x265-source',
  ]);
});

test('web playback prefers H264 over a higher-quality risky codec when container is unknown', () => {
  const sources = [
    stream('hevc-4k', 'fr', '2160p', {
      url: 'https://cdn.example/play?id=hevc',
      codec: 'h265',
    }),
    stream('h264-1080', 'en', '1080p', {
      url: 'https://cdn.example/play?id=h264',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual(['h264-1080', 'hevc-4k']);
});


test('web playback pushes header-dependent direct MP4 behind a plain fallback', () => {
  const sources = [
    stream('protected-mp4', 'fr', '2160p', {
      url: 'https://cdn.example/protected.mp4',
      codec: 'h264',
      headers: { Authorization: 'Bearer runtime-only' },
    }),
    stream('plain-mp4', 'en', '720p', {
      url: 'https://cdn.example/plain.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual(['plain-mp4', 'protected-mp4']);
});


test('web playback pushes protected extensionless source behind plain MP4', () => {
  const sources = [
    stream('protected-extensionless', 'fr', '2160p', {
      url: 'https://cdn.example/play?id=movie',
      codec: 'h264',
      headers: { Authorization: 'Bearer runtime-only' },
    }),
    stream('plain-mp4-fallback', 'en', '720p', {
      url: 'https://cdn.example/fallback.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'plain-mp4-fallback',
    'protected-extensionless',
  ]);
});


test('web playback pushes HLS requiring browser-forbidden Referer behind a plain fallback', () => {
  const sources = [
    stream('protected-hls', 'fr', '2160p', {
      url: 'https://cdn.example/protected.m3u8',
      headers: { Referer: 'https://provider.example/' },
    }),
    stream('plain-hls', 'en', '720p', {
      url: 'https://cdn.example/plain.m3u8',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'plain-hls',
    'protected-hls',
  ]);
});

test('web ranking treats Accept-Encoding as browser-managed metadata', () => {
  const sources = [
    stream('managed-header-hls', 'fr', '2160p', {
      url: 'https://cdn.example/protected.m3u8',
      headers: { 'Accept-Encoding': 'gzip' },
    }),
    stream('plain-hls', 'en', '720p', {
      url: 'https://cdn.example/plain.m3u8',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'plain-hls',
    'managed-header-hls',
  ]);
});

test('native ranking does not penalize Referer-protected HLS', () => {
  const sources = [
    stream('protected-hls', 'fr', '2160p', {
      url: 'https://cdn.example/protected.m3u8',
      headers: { Referer: 'https://provider.example/' },
    }),
    stream('plain-hls', 'en', '720p', {
      url: 'https://cdn.example/plain.m3u8',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: false,
  }).map(({ source }) => source.id)).toEqual([
    'protected-hls',
    'plain-hls',
  ]);
});


test('web playback ranks DASH behind a browser-playable HLS fallback', () => {
  const sources = [
    stream('preferred-dash', 'fr', '2160p', {
      url: 'https://cdn.example/movie.mpd',
    }),
    stream('english-hls-fallback', 'en', '720p', {
      url: 'https://cdn.example/live.m3u8',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'english-hls-fallback',
    'preferred-dash',
  ]);
});

test('web playback recognizes extensionless DASH hints as unsupported', () => {
  const sources = [
    stream('preferred-dash-hint', 'fr', '2160p', {
      url: 'https://cdn.example/play?format=dash&token=public',
    }),
    stream('plain-mp4-fallback', 'en', '720p', {
      url: 'https://cdn.example/movie.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'plain-mp4-fallback',
    'preferred-dash-hint',
  ]);
});


test('web playback keeps preferred language ahead of a safer later-language MP4', () => {
  const sources = [
    stream('hevc-french-4k-mp4', 'fr', '2160p', {
      url: 'https://cdn.example/hevc-fr.mp4',
      codec: 'h265',
    }),
    stream('h264-english-1080-mp4', 'en', '1080p', {
      url: 'https://cdn.example/h264-en.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'hevc-french-4k-mp4',
    'h264-english-1080-mp4',
  ]);
});

test('web playback prefers H264 MP4 when language priority is equal', () => {
  const sources = [
    stream('hevc-4k-mp4', 'fr', '2160p', {
      url: 'https://cdn.example/hevc.mp4',
      codec: 'h265',
    }),
    stream('h264-1080-mp4', 'fr', '1080p', {
      url: 'https://cdn.example/h264.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'h264-1080-mp4',
    'hevc-4k-mp4',
  ]);
});

test('native playback keeps quality and language ranking for HEVC MP4', () => {
  const sources = [
    stream('hevc-4k-mp4', 'fr', '2160p', {
      url: 'https://cdn.example/hevc.mp4',
      codec: 'h265',
    }),
    stream('h264-1080-mp4', 'en', '1080p', {
      url: 'https://cdn.example/h264.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: false,
  }).map(({ source }) => source.id)).toEqual([
    'hevc-4k-mp4',
    'h264-1080-mp4',
  ]);
});


test('web ranking does not treat a display name like Dash as a container hint', () => {
  const sources = [
    stream('dash-title', 'fr', '1080p', {
      url: 'https://cdn.example/play?id=dash-title',
      name: 'Dash',
      codec: 'h264',
    }),
    stream('english-opaque', 'en', '1080p', {
      url: 'https://cdn.example/play?id=english',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'dash-title',
    'english-opaque',
  ]);
});


test('web ranking does not infer MP4 from a provider display name', () => {
  const sources = [
    stream('fake-mp4-title', 'fr', '1080p', {
      url: 'https://cdn.example/play?id=opaque',
      name: 'Movie.mp4',
      codec: 'h264',
    }),
    stream('real-mp4', 'en', '1080p', {
      url: 'https://cdn.example/browser-ready.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'real-mp4',
    'fake-mp4-title',
  ]);
});

test('web ranking does not infer HLS from a provider display name', () => {
  const sources = [
    stream('fake-hls-title', 'fr', '1080p', {
      url: 'https://cdn.example/play?id=opaque',
      name: 'HLS Premium',
      codec: 'h264',
    }),
    stream('real-hls', 'en', '720p', {
      url: 'https://cdn.example/live.m3u8',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'real-hls',
    'fake-hls-title',
  ]);
});


test('web playback prefers browser-friendly audio over DTS or TrueHD MP4', () => {
  const sources = [
    stream('dts', 'fr', '1080p', {
      url: 'https://cdn.example/dts.mp4',
      name: 'Lumio 1080p DTS-HD',
      codec: 'h264',
    }),
    stream('truehd', 'fr', '1080p', {
      url: 'https://cdn.example/truehd.mp4',
      name: 'Lumio 1080p TrueHD',
      codec: 'h264',
    }),
    stream('aac', 'fr', '1080p', {
      url: 'https://cdn.example/aac.mp4',
      name: 'Lumio 1080p AAC',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'aac',
    'dts',
    'truehd',
  ]);
});

test('native playback keeps resolver order for DTS or TrueHD MP4', () => {
  const sources = [
    stream('dts', 'fr', '1080p', {
      url: 'https://cdn.example/dts.mp4',
      name: 'Lumio 1080p DTS-HD',
      codec: 'h264',
    }),
    stream('truehd', 'fr', '1080p', {
      url: 'https://cdn.example/truehd.mp4',
      name: 'Lumio 1080p TrueHD',
      codec: 'h264',
    }),
    stream('aac', 'fr', '1080p', {
      url: 'https://cdn.example/aac.mp4',
      name: 'Lumio 1080p AAC',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: false,
  }).map(({ source }) => source.id)).toEqual([
    'dts',
    'truehd',
    'aac',
  ]);
});


test('web ranking detects plain URL containers without optional metadata', () => {
  const sources = [
    stream('preferred-mkv-h264', 'fr', '2160p', {
      url: 'https://cdn.example/movie.mkv',
      codec: 'h264',
    }),
    stream('english-mp4-h264', 'en', '1080p', {
      url: 'https://cdn.example/movie.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'english-mp4-h264',
    'preferred-mkv-h264',
  ]);
});


test('web playback prefers SDR over HDR or Dolby Vision at the same language', () => {
  const sources = [
    stream('hdr', 'fr', '2160p', {
      url: 'https://cdn.example/hdr.mp4',
      name: 'Lumio 4K HDR10',
      codec: 'h264',
    }),
    stream('dolby-vision', 'fr', '2160p', {
      url: 'https://cdn.example/dolby-vision.mp4',
      name: 'Lumio 4K Dolby Vision',
      codec: 'h264',
    }),
    stream('sdr', 'fr', '1080p', {
      url: 'https://cdn.example/sdr.mp4',
      name: 'Lumio 1080p SDR',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'sdr',
    'hdr',
    'dolby-vision',
  ]);
});

test('web HDR preference does not override preferred audio language', () => {
  const sources = [
    stream('french-dolby-vision', 'fr', '2160p', {
      url: 'https://cdn.example/french-dv.mp4',
      name: 'Lumio 4K DoVi',
      codec: 'h264',
    }),
    stream('english-sdr', 'en', '1080p', {
      url: 'https://cdn.example/english-sdr.mp4',
      name: 'Lumio 1080p SDR',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'french-dolby-vision',
    'english-sdr',
  ]);
});

test('native playback does not penalize HDR or Dolby Vision labels', () => {
  const sources = [
    stream('dolby-vision', 'fr', '2160p', {
      url: 'https://cdn.example/dolby-vision.mp4',
      name: 'Lumio 4K Dolby Vision',
      codec: 'h264',
    }),
    stream('sdr', 'fr', '1080p', {
      url: 'https://cdn.example/sdr.mp4',
      name: 'Lumio 1080p SDR',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: false,
  }).map(({ source }) => source.id)).toEqual([
    'dolby-vision',
    'sdr',
  ]);
});


test('web ranking honors normalized dynamic range metadata', () => {
  const sources = [
    stream('dolby-vision', 'fr', '2160p', {
      url: 'https://cdn.example/dv.mp4',
      name: 'Lumio',
      codec: 'h264',
      dynamicRange: 'dolby-vision',
    }),
    stream('sdr', 'fr', '1080p', {
      url: 'https://cdn.example/sdr.mp4',
      name: 'Lumio',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'sdr',
    'dolby-vision',
  ]);
});

test('web ranking honors normalized audio codec metadata', () => {
  const sources = [
    stream('dts', 'fr', '1080p', {
      url: 'https://cdn.example/dts.mp4',
      name: 'Lumio',
      codec: 'h264',
      audioCodec: 'dts',
    }),
    stream('aac', 'fr', '1080p', {
      url: 'https://cdn.example/aac.mp4',
      name: 'Lumio',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'aac',
    'dts',
  ]);
});


test('web ranking recognizes opaque WebM from MIME metadata', () => {
  const sources = [
    stream('unknown-h264', 'fr', '1080p', {
      url: 'https://cdn.example/play/opaque-a',
      codec: 'h264',
    }),
    stream('tagged-webm', 'fr', '1080p', {
      url: 'https://cdn.example/play/opaque-b',
      contentType: 'video/webm',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'tagged-webm',
    'unknown-h264',
  ]);
});


test('web ranking does not treat HLS text in an MP4 path as HLS', () => {
  const sources = [
    stream('hls-title-mp4', 'en', '1080p', {
      url: 'https://cdn.example/movies/HLS-documentary.mp4',
      contentType: 'video/mp4',
      codec: 'h264',
    }),
    stream('real-hls', 'en', '1080p', {
      url: 'https://cdn.example/play/opaque?format=hls',
      contentType: undefined,
      codec: 'h264',
    }),
  ];

  const ranked = rankStreamSources(sources, {
    preferredAudioLanguages: ['en'],
    preferWebCompatible: true,
  });

  expect(ranked[0]?.source.id).toBe('real-hls');
  expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
});


test('web playback keeps first preferred language across browser-playable HLS and MP4', () => {
  const sources = [
    stream('french-mp4', 'fr', '1080p', {
      url: 'https://cdn.example/french.mp4',
      codec: 'h264',
    }),
    stream('english-hls', 'en', '1080p', {
      url: 'https://cdn.example/english.m3u8',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'french-mp4',
    'english-hls',
  ]);
});

test('same-language web playback still prefers HLS over MP4', () => {
  const sources = [
    stream('mp4', 'fr', '1080p', {
      url: 'https://cdn.example/movie.mp4',
      codec: 'h264',
    }),
    stream('hls', 'fr', '1080p', {
      url: 'https://cdn.example/movie.m3u8',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr', 'en'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'hls',
    'mp4',
  ]);
});

test('web playback treats raw Dolby Vision codec ids like HEVC', () => {
  const sources = [
    stream('dolby-vision', 'fr', '1080p', {
      url: 'https://cdn.example/dolby-vision.mp4',
      codec: 'dvh1.05.06',
    }),
    stream('h264', 'fr', '1080p', {
      url: 'https://cdn.example/h264.mp4',
      codec: 'h264',
    }),
  ];

  expect(rankStreamSources(sources, {
    preferredAudioLanguages: ['fr'],
    preferWebCompatible: true,
  }).map(({ source }) => source.id)).toEqual([
    'h264',
    'dolby-vision',
  ]);
});


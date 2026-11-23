import {
  dedupeStreamSources,
  normalizeStreamCandidates,
} from '@moviestv/addons';
import { rankStreamSources } from '@moviestv/playback';

describe('opaque provider stream web flow', () => {
  test('keeps MIME evidence through normalization, dedupe and web ranking', () => {
    const normalized = normalizeStreamCandidates('provider', {
      streams: [
        {
          id: 'unknown',
          url: 'https://cdn.example/play/unknown',
          title: '1080p English',
        },
        {
          id: 'hls',
          url: 'https://cdn.example/play/hls-signed-id',
          title: '1080p English',
          contentType: 'application/vnd.apple.mpegurl',
        },
        {
          id: 'mkv',
          url: 'https://cdn.example/play/mkv-signed-id',
          title: '1080p English',
          contentType: 'video/x-matroska',
        },
      ],
    });

    const deduped = dedupeStreamSources([normalized]);
    const ranked = rankStreamSources(deduped, {
      preferredAudioLanguages: ['en', 'fr', 'de'],
      preferWebCompatible: true,
    });

    expect(
      ranked.map(({ source }) => [
        source.sourceId,
        source.contentType,
      ]),
    ).toEqual([
      ['hls', 'application/vnd.apple.mpegurl'],
      ['unknown', undefined],
      ['mkv', 'video/x-matroska'],
    ]);
  });


  test('uses MIME codec parameters when ranking opaque MP4 provider sources', () => {
    const normalized = normalizeStreamCandidates('provider', {
      streams: [
        {
          id: 'hevc',
          url: 'https://cdn.example/play/hevc-signed-id',
          title: '1080p English',
          contentType: 'video/mp4; codecs="hvc1.1.6.L93.B0, mp4a.40.2"',
        },
        {
          id: 'h264',
          url: 'https://cdn.example/play/h264-signed-id',
          title: '1080p English',
          contentType: 'video/mp4; codecs="avc1.4d401f, mp4a.40.2"',
        },
      ],
    });

    const ranked = rankStreamSources(normalized, {
      preferredAudioLanguages: ['en'],
      preferWebCompatible: true,
    });

    expect(normalized.map((source) => [source.sourceId, source.codec]))
      .toEqual([
        ['hevc', 'h265'],
        ['h264', 'h264'],
      ]);
    expect(ranked.map(({ source }) => source.sourceId))
      .toEqual(['h264', 'hevc']);
  });
  test('ranks browser-friendly audio ahead of MIME-declared TrueHD', () => {
    const normalized = normalizeStreamCandidates('provider', {
      streams: [
        {
          id: 'truehd',
          url: 'https://cdn.example/play/truehd-signed-id',
          title: '1080p English',
          contentType: 'video/mp4; codecs="avc1.4d401f, mlpa"',
        },
        {
          id: 'aac',
          url: 'https://cdn.example/play/aac-signed-id',
          title: '1080p English',
          contentType: 'video/mp4; codecs="avc1.4d401f, mp4a.40.2"',
        },
      ],
    });

    const ranked = rankStreamSources(normalized, {
      preferredAudioLanguages: ['en'],
      preferWebCompatible: true,
    });

    expect(normalized.map((source) => [source.sourceId, source.audioCodec]))
      .toEqual([
        ['truehd', 'truehd'],
        ['aac', undefined],
      ]);
    expect(ranked.map(({ source }) => source.sourceId))
      .toEqual(['aac', 'truehd']);
  });
  test('ranks SDR H264 ahead of MIME-declared Dolby Vision when language is equal', () => {
    const normalized = normalizeStreamCandidates('provider', {
      streams: [
        {
          id: 'dolby-vision',
          url: 'https://cdn.example/play/dv-signed-id',
          title: '1080p English',
          contentType: 'video/mp4; codecs="dvh1.05.06, ec-3"',
        },
        {
          id: 'sdr',
          url: 'https://cdn.example/play/sdr-signed-id',
          title: '1080p English',
          contentType: 'video/mp4; codecs="avc1.4d401f, mp4a.40.2"',
        },
      ],
    });

    const ranked = rankStreamSources(normalized, {
      preferredAudioLanguages: ['en'],
      preferWebCompatible: true,
    });

    expect(normalized.map((source) => [
      source.sourceId,
      source.codec,
      source.dynamicRange,
    ])).toEqual([
      ['dolby-vision', 'h265', 'dolby-vision'],
      ['sdr', 'h264', undefined],
    ]);
    expect(ranked.map(({ source }) => source.sourceId))
      .toEqual(['sdr', 'dolby-vision']);
  });
});

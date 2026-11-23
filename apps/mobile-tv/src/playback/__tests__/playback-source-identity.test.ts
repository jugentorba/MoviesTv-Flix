import type { StreamSource } from '@moviestv/core';
import { playbackSourceFingerprint } from '../playbackSourceIdentity';

function source(
  overrides: Partial<StreamSource> = {},
): StreamSource {
  return {
    id: 'provider:main',
    url: 'https://cdn.example/video.m3u8?token=SUPER-SECRET#fragment',
    headers: {
      Authorization: 'Bearer VERY-SECRET',
      Referer: 'https://player.example/',
    },
    ...overrides,
  };
}

test('playback source fingerprints do not expose URLs or header credentials', () => {
  const fingerprint = playbackSourceFingerprint(source());

  expect(fingerprint).toMatch(/^source-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);
  expect(fingerprint).not.toContain('cdn.example');
  expect(fingerprint).not.toContain('SUPER-SECRET');
  expect(fingerprint).not.toContain('Authorization');
  expect(fingerprint).not.toContain('VERY-SECRET');
});

test('playback source fingerprints ignore URL fragments and header order/casing', () => {
  const first = playbackSourceFingerprint(source());
  const second = playbackSourceFingerprint(source({
    url: 'https://cdn.example/video.m3u8?token=SUPER-SECRET#other',
    headers: {
      referer: 'https://player.example/',
      authorization: 'Bearer VERY-SECRET',
    },
  }));

  expect(second).toBe(first);
});

test('playback source fingerprints change when request credentials or URL query change', () => {
  const first = playbackSourceFingerprint(source());
  const changedHeader = playbackSourceFingerprint(source({
    headers: {
      Authorization: 'Bearer NEW-SECRET',
      Referer: 'https://player.example/',
    },
  }));
  const changedQuery = playbackSourceFingerprint(source({
    url: 'https://cdn.example/video.m3u8?token=NEW-TOKEN',
  }));

  expect(changedHeader).not.toBe(first);
  expect(changedQuery).not.toBe(first);
});


test('playback source fingerprints are independent of locale-sensitive header ordering', () => {
  const localeCompare = jest.spyOn(
    String.prototype,
    'localeCompare',
  ).mockImplementation(() => 99);

  try {
    const fingerprint = playbackSourceFingerprint(source({
      headers: {
        'X-É': 'value-b',
        'X-A': 'value-a',
      },
    }));
    const reordered = playbackSourceFingerprint(source({
      headers: {
        'x-a': 'value-a',
        'x-é': 'value-b',
      },
    }));

    expect(reordered).toBe(fingerprint);
    expect(localeCompare).not.toHaveBeenCalled();
  } finally {
    localeCompare.mockRestore();
  }
});


test('playback source fingerprints change when transport metadata is corrected', () => {
  const opaque = source({
    url: 'https://cdn.example/play/opaque?token=SUPER-SECRET',
    filename: undefined,
    contentType: undefined,
  });
  const hlsByMime = source({
    ...opaque,
    contentType: 'application/vnd.apple.mpegurl',
  });
  const hlsByFilename = source({
    ...opaque,
    filename: 'movie.master.m3u8',
  });

  expect(playbackSourceFingerprint(hlsByMime))
    .not.toBe(playbackSourceFingerprint(opaque));
  expect(playbackSourceFingerprint(hlsByFilename))
    .not.toBe(playbackSourceFingerprint(opaque));
});

test('playback source fingerprints ignore MIME parameter formatting when compatibility metadata is stable', () => {
  const first = playbackSourceFingerprint(source({
    contentType: 'video/mp4; codecs="avc1.4d401f, mp4a.40.2"',
    codec: 'h264',
  }));
  const second = playbackSourceFingerprint(source({
    contentType: ' Video/MP4 ; codecs="avc1.42E01E, mp4a.40.2" ',
    codec: 'h264',
  }));

  expect(second).toBe(first);
});

test('playback source fingerprints ignore filename changes with the same transport extension', () => {
  const first = playbackSourceFingerprint(source({
    filename: 'Movie.One.master.m3u8',
  }));
  const second = playbackSourceFingerprint(source({
    filename: 'Movie.Two.master.m3u8',
  }));

  expect(second).toBe(first);
});


test('fingerprints change when playback compatibility metadata is corrected', () => {
  const opaque = source({
    url: 'https://cdn.example/play/opaque?token=SUPER-SECRET',
    contentType: undefined,
    codec: undefined,
    codecDetail: undefined,
    audioCodec: undefined,
    dynamicRange: undefined,
    webReady: undefined,
  });

  const variants = [
    source({ ...opaque, codec: 'h264' }),
    source({
      ...opaque,
      codec: 'h264',
      codecDetail: 'avc1.640028',
    }),
    source({ ...opaque, audioCodec: 'truehd' }),
    source({ ...opaque, dynamicRange: 'dolby-vision' }),
    source({ ...opaque, webReady: true }),
    source({ ...opaque, webReady: false }),
  ];

  for (const variant of variants) {
    expect(playbackSourceFingerprint(variant))
      .not.toBe(playbackSourceFingerprint(opaque));
  }
});

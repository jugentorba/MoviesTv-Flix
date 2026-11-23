import type { StreamSource } from '@moviestv/core';
import { canDownloadSource as canDownloadNative } from '../downloadSource.native';
import { canDownloadSource as canDownloadWeb } from '../downloadSource.web';

function source(overrides: Partial<StreamSource> = {}): StreamSource {
  return {
    id: 'source',
    url: 'https://cdn.example/movie.mp4',
    ...overrides,
  };
}

test('direct files are downloadable on native and web', () => {
  const direct = source();
  expect(canDownloadNative(direct)).toBe(true);
  expect(canDownloadWeb(direct)).toBe(true);
});

test('HLS playlists are not exposed as offline movie downloads', () => {
  const hls = source({ url: 'https://cdn.example/live.m3u8', name: '1080p HLS' });
  expect(canDownloadNative(hls)).toBe(false);
  expect(canDownloadWeb(hls)).toBe(false);
});

test('header-protected direct files stay downloadable natively but not through a browser link', () => {
  const protectedFile = source({
    headers: { Authorization: 'Bearer runtime-only' },
  });
  expect(canDownloadNative(protectedFile)).toBe(true);
  expect(canDownloadWeb(protectedFile)).toBe(false);
});


test('HTTP downloads are Android-only while iOS/tvOS require HTTPS', () => {
  const insecure = source({ url: 'http://cdn.example/movie.mp4' });
  expect(canDownloadWeb(insecure)).toBe(false);
  expect(canDownloadNative(insecure, 'android')).toBe(true);
  expect(canDownloadNative(insecure, 'ios')).toBe(false);
  expect(canDownloadNative(insecure, 'tvos')).toBe(false);
});

test('download capability rejects non-network URL schemes', () => {
  for (const url of ['file:///movie.mp4', 'data:video/mp4;base64,AAAA', 'javascript:alert(1)']) {
    const candidate = source({ url });
    expect(canDownloadWeb(candidate)).toBe(false);
    expect(canDownloadNative(candidate)).toBe(false);
  }
});


test('download capability rejects blank source ids and credential URLs', () => {
  expect(canDownloadWeb(source({ id: ' ' }))).toBe(false);
  expect(canDownloadNative(source({ id: ' ' }))).toBe(false);
  const credential = source({ url: 'https://user:secret@cdn.example/movie.mp4' });
  expect(canDownloadWeb(credential)).toBe(false);
  expect(canDownloadNative(credential)).toBe(false);
});

test('browser download rejects unsupported direct containers', () => {
  expect(canDownloadWeb(source({ url: 'https://cdn.example/movie.mkv' }))).toBe(false);
  expect(canDownloadWeb(source({ url: 'https://cdn.example/movie.avi?token=x' }))).toBe(false);
});


test('download capability bounds normalized URLs and source ids', () => {
  const expanded = source({
    url: `https://cdn.example/${'é'.repeat(2_000)}.mp4`,
  });
  expect(expanded.url.length).toBeLessThan(8_192);
  expect(canDownloadWeb(expanded)).toBe(false);
  expect(canDownloadNative(expanded)).toBe(false);

  const oversizedId = source({ id: 'x'.repeat(513) });
  expect(canDownloadWeb(oversizedId)).toBe(false);
  expect(canDownloadNative(oversizedId)).toBe(false);

  const controlId = source({ id: 'source\u0000bad' });
  expect(canDownloadWeb(controlId)).toBe(false);
  expect(canDownloadNative(controlId)).toBe(false);
});

test('native download rejects malformed or forbidden request headers', () => {
  expect(canDownloadNative(source({
    headers: { Cookie: 'session=private' },
  }))).toBe(false);

  expect(canDownloadNative(source({
    headers: { 'X-Bad': 'safe\r\nInjected: true' },
  }))).toBe(false);

  expect(canDownloadNative(source({
    headers: Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [
        `X-Header-${index}`,
        'value',
      ]),
    ),
  }))).toBe(false);

  expect(canDownloadNative(source({
    headers: {
      Authorization: 'Bearer runtime-only',
      Referer: 'https://player.example/',
    },
  }))).toBe(true);
});


test('native download rejects duplicate request headers case-insensitively', () => {
  expect(canDownloadNative(source({
    headers: {
      Authorization: 'Bearer one',
      authorization: 'Bearer two',
    },
  }))).toBe(false);

  expect(canDownloadNative(source({
    headers: {
      ' Referer ': 'https://one.example/',
      referer: 'https://two.example/',
    },
  }))).toBe(false);
});


test('browser download rejects any declared custom request header', () => {
  expect(canDownloadWeb(source({
    headers: { ' ': ' ' },
  }))).toBe(false);
  expect(canDownloadWeb(source({
    headers: { Referer: 'https://player.example/' },
  }))).toBe(false);
});


test('download capability ignores HLS wording in display names', () => {
  const direct = source({
    name: 'HLS Premium',
    url: 'https://cdn.example/movie.mp4',
  });

  expect(canDownloadNative(direct)).toBe(true);
  expect(canDownloadWeb(direct)).toBe(true);
});

test('download capability honors transport filenames on opaque URLs', () => {
  const hls = source({
    url: 'https://cdn.example/play?id=opaque',
    filename: 'channel.m3u8',
  });
  expect(canDownloadNative(hls)).toBe(false);
  expect(canDownloadWeb(hls)).toBe(false);

  const mkv = source({
    url: 'https://cdn.example/play?id=opaque-mkv',
    filename: 'movie.mkv',
  });
  expect(canDownloadWeb(mkv)).toBe(false);
});


test('adaptive DASH manifests are not exposed as offline movie downloads', () => {
  for (const candidate of [
    source({ url: 'https://cdn.example/movie.mpd' }),
    source({
      url: 'https://cdn.example/play?id=opaque',
      filename: 'movie.mpd',
    }),
    source({
      url: 'https://cdn.example/play?format=dash&id=opaque',
    }),
  ]) {
    expect(canDownloadNative(candidate)).toBe(false);
    expect(canDownloadWeb(candidate)).toBe(false);
  }
});

test('adaptive HLS query hints are not exposed as offline movie downloads', () => {
  const hls = source({
    url: 'https://cdn.example/play?type=application%2Fvnd.apple.mpegurl&id=opaque',
  });

  expect(canDownloadNative(hls)).toBe(false);
  expect(canDownloadWeb(hls)).toBe(false);
});


test('adaptive manifests hidden behind proxy URL fields are not downloadable', () => {
  for (const candidate of [
    source({
      url: 'https://proxy.example/play?url=https%3A%2F%2Fcdn.example%2Flive%2Fmaster.m3u8',
    }),
    source({
      url: 'https://proxy.example/play?source=https%3A%2F%2Fcdn.example%2Fmanifest.mpd',
    }),
    source({
      url: 'https://proxy.example/play?playlist=hls',
    }),
  ]) {
    expect(canDownloadNative(candidate)).toBe(false);
    expect(canDownloadWeb(candidate)).toBe(false);
  }
});

test('parameterized adaptive MIME metadata is never exposed as a direct offline file', () => {
  for (const candidate of [
    source({
      url: 'https://cdn.example/play?id=opaque-hls-parameters',
      contentType: 'Application/Vnd.Apple.MpegURL; charset=utf-8',
    }),
    source({
      url: 'https://cdn.example/play?id=opaque-dash-parameters',
      contentType: 'Application/Dash+Xml; charset=utf-8',
    }),
  ]) {
    expect(canDownloadNative(candidate)).toBe(false);
    expect(canDownloadWeb(candidate)).toBe(false);
  }
});

test('adaptive MIME metadata is never exposed as a direct offline file', () => {
  for (const candidate of [
    source({
      url: 'https://cdn.example/play?id=opaque-hls',
      contentType: 'application/vnd.apple.mpegurl',
    }),
    source({
      url: 'https://cdn.example/play?id=opaque-hls-alt',
      contentType: 'application/x-mpegurl',
    }),
    source({
      url: 'https://cdn.example/play?id=opaque-dash',
      contentType: 'application/dash+xml',
    }),
  ]) {
    expect(canDownloadNative(candidate)).toBe(false);
    expect(canDownloadWeb(candidate)).toBe(false);
  }
});

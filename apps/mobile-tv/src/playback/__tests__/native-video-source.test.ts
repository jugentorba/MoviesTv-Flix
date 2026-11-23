import {
  nativeVideoSourceSignature,
  toNativeVideoSource,
} from '../nativeVideoSource';

test('marks opaque HLS for expo-video so iOS exposes media tracks', () => {
  expect(toNativeVideoSource({
    id: 'opaque-hls',
    url: 'https://cdn.example/play/opaque',
    contentType: 'application/vnd.apple.mpegurl',
    headers: { Authorization: 'Bearer public-test' },
  }, 'ios')).toEqual({
    uri: 'https://cdn.example/play/opaque',
    headers: { Authorization: 'Bearer public-test' },
    contentType: 'hls',
  });
});

test('normalizes MIME parameters for native HLS and DASH transport hints', () => {
  expect(toNativeVideoSource({
    id: 'parameterized-hls',
    url: 'https://cdn.example/play/opaque-hls',
    contentType: 'Application/Vnd.Apple.MpegURL; charset=utf-8',
  }, 'ios')).toEqual({
    uri: 'https://cdn.example/play/opaque-hls',
    contentType: 'hls',
  });

  expect(toNativeVideoSource({
    id: 'parameterized-dash',
    url: 'https://cdn.example/play/opaque-dash',
    contentType: 'Application/Dash+Xml; charset=utf-8',
  }, 'android')).toEqual({
    uri: 'https://cdn.example/play/opaque-dash',
    contentType: 'dash',
  });
});

test('recognizes native DASH hidden behind a proxy source query field', () => {
  const url = 'https://proxy.example/play?source=https%3A%2F%2Fmedia.example%2Fmanifest.mpd';

  expect(toNativeVideoSource({
    id: 'proxy-dash',
    url,
  }, 'android')).toEqual({
    uri: url,
    contentType: 'dash',
  });

  expect(toNativeVideoSource({
    id: 'proxy-dash',
    url,
  }, 'ios')).toEqual({
    uri: url,
  });
});

test('recognizes native HLS hidden behind a proxy url query field', () => {
  expect(toNativeVideoSource({
    id: 'proxy-hls',
    url: 'https://proxy.example/play?url=https%3A%2F%2Fmedia.example%2Flive%2Fmaster.m3u8',
  }, 'ios')).toEqual({
    uri: 'https://proxy.example/play?url=https%3A%2F%2Fmedia.example%2Flive%2Fmaster.m3u8',
    contentType: 'hls',
  });
});

test('recognizes HLS from an m3u8 URL even without MIME metadata', () => {
  expect(toNativeVideoSource({
    id: 'hls-url',
    url: 'https://cdn.example/live/master.m3u8?token=public',
  }, 'android')).toEqual({
    uri: 'https://cdn.example/live/master.m3u8?token=public',
    contentType: 'hls',
  });
});

test('only forces DASH on Android', () => {
  const source = {
    id: 'dash',
    url: 'https://cdn.example/play/opaque',
    contentType: 'application/dash+xml',
  };

  expect(toNativeVideoSource(source, 'android')).toEqual({
    uri: source.url,
    contentType: 'dash',
  });
  expect(toNativeVideoSource(source, 'ios')).toEqual({
    uri: source.url,
  });
});

test('leaves ordinary progressive sources on expo-video auto detection', () => {
  expect(toNativeVideoSource({
    id: 'mp4',
    url: 'https://cdn.example/movie.mp4',
    contentType: 'video/mp4',
  }, 'ios')).toEqual({
    uri: 'https://cdn.example/movie.mp4',
  });
});


test('changes the native reset signature when transport metadata is corrected', () => {
  const base = {
    id: 'same',
    url: 'https://cdn.example/play/opaque',
    headers: { Referer: 'https://player.example/' },
  };

  expect(nativeVideoSourceSignature(base, 'ios')).not.toBe(
    nativeVideoSourceSignature({
      ...base,
      contentType: 'application/vnd.apple.mpegurl',
    }, 'ios'),
  );
});

test('normalizes native reset signature header order', () => {
  const left = {
    id: 'same',
    url: 'https://cdn.example/play/opaque',
    headers: {
      Referer: 'https://player.example/',
      Authorization: 'Bearer public-test',
    },
  };
  const right = {
    ...left,
    headers: {
      Authorization: 'Bearer public-test',
      Referer: 'https://player.example/',
    },
  };

  expect(nativeVideoSourceSignature(left, 'android')).toBe(
    nativeVideoSourceSignature(right, 'android'),
  );
});


test('recognizes native HLS from preserved filename and path metadata', () => {
  expect(toNativeVideoSource({
    id: 'filename-hls',
    url: 'https://cdn.example/play/opaque',
    filename: 'Movie.Name.2026.master.m3u8',
  }, 'ios')).toEqual({
    uri: 'https://cdn.example/play/opaque',
    contentType: 'hls',
  });

  expect(toNativeVideoSource({
    id: 'path-hls',
    url: 'https://cdn.example/hls/session/opaque',
  }, 'android')).toEqual({
    uri: 'https://cdn.example/hls/session/opaque',
    contentType: 'hls',
  });
});

test('recognizes native DASH from preserved filename on Android only', () => {
  const source = {
    id: 'filename-dash',
    url: 'https://cdn.example/play/opaque',
    filename: 'manifest.mpd',
  };

  expect(toNativeVideoSource(source, 'android')).toEqual({
    uri: source.url,
    contentType: 'dash',
  });
  expect(toNativeVideoSource(source, 'ios')).toEqual({
    uri: source.url,
  });
});


test('native source signatures never depend on localeCompare', () => {
  const localeCompare = jest.spyOn(
    String.prototype,
    'localeCompare',
  ).mockImplementation(() => 99);

  try {
    const left = {
      id: 'same',
      url: 'https://cdn.example/play/opaque',
      headers: {
        'X-É': 'value-b',
        'X-A': 'value-a',
      },
    };
    const right = {
      ...left,
      headers: {
        'x-a': 'value-a',
        'x-é': 'value-b',
      },
    };

    expect(nativeVideoSourceSignature(left, 'ios')).toBe(
      nativeVideoSourceSignature(right, 'ios'),
    );
    expect(localeCompare).not.toHaveBeenCalled();
  } finally {
    localeCompare.mockRestore();
  }
});

import type { StreamSource } from '@moviestv/core';
import { nativeDownloadFileName } from '../downloadSource.native';

const source: StreamSource = {
  id: 'source',
  url: 'https://cdn.example/video.mp4',
  quality: '1080p',
  providerId: 'provider-a',
};

test('native offline filenames separate distinct media with the same display title', () => {
  const first = nativeDownloadFileName(
    source,
    'Episode',
    {
      mediaId: 'series:1:1',
      kind: 'episode',
      title: 'Episode',
    },
  );
  const second = nativeDownloadFileName(
    source,
    'Episode',
    {
      mediaId: 'series:1:2',
      kind: 'episode',
      title: 'Episode',
    },
  );

  expect(first).not.toBe(second);
  expect(first).toMatch(/\.mp4$/);
  expect(second).toMatch(/\.mp4$/);
});

test('native offline filename stays deterministic for the same media identity', () => {
  const media = {
    mediaId: 'movie:550',
    kind: 'movie' as const,
    title: 'Fight Club',
  };

  expect(nativeDownloadFileName(source, 'Fight Club', media)).toBe(
    nativeDownloadFileName(source, 'Fight Club', media),
  );
});

test('downloads without a media id retain the legacy filename shape', () => {
  expect(nativeDownloadFileName(source, 'Movie')).toBe(
    'Movie - 1080p - provider-a.mp4',
  );
});


test('native offline filename generation bounds untrusted metadata before processing', () => {
  const hostile: StreamSource = {
    ...source,
    name: 'N'.repeat(20_000),
    quality: 'Q'.repeat(20_000),
    providerId: 'P'.repeat(20_000),
    language: 'L'.repeat(20_000),
  };

  const fileName = nativeDownloadFileName(
    hostile,
    'T'.repeat(20_000),
    {
      mediaId: 'M'.repeat(20_000),
      kind: 'movie',
      title: 'Title',
    },
  );

  expect(fileName.length).toBeLessThanOrEqual(220);
  expect(fileName).toMatch(/\.mp4$/);
  expect(fileName).not.toContain('TTTT');
  expect(fileName).not.toContain('MMMM');
});


test('native offline filename generation does not parse oversized source URLs', () => {
  const fileName = nativeDownloadFileName({
    ...source,
    url: `https://cdn.example/${'x'.repeat(20_000)}.mkv`,
    name: undefined,
  });

  expect(fileName).toBe('movie.mp4');
});


test('native download filenames prefer explicit transport filename extensions', () => {
  const fileName = nativeDownloadFileName({
    ...source,
    url: 'https://cdn.example/play?id=opaque',
    filename: 'Movie.Release.mkv',
    name: 'Provider display title.mp4',
  }, 'Episode');

  expect(fileName).toMatch(/\.mkv$/);
});


test('native download filenames preserve nested proxy file extensions', () => {
  expect(nativeDownloadFileName({
    ...source,
    url: 'https://proxy.example/play?url=https%3A%2F%2Fcdn.example%2Fmovie.mp4%3Ftoken%3Dtemporary',
  }, 'Movie')).toMatch(/\.mp4$/);
});

test('uses MIME metadata for opaque native download extensions', () => {
  expect(nativeDownloadFileName({
    ...source,
    url: 'https://cdn.example/play?id=opaque-webm',
    contentType: 'video/webm',
  }, 'Movie')).toMatch(/\.webm$/);

  expect(nativeDownloadFileName({
    ...source,
    url: 'https://cdn.example/play?id=opaque-m4v',
    contentType: 'video/x-m4v',
  }, 'Movie')).toMatch(/\.m4v$/);

  expect(nativeDownloadFileName({
    ...source,
    url: 'https://cdn.example/play?id=opaque-mov',
    contentType: 'video/quicktime',
  }, 'Movie')).toMatch(/\.mov$/);
});

test('native offline filenames never expose opaque signed path tokens', () => {
  for (const url of [
    'https://cdn.example/a94f2c8e7d1b4a6c9e0f123456789abc.mp4',
    'https://cdn.example/AbCdEfGhIjKlMnOpQrStUvWx12345678.mp4',
    'https://cdn.example/550e8400-e29b-41d4-a716-446655440000.mp4',
  ]) {
    const fileName = nativeDownloadFileName({
      id: 'opaque-source',
      url,
    });

    expect(fileName).toBe('movie.mp4');
    expect(fileName).not.toContain(url.split('/').at(-1)!.slice(0, -4));
  }
});

test('native offline filenames can still use an ordinary direct-file basename', () => {
  expect(nativeDownloadFileName({
    id: 'ordinary-source',
    url: 'https://cdn.example/Movie.Release.2026.mp4',
  })).toBe('Movie.Release.2026.mp4');
});


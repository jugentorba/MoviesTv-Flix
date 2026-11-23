import type { StreamSource } from '@moviestv/core';
import { webDownloadFileName } from '../downloadSource.web';

const source = (overrides: Partial<StreamSource> = {}): StreamSource => ({
  id: 'source',
  url: 'https://cdn.example/play?id=opaque',
  ...overrides,
});

test('web download filenames preserve opaque direct-file MIME containers', () => {
  expect(webDownloadFileName(
    source({ contentType: 'video/webm' }),
    'Movie',
  )).toBe('Movie.webm');

  expect(webDownloadFileName(
    source({ contentType: 'video/x-m4v' }),
    'Movie',
  )).toBe('Movie.m4v');

  expect(webDownloadFileName(
    source({ contentType: 'video/quicktime' }),
    'Movie',
  )).toBe('Movie.mov');
});

test('web download filenames preserve nested proxy file extensions', () => {
  expect(webDownloadFileName(
    source({
      url: 'https://proxy.example/play?source=https%3A%2F%2Fcdn.example%2Fmovie.webm%3Ftoken%3Dtemporary',
    }),
    'Movie',
  )).toBe('Movie.webm');
});

test('explicit transport filenames still outrank MIME hints', () => {
  expect(webDownloadFileName(
    source({
      filename: 'Release.mp4',
      contentType: 'video/webm',
    }),
    'Movie',
  )).toBe('Movie.mp4');
});

test('web download filenames never expose opaque signed path tokens', () => {
  for (const url of [
    'https://cdn.example/a94f2c8e7d1b4a6c9e0f123456789abc.mp4',
    'https://cdn.example/AbCdEfGhIjKlMnOpQrStUvWx12345678.mp4',
    'https://cdn.example/550e8400-e29b-41d4-a716-446655440000.mp4',
  ]) {
    const fileName = webDownloadFileName(source({ url }));

    expect(fileName).toBe('MoviesTv-Flix-download.mp4');
    expect(fileName).not.toContain(url.split('/').at(-1)!.slice(0, -4));
  }
});

test('web download filenames can still use an ordinary direct-file basename', () => {
  expect(webDownloadFileName(source({
    url: 'https://cdn.example/Movie.Release.2026.mp4',
  }))).toBe('Movie.Release.2026.mp4');
});


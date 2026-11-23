import type { StreamSource } from '@moviestv/core';
import {
  buildOfflineDownloadMetadata,
  canReadOfflineMetadataFile,
  offlineEpisodeCode,
  offlineMetadataFileName,
  offlineMetadataMatchesFile,
  parseOfflineDownloadMetadata,
} from '../offlineDownloadMetadata';

test('builds safe offline metadata without stream URL or request headers', () => {
  const source: StreamSource = {
    id: 'stream-1',
    url: 'https://cdn.example/secret/movie.mp4',
    providerId: 'provider-a',
    quality: '1080p',
    audioLanguages: ['fr', 'en'],
    sizeBytes: 1_000_000,
    headers: { Authorization: 'Bearer runtime-only' },
  };

  const metadata = buildOfflineDownloadMetadata(
    'Movie - 1080p.mp4',
    source,
    {
      mediaId: 'movie:1',
      kind: 'movie',
      title: 'Movie',
      year: 2026,
      externalIds: { imdb: 'tt1234567' },
    },
    '2026-09-19T18:00:00.000Z',
  );

  expect(metadata).toMatchObject({
    schemaVersion: 1,
    fileName: 'Movie - 1080p.mp4',
    title: 'Movie',
    kind: 'movie',
    providerId: 'provider-a',
    quality: '1080p',
    audioLanguage: 'fr',
    year: 2026,
  });
  expect(JSON.stringify(metadata)).not.toContain('cdn.example');
  expect(JSON.stringify(metadata)).not.toContain('Bearer');
});

test('round-trips valid metadata and rejects malformed sidecars', () => {
  const value = JSON.stringify({
    schemaVersion: 1,
    fileName: 'Movie.mp4',
    title: 'Movie',
    downloadedAt: '2026-09-19T18:00:00.000Z',
  });

  expect(parseOfflineDownloadMetadata(value)?.title).toBe('Movie');
  expect(parseOfflineDownloadMetadata('{"schemaVersion":2}')).toBeNull();
  expect(offlineMetadataFileName('Movie.mp4')).toBe('Movie.mp4.moviestv.json');
});


test('preserves parent series identity for catalog-native episode downloads', () => {
  const metadata = buildOfflineDownloadMetadata(
    'Pilot.mp4',
    { id: 'source', url: 'https://cdn.example/pilot.mp4' },
    {
      mediaId: 'custom:show-42:1:1',
      kind: 'episode',
      title: 'Native Series · S1E1 · Pilot',
      externalIds: {},
      seriesId: 'stremio-custom:series:custom%3Ashow-42',
      seasonNumber: 1,
      episodeNumber: 1,
    },
    '2026-09-23T08:00:00.000Z',
  );

  expect(metadata.seriesId).toBe(
    'stremio-custom:series:custom%3Ashow-42',
  );

  expect(parseOfflineDownloadMetadata(
    JSON.stringify(metadata),
  )?.seriesId).toBe(
    'stremio-custom:series:custom%3Ashow-42',
  );
});

test('preserves season zero while rejecting episode zero coordinates', () => {
  const metadata = buildOfflineDownloadMetadata(
    'Pilot.mp4',
    { id: 'source', url: 'https://cdn.example/pilot.mp4' },
    { kind: 'episode', title: 'Pilot', seasonNumber: 0, episodeNumber: 0 },
    '2026-09-21T08:00:00.000Z',
  );
  expect(metadata.seasonNumber).toBe(0);
  expect(metadata.episodeNumber).toBeUndefined();

  const special = buildOfflineDownloadMetadata(
    'Special.mp4',
    { id: 'source', url: 'https://cdn.example/special.mp4' },
    { kind: 'episode', title: 'Special', seasonNumber: 0, episodeNumber: 1 },
    '2026-09-21T08:00:00.000Z',
  );
  expect(special.seasonNumber).toBe(0);
  expect(special.episodeNumber).toBe(1);
});

test('rejects unsafe filenames and invalid optional sidecar fields', () => {
  const base = {
    schemaVersion: 1,
    fileName: 'Movie.mp4',
    title: 'Movie',
    downloadedAt: '2026-09-21T08:00:00.000Z',
  };
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, fileName: '../Movie.mp4' }))).toBeNull();
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, kind: 'live' }))).toBeNull();
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, episodeNumber: -1 }))).toBeNull();
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, sourceSizeBytes: 0 }))).toBeNull();
});


test('rejects Windows-style traversal and malformed optional metadata', () => {
  const base = {
    schemaVersion: 1,
    fileName: 'Movie.mp4',
    title: 'Movie',
    downloadedAt: '2026-09-21T08:00:00.000Z',
  };
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, fileName: '..\\Movie.mp4' }))).toBeNull();
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, providerId: 42 }))).toBeNull();
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, externalIds: [] }))).toBeNull();
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, externalIds: { imdb: 'tt1', evil: 'x' } }))).toBeNull();
});


test('trims safe optional metadata and external ids', () => {
  const parsed = parseOfflineDownloadMetadata(JSON.stringify({
    schemaVersion: 1,
    fileName: ' Movie.mp4 ',
    title: ' Movie ',
    downloadedAt: '2026-09-21T08:00:00.000Z',
    mediaId: ' movie:1 ',
    providerId: ' provider-a ',
    quality: ' 1080p ',
    audioLanguage: ' fr ',
    externalIds: { imdb: ' tt123 ', tmdb: ' 456 ' },
  }));
  expect(parsed).toMatchObject({
    fileName: 'Movie.mp4',
    title: 'Movie',
    mediaId: 'movie:1',
    providerId: 'provider-a',
    quality: '1080p',
    audioLanguage: 'fr',
    externalIds: { imdb: 'tt123', tmdb: '456' },
  });
});


test('rejects unsafe metadata creation filenames and timestamps', () => {
  const source = { id: 's', url: 'https://cdn.example/movie.mp4' } as StreamSource;
  expect(() => buildOfflineDownloadMetadata('../Movie.mp4', source, undefined, '2026-09-21T08:00:00.000Z')).toThrow();
  expect(() => buildOfflineDownloadMetadata('Movie.mp4', source, undefined, 'not-a-date')).toThrow();
  expect(() => offlineMetadataFileName('..\\Movie.mp4')).toThrow();
});

test('rejects insecure poster metadata and oversized optional strings', () => {
  const base = { schemaVersion: 1, fileName: 'Movie.mp4', title: 'Movie', downloadedAt: '2026-09-21T08:00:00.000Z' };
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, posterUrl: 'http://example.com/poster.jpg' }))).toBeNull();
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, providerId: 'x'.repeat(3000) }))).toBeNull();
});


test('falls back when an offline title sanitizes to empty', () => {
  const metadata = buildOfflineDownloadMetadata('movie.mp4', { id: 's', url: 'https://example.com/movie.mp4', name: '\u0001' }, { title: '\u0002' }, '2026-09-21T10:00:00+02:00');
  expect(metadata.title).toBe('MoviesTv-Flix');
  expect(metadata.downloadedAt).toBe('2026-09-21T08:00:00.000Z');
});

test('omits unsafe optional offline metadata strings', () => {
  const metadata = buildOfflineDownloadMetadata('movie.mp4', {
    id: 's', url: 'https://example.com/movie.mp4', providerId: 'bad\u0001provider', quality: 'bad\u0001quality',
  }, { mediaId: 'bad\u0001media', title: 'Movie', externalIds: { imdb: 'bad\u0001id' } }, '2026-09-21T08:00:00.000Z');
  expect(metadata.mediaId).toBeUndefined();
  expect(metadata.providerId).toBeUndefined();
  expect(metadata.quality).toBeUndefined();
  expect(metadata.externalIds).toBeUndefined();
});


test('rejects oversized filenames consistently', () => {
  const source = { id: 's', url: 'https://example.com/movie.mp4' } as StreamSource;
  const name = 'x'.repeat(256);
  expect(() => buildOfflineDownloadMetadata(name, source, undefined, '2026-09-21T08:00:00.000Z')).toThrow();
  expect(() => offlineMetadataFileName(name)).toThrow();
});

test('rejects credentialed artwork and tightly bounds identifiers', () => {
  const base = { schemaVersion: 1, fileName: 'Movie.mp4', title: 'Movie', downloadedAt: '2026-09-21T08:00:00.000Z' };
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, posterUrl: 'https://user:pass@example.com/poster.jpg' }))).toBeNull();
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, externalIds: { imdb: 'x'.repeat(129) } }))).toBeNull();
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, quality: 'x'.repeat(129) }))).toBeNull();
});


test('rejects implausible offline metadata coordinates and sizes', () => {
  const base = { schemaVersion: 1, fileName: 'Movie.mp4', title: 'Movie', downloadedAt: '2026-09-21T08:00:00.000Z' };
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, year: 1500 }))).toBeNull();
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, seasonNumber: 10001 }))).toBeNull();
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, episodeNumber: 100001 }))).toBeNull();
  expect(parseOfflineDownloadMetadata(JSON.stringify({ ...base, sourceSizeBytes: 1.5 }))).toBeNull();
});


test('offline metadata belongs only to the video filename it declares', () => {
  const metadata = parseOfflineDownloadMetadata(JSON.stringify({
    schemaVersion: 1,
    fileName: 'Movie.mp4',
    title: 'Movie',
    downloadedAt: '2026-09-21T08:00:00.000Z',
    mediaId: 'movie:1',
  }));

  expect(offlineMetadataMatchesFile(metadata, 'Movie.mp4')).toBe(true);
  expect(offlineMetadataMatchesFile(metadata, 'Other.mp4')).toBe(false);
  expect(offlineMetadataMatchesFile(null, 'Movie.mp4')).toBe(false);
});


test('formats season zero specials but rejects episode zero', () => {
  expect(offlineEpisodeCode({
    seasonNumber: 0,
    episodeNumber: 1,
  })).toBe('S0E1');
  expect(offlineEpisodeCode({
    seasonNumber: 0,
    episodeNumber: 0,
  })).toBeUndefined();
  expect(offlineEpisodeCode({
    seasonNumber: 1,
    episodeNumber: 2,
  })).toBe('S1E2');
  expect(offlineEpisodeCode({
    seasonNumber: undefined,
    episodeNumber: 2,
  })).toBeUndefined();
});


test('offline sidecar filename includes its suffix within the filesystem limit', () => {
  const maxBaseLength = 255 - '.moviestv.json'.length;
  expect(
    offlineMetadataFileName('x'.repeat(maxBaseLength)),
  ).toHaveLength(255);
  expect(() => (
    offlineMetadataFileName('x'.repeat(maxBaseLength + 1))
  )).toThrow();
});


test('rejects oversized offline sidecar JSON before parsing', () => {
  expect(parseOfflineDownloadMetadata(
    'x'.repeat(65_537),
  )).toBeNull();
});

test('requires canonical IMDb and TMDB identifiers in offline sidecars', () => {
  const base = {
    schemaVersion: 1,
    fileName: 'Movie.mp4',
    title: 'Movie',
    downloadedAt: '2026-09-21T08:00:00.000Z',
  };

  expect(parseOfflineDownloadMetadata(JSON.stringify({
    ...base,
    externalIds: { imdb: 'not-imdb' },
  }))).toBeNull();

  expect(parseOfflineDownloadMetadata(JSON.stringify({
    ...base,
    externalIds: { tmdb: '12a' },
  }))).toBeNull();

  expect(parseOfflineDownloadMetadata(JSON.stringify({
    ...base,
    externalIds: { imdb: 'tt1234567', tmdb: '550' },
  }))).toEqual(expect.objectContaining({
    externalIds: { imdb: 'tt1234567', tmdb: '550' },
  }));
});


test('bounds offline artwork URLs during creation and parsing', () => {
  const source = {
    id: 'source',
    url: 'https://cdn.example/movie.mp4',
  } as StreamSource;
  const expandedPoster = `https://images.example/${'é'.repeat(700)}.jpg`;
  const oversizedPoster = `https://images.example/${'x'.repeat(2_100)}.jpg`;

  const metadata = buildOfflineDownloadMetadata(
    'Movie.mp4',
    source,
    {
      title: 'Movie',
      posterUrl: oversizedPoster,
    },
    '2026-09-22T10:00:00.000Z',
  );
  expect(metadata.posterUrl).toBeUndefined();

  const base = {
    schemaVersion: 1,
    fileName: 'Movie.mp4',
    title: 'Movie',
    downloadedAt: '2026-09-22T10:00:00.000Z',
  };
  expect(parseOfflineDownloadMetadata(JSON.stringify({
    ...base,
    posterUrl: expandedPoster,
  }))).toBeNull();
});


test('offline metadata never persists credential-bearing artwork URLs', () => {
  const source = {
    id: 'source',
    url: 'https://cdn.example/movie.mp4',
  } as StreamSource;
  const signedPoster =
    'https://images.example/poster.jpg?token=LOCAL-SECRET';

  const metadata = buildOfflineDownloadMetadata(
    'Movie.mp4',
    source,
    {
      title: 'Movie',
      posterUrl: signedPoster,
    },
    '2026-09-22T10:00:00.000Z',
  );
  expect(metadata.posterUrl).toBeUndefined();

  const base = {
    schemaVersion: 1,
    fileName: 'Movie.mp4',
    title: 'Movie',
    downloadedAt: '2026-09-22T10:00:00.000Z',
  };
  expect(parseOfflineDownloadMetadata(JSON.stringify({
    ...base,
    posterUrl: signedPoster,
  }))).toBeNull();

  const fragmentPoster =
    'https://images.example/poster.jpg#signature=LOCAL-SECRET';
  expect(buildOfflineDownloadMetadata(
    'Movie.mp4',
    source,
    {
      title: 'Movie',
      posterUrl: fragmentPoster,
    },
    '2026-09-22T10:00:00.000Z',
  ).posterUrl).toBeUndefined();
  expect(parseOfflineDownloadMetadata(JSON.stringify({
    ...base,
    posterUrl: fragmentPoster,
  }))).toBeNull();

  const pathPoster =
    'https://images.example/token=LOCAL-SECRET/poster.jpg';
  expect(buildOfflineDownloadMetadata(
    'Movie.mp4',
    source,
    {
      title: 'Movie',
      posterUrl: pathPoster,
    },
    '2026-09-22T10:00:00.000Z',
  ).posterUrl).toBeUndefined();
  expect(parseOfflineDownloadMetadata(JSON.stringify({
    ...base,
    posterUrl: pathPoster,
  }))).toBeNull();

  for (const opaquePoster of [
    'https://images.example/a94f2c8e7d1b4a6c9e0f123456789abc/poster.jpg',
    'https://images.example/AbCdEfGhIjKlMnOpQrStUvWx12345678/poster.jpg',
    'https://images.example/550e8400-e29b-41d4-a716-446655440000/poster.jpg',
  ]) {
    expect(buildOfflineDownloadMetadata(
      'Movie.mp4',
      source,
      {
        title: 'Movie',
        posterUrl: opaquePoster,
      },
      '2026-09-22T10:00:00.000Z',
    ).posterUrl).toBeUndefined();
    expect(parseOfflineDownloadMetadata(JSON.stringify({
      ...base,
      posterUrl: opaquePoster,
    }))).toBeNull();
  }

  const ordinaryPoster =
    'https://images.example/secret-garden/poster.jpg';
  expect(buildOfflineDownloadMetadata(
    'Movie.mp4',
    source,
    {
      title: 'Movie',
      posterUrl: ordinaryPoster,
    },
    '2026-09-22T10:00:00.000Z',
  ).posterUrl).toBe(ordinaryPoster);
});


test('bounds native offline sidecar reads before loading text into memory', () => {
  expect(canReadOfflineMetadataFile(0)).toBe(true);
  expect(canReadOfflineMetadataFile(65_536)).toBe(true);
  expect(canReadOfflineMetadataFile(65_537)).toBe(false);
  expect(canReadOfflineMetadataFile(null)).toBe(false);
  expect(canReadOfflineMetadataFile(undefined)).toBe(false);
  expect(canReadOfflineMetadataFile(Number.NaN)).toBe(false);
});

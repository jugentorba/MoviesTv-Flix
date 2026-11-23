import {
  parseStremioManifest,
  toStremioStreamRequests,
  toStremioSubtitleRequests,
} from '../index';

const tmdbDescriptor = parseStremioManifest({
  id: 'org.example.tmdb',
  name: 'TMDB provider',
  version: '1.0.0',
  types: ['movie', 'series'],
  resources: [
    { name: 'stream', types: ['series'], idPrefixes: ['tmdb:'] },
    { name: 'subtitles', types: ['series'], idPrefixes: ['tmdb:'] },
  ],
}, 'https://provider.example/manifest.json');

const imdbDescriptor = parseStremioManifest({
  id: 'org.example.imdb',
  name: 'IMDb provider',
  version: '1.0.0',
  types: ['series'],
  resources: [
    { name: 'stream', types: ['series'], idPrefixes: ['tt'] },
  ],
}, 'https://provider.example/manifest.json');

describe('episode parent-series identifier inference', () => {
  test('infers TMDB series IDs from seriesMediaId when externalIds are empty', () => {
    const request = {
      mediaId: 'episode:provider-specific:1',
      seriesMediaId: 'tmdb:series:1399',
      kind: 'episode' as const,
      externalIds: {},
      seasonNumber: 2,
      episodeNumber: 3,
    };

    expect(
      toStremioStreamRequests(tmdbDescriptor, request).map(({ id }) => id),
    ).toEqual([
      'tmdb:1399:2:3',
      'tmdb:series:1399:2:3',
    ]);
    expect(
      toStremioSubtitleRequests(tmdbDescriptor, request).map(({ id }) => id),
    ).toEqual([
      'tmdb:1399:2:3',
      'tmdb:series:1399:2:3',
    ]);
  });

  test('infers IMDb series IDs from seriesMediaId when externalIds are empty', () => {
    const requests = toStremioStreamRequests(imdbDescriptor, {
      mediaId: 'episode:provider-specific:1',
      seriesMediaId: 'stremio-catalog:series:tt0944947',
      kind: 'episode',
      externalIds: {},
      seasonNumber: 1,
      episodeNumber: 4,
    });

    expect(requests.map(({ id }) => id)).toEqual([
      'tt0944947:1:4',
    ]);
  });

  test('normalizes qualified external IDs before building episode routes', () => {
    const requests = toStremioStreamRequests(tmdbDescriptor, {
      mediaId: 'episode:provider-specific:1',
      seriesMediaId: 'series:provider-specific',
      kind: 'episode',
      externalIds: {
        imdb: 'imdb:tt0944947',
        tmdb: 'tmdb:series:1399',
      },
      seasonNumber: 3,
      episodeNumber: 5,
    });

    expect(requests.map(({ id }) => id)).toEqual([
      'tmdb:1399:3:5',
      'tmdb:series:1399:3:5',
    ]);
  });

  test('explicit external IDs still take precedence over canonical parent IDs', () => {
    const requests = toStremioStreamRequests(tmdbDescriptor, {
      mediaId: 'episode:provider-specific:1',
      seriesMediaId: 'tmdb:series:1399',
      kind: 'episode',
      externalIds: { tmdb: '66732' },
      seasonNumber: 1,
      episodeNumber: 2,
    });

    expect(requests[0]?.id).toBe('tmdb:66732:1:2');
  });
});

import type { CatalogMediaItem, CatalogSection, MediaDetails, SeriesSeason } from '@moviestv/catalog';

export const demoItems: CatalogMediaItem[] = [
  {
    id: 'demo:movie:orbit-city',
    kind: 'movie',
    title: 'Orbit City',
    originalTitle: 'Orbit City',
    overview: 'A rescue pilot crosses a failing orbital colony before its final evacuation window closes.',
    year: 2025,
    rating: 8.1,
    genres: ['Science Fiction', 'Adventure'],
    providerId: 'demo',
    externalIds: {},
  },
  {
    id: 'demo:series:beyond-orbit',
    kind: 'series',
    title: 'Beyond Orbit',
    overview: 'A research crew maps the edge of inhabited space while old signals begin answering back.',
    year: 2024,
    rating: 8.4,
    genres: ['Science Fiction', 'Drama'],
    providerId: 'demo',
    externalIds: {},
  },
  {
    id: 'demo:movie:midnight-runway',
    kind: 'movie',
    title: 'Midnight Runway',
    overview: 'An overnight courier uncovers a conspiracy hidden inside a routine airport transfer.',
    year: 2023,
    rating: 7.6,
    genres: ['Thriller'],
    providerId: 'demo',
    externalIds: {},
  },
  {
    id: 'demo:series:harbor-nine',
    kind: 'series',
    title: 'Harbor Nine',
    overview: 'A coastal emergency unit solves cases that arrive with the tide.',
    year: 2025,
    rating: 7.9,
    genres: ['Drama', 'Mystery'],
    providerId: 'demo',
    externalIds: {},
  },
  {
    id: 'demo:movie:glass-signal',
    kind: 'movie',
    title: 'Glass Signal',
    overview: 'A radio engineer discovers a repeating transmission that predicts accidents hours before they happen.',
    year: 2022,
    rating: 7.4,
    genres: ['Mystery', 'Science Fiction'],
    providerId: 'demo',
    externalIds: {},
  },
  {
    id: 'demo:series:northline',
    kind: 'series',
    title: 'Northline',
    overview: 'A railway crew keeps a remote winter route alive through storms, shortages and secrets.',
    year: 2023,
    rating: 8.0,
    genres: ['Drama'],
    providerId: 'demo',
    externalIds: {},
  },
];

export const demoSeasons: SeriesSeason[] = [
  {
    seriesId: 'demo:series:beyond-orbit',
    seasonNumber: 1,
    name: 'Season 1',
    episodes: [
      {
        id: 'demo:episode:beyond-orbit:1:1',
        seriesId: 'demo:series:beyond-orbit',
        seasonNumber: 1,
        episodeNumber: 1,
        title: 'First Contact',
        overview: 'The crew reaches the first silent relay and receives an impossible reply.',
        runtimeMinutes: 48,
      },
      {
        id: 'demo:episode:beyond-orbit:1:2',
        seriesId: 'demo:series:beyond-orbit',
        seasonNumber: 1,
        episodeNumber: 2,
        title: 'Echo Line',
        overview: 'A second signal forces the crew to decide whether the source is following them.',
        runtimeMinutes: 51,
      },
    ],
  },
];

export const demoDetails: MediaDetails[] = demoItems.map((item) => {
  const seasons = item.kind === 'series'
    ? demoSeasons.filter((season) => season.seriesId === item.id)
    : [];
  const seasonSummaries = seasons.map((season) => ({
    id: `demo:season:${item.id.split(':').at(-1)}:${season.seasonNumber}`,
    seasonNumber: season.seasonNumber,
    name: season.name ?? `Season ${season.seasonNumber}`,
    episodeCount: season.episodes.length,
  }));
  return {
    ...item,
    runtimeMinutes: item.kind === 'movie' ? 118 : undefined,
    seasonCount: seasonSummaries.length || undefined,
    episodeCount: seasons.length
      ? seasons.reduce((total, season) => total + season.episodes.length, 0)
      : undefined,
    seasons: seasonSummaries.length ? seasonSummaries : undefined,
    cast: ['Alex Rowan', 'Mira Vale', 'Jon Mercer'],
    certification: 'PG-13',
  };
});

export const demoSections: CatalogSection[] = [
  { id: 'home:trending-movies', title: 'Trending Movies', kinds: ['movie'] },
  { id: 'home:trending-series', title: 'Trending Series', kinds: ['series'] },
  { id: 'movies:popular', title: 'Popular Movies', kinds: ['movie'] },
  { id: 'movies:top-rated', title: 'Top Rated Movies', kinds: ['movie'] },
  { id: 'series:popular', title: 'Popular Series', kinds: ['series'] },
  { id: 'series:top-rated', title: 'Top Rated Series', kinds: ['series'] },
];

export function demoItemsForSection(sectionId: string): CatalogMediaItem[] {
  const section = demoSections.find((entry) => entry.id === sectionId);
  if (!section) return [];
  return demoItems.filter((item) => section.kinds.includes(item.kind));
}

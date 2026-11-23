import {
  normalizeTmdbDetails,
  normalizeTmdbSeason,
} from '../../../../supabase/functions/catalog/normalize';

describe('TMDB series season normalization', () => {
  it('keeps season zero specials and positive-numbered season summaries', () => {
    const details = normalizeTmdbDetails({
      id: 1399,
      name: 'Game of Thrones',
      seasons: [
        { id: 3627, season_number: 0, name: 'Specials', episode_count: 11 },
        { id: 3624, season_number: 1, name: 'Season 1', episode_count: 10, air_date: '2011-04-17', poster_path: '/s1.jpg' },
        { id: 9999, season_number: -1, name: 'Invalid', episode_count: 2 },
      ],
    }, 'series');

    expect(details?.seasons).toEqual([
      {
        id: 'tmdb:season:3627',
        seasonNumber: 0,
        name: 'Specials',
        episodeCount: 11,
      },
      {
        id: 'tmdb:season:3624',
        seasonNumber: 1,
        name: 'Season 1',
        episodeCount: 10,
        airDate: '2011-04-17',
        posterUrl: 'https://image.tmdb.org/t/p/w500/s1.jpg',
      },
    ]);
  });

  it('normalizes only real episodes with stable TMDB IDs and positive episode numbers', () => {
    const season = normalizeTmdbSeason({
      id: 3624,
      name: 'Season 1',
      air_date: '2011-04-17',
      poster_path: '/s1.jpg',
      episodes: [
        {
          id: 63056,
          episode_number: 1,
          name: 'Winter Is Coming',
          overview: 'The Stark family is drawn into the politics of the realm.',
          air_date: '2011-04-17',
          runtime: 62,
          still_path: '/e1.jpg',
          vote_average: 8.2,
        },
        { id: 63057, episode_number: 0, name: 'Invalid zero' },
        { episode_number: 2, name: 'Missing TMDB id' },
      ],
    }, 'tmdb:series:1399', 1);

    expect(season).toEqual({
      seriesId: 'tmdb:series:1399',
      seasonNumber: 1,
      name: 'Season 1',
      airDate: '2011-04-17',
      posterUrl: 'https://image.tmdb.org/t/p/w500/s1.jpg',
      episodes: [{
        id: 'tmdb:episode:63056',
        seriesId: 'tmdb:series:1399',
        seasonNumber: 1,
        episodeNumber: 1,
        title: 'Winter Is Coming',
        overview: 'The Stark family is drawn into the politics of the realm.',
        airDate: '2011-04-17',
        runtimeMinutes: 62,
        stillUrl: 'https://image.tmdb.org/t/p/w500/e1.jpg',
        rating: 8.2,
      }],
    });
  });
});


  it('normalizes episodes from season zero specials', () => {
    const season = normalizeTmdbSeason({
      id: 3627,
      name: 'Specials',
      episodes: [{
        id: 90001,
        episode_number: 1,
        name: 'Special One',
      }],
    }, 'tmdb:series:1399', 0);

    expect(season).toEqual(expect.objectContaining({
      seriesId: 'tmdb:series:1399',
      seasonNumber: 0,
      name: 'Specials',
      episodes: [
        expect.objectContaining({
          id: 'tmdb:episode:90001',
          seasonNumber: 0,
          episodeNumber: 1,
          title: 'Special One',
        }),
      ],
    }));
  });

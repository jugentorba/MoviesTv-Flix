import type { StreamSource } from '@moviestv/core';
import * as addons from '../index';

type Request = {
  mediaId: string;
  kind: 'movie' | 'series' | 'episode';
  externalIds: { tmdb?: string; imdb?: string };
  seasonNumber?: number;
  episodeNumber?: number;
  seriesMediaId?: string;
};

describe('normalized add-on media contracts', () => {
  it('accepts a movie request with an external identifier', () => {
    const isAddonMediaRequest = (addons as any).isAddonMediaRequest as undefined | ((value: unknown) => boolean);
    const movie: Request = {
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: { tmdb: '550', imdb: 'tt0137523' },
    };

    expect(isAddonMediaRequest).toBeDefined();
    expect(isAddonMediaRequest?.(movie)).toBe(true);
  });

  it('requires season and episode context for episode requests', () => {
    const isAddonMediaRequest = (addons as any).isAddonMediaRequest as undefined | ((value: unknown) => boolean);
    const episode: Request = {
      mediaId: 'tmdb:series:1399',
      kind: 'episode',
      externalIds: { tmdb: '1399', imdb: 'tt0944947' },
      seasonNumber: 1,
      episodeNumber: 2,
    };

    expect(isAddonMediaRequest).toBeDefined();
    expect(isAddonMediaRequest?.(episode)).toBe(true);
    expect(isAddonMediaRequest?.({ ...episode, episodeNumber: undefined })).toBe(false);
    expect(isAddonMediaRequest?.({ ...episode, seasonNumber: 0 })).toBe(true);
    expect(isAddonMediaRequest?.({ ...episode, seasonNumber: -1 })).toBe(false);
  });

  it('accepts catalog-native movie and episode identities without IMDb/TMDB IDs', () => {
    const isAddonMediaRequest = (addons as any).isAddonMediaRequest as undefined | ((value: unknown) => boolean);
    expect(isAddonMediaRequest).toBeDefined();

    expect(isAddonMediaRequest?.({
      mediaId: 'stremio-catalog:movie:custom%3A42',
      kind: 'movie',
      externalIds: {},
    })).toBe(true);

    expect(isAddonMediaRequest?.({
      mediaId: 'custom:episode:1',
      seriesMediaId: 'stremio-catalog:series:show%3A42',
      kind: 'episode',
      externalIds: {},
      seasonNumber: 1,
      episodeNumber: 2,
    })).toBe(true);

    expect(isAddonMediaRequest?.({
      mediaId: 'local:movie:one',
      kind: 'movie',
      externalIds: {},
    })).toBe(false);

    expect(isAddonMediaRequest?.({
      mediaId: 'custom:episode:1',
      kind: 'episode',
      externalIds: {},
      seasonNumber: 1,
      episodeNumber: 2,
    })).toBe(false);
  });

  it('rejects malformed or unexpected external IDs on native catalog requests', () => {
    const isAddonMediaRequest = (addons as any).isAddonMediaRequest as
      undefined | ((value: unknown) => boolean);

    expect(isAddonMediaRequest?.({
      mediaId: 'stremio-native:movie:custom%3A42',
      kind: 'movie',
      externalIds: { imdb: 'not-imdb' },
    })).toBe(false);
    expect(isAddonMediaRequest?.({
      mediaId: 'stremio-native:movie:custom%3A42',
      kind: 'movie',
      externalIds: { evil: 'value' },
    })).toBe(false);
    expect(isAddonMediaRequest?.({
      mediaId: 'stremio-native:movie:custom%3A42',
      kind: 'movie',
      externalIds: {},
    })).toBe(true);
    expect(isAddonMediaRequest?.({
      mediaId: 'stremio-native:movie:%E0%A4%A',
      kind: 'movie',
      externalIds: {},
    })).toBe(false);
    expect(isAddonMediaRequest?.({
      mediaId: 'custom:episode:1',
      seriesMediaId: 'local:series:custom%3Ashow-42',
      kind: 'episode',
      externalIds: {},
      seasonNumber: 1,
      episodeNumber: 2,
    })).toBe(false);
  });

  it('accepts qualified IMDb and TMDB external identifier forms', () => {
    const isAddonMediaRequest = (addons as any).isAddonMediaRequest as
      undefined | ((value: unknown) => boolean);

    expect(isAddonMediaRequest?.({
      mediaId: 'movie:qualified',
      kind: 'movie',
      externalIds: {
        imdb: 'imdb:tt0137523',
        tmdb: 'tmdb:movie:550',
      },
    })).toBe(true);

    expect(isAddonMediaRequest?.({
      mediaId: 'episode:qualified',
      seriesMediaId: 'series:qualified',
      kind: 'episode',
      externalIds: {
        imdb: 'IMDB:TT0944947',
        tmdb: 'TMDB:series:1399',
      },
      seasonNumber: 1,
      episodeNumber: 2,
    })).toBe(true);
  });

  it('rejects malformed IMDb and TMDB playback identifiers', () => {
    const isAddonMediaRequest = (addons as any).isAddonMediaRequest as
      undefined | ((value: unknown) => boolean);

    expect(isAddonMediaRequest?.({
      mediaId: 'movie:1',
      kind: 'movie',
      externalIds: { imdb: 'not-imdb' },
    })).toBe(false);
    expect(isAddonMediaRequest?.({
      mediaId: 'movie:1',
      kind: 'movie',
      externalIds: { tmdb: '12a' },
    })).toBe(false);
    expect(isAddonMediaRequest?.({
      mediaId: 'movie:1',
      kind: 'movie',
      externalIds: { imdb: ' TT1234567 ' },
    })).toBe(true);
  });

  it('rejects oversized, control-character, and unsafe integer request fields', () => {
    const isAddonMediaRequest = (addons as any).isAddonMediaRequest as
      undefined | ((value: unknown) => boolean);
    const base: Request = {
      mediaId: 'tmdb:series:1399',
      kind: 'episode',
      externalIds: { tmdb: '1399', imdb: 'tt0944947' },
      seasonNumber: 1,
      episodeNumber: 2,
    };

    expect(isAddonMediaRequest?.({
      ...base,
      mediaId: 'x'.repeat(2_049),
    })).toBe(false);
    expect(isAddonMediaRequest?.({
      ...base,
      mediaId: 'tmdb:series:1399\u0000bad',
    })).toBe(false);
    expect(isAddonMediaRequest?.({
      ...base,
      externalIds: { imdb: 'x'.repeat(33) },
    })).toBe(false);
    expect(isAddonMediaRequest?.({
      ...base,
      seasonNumber: 10_001,
    })).toBe(false);
    expect(isAddonMediaRequest?.({
      ...base,
      episodeNumber: 100_001,
    })).toBe(false);
    expect(isAddonMediaRequest?.({
      ...base,
      episodeNumber: Number.MAX_SAFE_INTEGER + 1,
    })).toBe(false);
  });

  it('keeps the expanded stream-source metadata assignable', () => {
    const source: StreamSource = {
      id: 'provider:one',
      sourceId: 'one',
      providerId: 'provider',
      name: 'Public domain 1080p',
      url: 'https://cdn.example.com/video.mp4',
      quality: '1080p',
      language: 'en',
      codec: 'h264',
      sizeBytes: 123456,
      headers: { Referer: 'https://example.com/' },
    };

    expect(source.providerId).toBe('provider');
  });
});

import type { ExternalMediaIds, MediaItem } from '@moviestv/core';

export type CatalogMediaKind = 'movie' | 'series';

export interface CatalogMediaItem extends Omit<MediaItem, 'kind'> {
  kind: CatalogMediaKind;
  providerId: string;
  externalIds: ExternalMediaIds;
}

export interface SeriesSeasonSummary {
  id: string;
  seasonNumber: number;
  name: string;
  episodeCount?: number;
  airDate?: string;
  posterUrl?: string;
}

export interface SeriesEpisode {
  id: string;
  seriesId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview?: string;
  airDate?: string;
  runtimeMinutes?: number;
  stillUrl?: string;
  rating?: number;
}

export interface SeriesSeason {
  seriesId: string;
  seasonNumber: number;
  name?: string;
  airDate?: string;
  posterUrl?: string;
  episodes: SeriesEpisode[];
}

export interface MediaDetails extends CatalogMediaItem {
  runtimeMinutes?: number;
  releaseDate?: string;
  seasonCount?: number;
  episodeCount?: number;
  seasons?: SeriesSeasonSummary[];
  cast?: string[];
  certification?: string;
}

export interface CatalogSection {
  id: string;
  title: string;
  kinds: CatalogMediaKind[];
  /**
   * Genres this provider offers for the section, when it declares them.
   * Empty or absent means the provider cannot filter by genre.
   */
  genres?: readonly string[];
}

export interface CatalogPage<T = CatalogMediaItem> {
  items: T[];
  nextCursor?: string;
}

export interface CatalogRequestOptions {
  timeoutMs?: number;
  /** Ask the provider for one genre; ignored when it does not support extras. */
  genre?: string;
}

export interface CatalogGateway {
  readonly id: string;
  getSections(options?: CatalogRequestOptions): Promise<CatalogSection[]>;
  browse(
    sectionId: string,
    cursor?: string,
    options?: CatalogRequestOptions,
  ): Promise<CatalogPage>;
  search(
    query: string,
    cursor?: string,
    options?: CatalogRequestOptions,
  ): Promise<CatalogPage>;
  getDetails(
    mediaId: string,
    options?: CatalogRequestOptions,
  ): Promise<MediaDetails | null>;
  getSeason(
    seriesId: string,
    seasonNumber: number,
    options?: CatalogRequestOptions,
  ): Promise<SeriesSeason | null>;
}

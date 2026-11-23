export type MediaKind = 'movie' | 'series' | 'episode' | 'channel';

export interface ExternalMediaIds {
  tmdb?: string;
  imdb?: string;
}

export interface MediaItem {
  id: string;
  kind: MediaKind;
  title: string;
  originalTitle?: string;
  overview?: string;
  year?: number;
  releaseYear?: number;
  posterUrl?: string;
  backdropUrl?: string;
  rating?: number;
  genres?: string[];
}

export interface Movie extends MediaItem {
  kind: 'movie';
}

export interface Series extends MediaItem {
  kind: 'series';
}

export interface Episode extends MediaItem {
  kind: 'episode';
  seriesId: string;
  seasonNumber: number;
  episodeNumber: number;
}

export interface Channel extends MediaItem {
  kind: 'channel';
  countryCode?: string;
}

export interface PlaybackProgress {
  positionMs: number;
  durationMs: number;
}

export interface StreamSource {
  id: string;
  url: string;
  providerId?: string;
  sourceId?: string;
  name?: string;
  filename?: string;
  quality?: string;
  language?: string;
  codec?: string;
  codecDetail?: string;
  audioCodec?: 'dts' | 'truehd';
  dynamicRange?: 'hdr' | 'dolby-vision';
  contentType?: string;
  sizeBytes?: number;
  headers?: Record<string, string>;
  webReady?: boolean;
  audioLanguages?: string[];
  subtitleLanguages?: string[];
}

export interface SubtitleTrack {
  id: string;
  language: string;
  label?: string;
  url: string;
}

export interface AudioTrack {
  id: string;
  language: string;
  label?: string;
}

export interface EmbeddedSubtitleTrack {
  id: string;
  language: string;
  label?: string;
}

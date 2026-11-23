import type { MediaItem, StreamSource } from '../../core/src';

export interface PlaybackRequest {
  media: MediaItem;
  preferredAudioLanguages: string[];
  source?: StreamSource;
}

export * from './ranking';
export * from './session-controller';

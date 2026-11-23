import { createContext, useContext } from 'react';
import type { MediaDetails, SeriesEpisode } from '@moviestv/catalog';
import type { StreamSource, SubtitleTrack } from '@moviestv/core';
import type { PlaybackSessionState } from '@moviestv/playback';
import type { WatchMediaSnapshot, WatchProgressRecord } from '@moviestv/sync';

export interface PlaybackApi {
  state: Readonly<PlaybackSessionState>;
  selectedSource: StreamSource | null;
  activeMedia: WatchMediaSnapshot | null;
  subtitleTracks: SubtitleTrack[];
  selectedSubtitle: SubtitleTrack | null;
  subtitleLoading: boolean;
  nextEpisode: SeriesEpisode | null;
  nextEpisodeLoading: boolean;
  sourceChooserOpen: boolean;
  subtitleChooserOpen: boolean;
  playMovie(details: MediaDetails): Promise<void>;
  resolveMovieSources(details: MediaDetails): Promise<StreamSource[]>;
  resolveEpisodeSources(series: MediaDetails, episode: SeriesEpisode): Promise<StreamSource[]>;
  playEpisode(series: MediaDetails, episode: SeriesEpisode): Promise<boolean>;
  playNextEpisode(): Promise<boolean>;
  resumeProgress(record: WatchProgressRecord): Promise<boolean>;
  retry(): Promise<void>;
  refreshSources(): Promise<boolean>;
  selectSource(sourceId: string): boolean;
  selectSubtitle(subtitleId: string | null): boolean;
  openSourceChooser(): void;
  closeSourceChooser(): void;
  openSubtitleChooser(): void;
  closeSubtitleChooser(): void;
  closePlayback(): void;
}

export const PlaybackContext = createContext<PlaybackApi | null>(null);

export function usePlayback(): PlaybackApi {
  const context = useContext(PlaybackContext);
  if (!context) throw new Error('usePlayback must be used inside PlaybackProvider');
  return context;
}

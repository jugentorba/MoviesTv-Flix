import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import type { AddonMediaRequest } from '@moviestv/addons';
import type { MediaDetails, SeriesEpisode } from '@moviestv/catalog';
import {
  sameMyListMedia,
  type StreamSource,
  type SubtitleTrack,
} from '@moviestv/core';
import type { WatchMediaSnapshot, WatchProgressRecord } from '@moviestv/sync';
import {
  PlaybackSessionController,
  rankStreamSources,
  type PlaybackSessionState,
  type PlaybackSourceResolver,
} from '@moviestv/playback';
import { useAddons } from '../addons/useAddons';
import { useAccount } from '../auth/useAccount';
import { useCatalog } from '../catalog/useCatalog';
import { usePreferences } from '../preferences/usePreferences';
import { createPlaybackResolver } from './createPlaybackResolver';
import { webEngineSupportsMatroska } from './webContainerSupport';
import {
  createSubtitleResolver,
  type SubtitleSourceResolver,
} from './createSubtitleResolver';
import { PlaybackContext, type PlaybackApi } from './usePlayback';

function seriesTitleFromProgressTitle(
  title: string,
): string | undefined {
  const match = /^(.*?)\s+·\s+S\d+E\d+\s+·\s+/i.exec(title.trim());
  const seriesTitle = match?.[1]?.trim();
  return seriesTitle || undefined;
}

export interface PlaybackProviderProps {
  children: ReactNode;
  resolver?: PlaybackSourceResolver;
  subtitleResolver?: SubtitleSourceResolver;
}

export function PlaybackProvider({
  children,
  resolver,
  subtitleResolver,
}: PlaybackProviderProps) {
  const { installed } = useAddons();
  const { userId } = useAccount();
  const { service: catalogService } = useCatalog();
  const { preferences } = usePreferences();
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;

  const installedResolver = useMemo(() => createPlaybackResolver(installed), [installed]);
  const installedSubtitleResolver = useMemo(
    () => createSubtitleResolver(installed),
    [installed],
  );
  const sourceResolver = resolver ?? installedResolver;
  const activeSubtitleResolver = subtitleResolver ?? installedSubtitleResolver;
  const sourceResolverRef = useRef(sourceResolver);
  const subtitleResolverRef = useRef(activeSubtitleResolver);
  sourceResolverRef.current = sourceResolver;
  subtitleResolverRef.current = activeSubtitleResolver;

  const controllerRef = useRef<PlaybackSessionController | null>(null);
  const controller = controllerRef.current ?? new PlaybackSessionController(
    {
      resolve: (request) => sourceResolverRef.current.resolve(request),
    },
    () => ({
      preferredAudioLanguages: preferencesRef.current.preferredAudioLanguages,
      preferWebCompatible: Platform.OS === 'web',
      webMatroskaSupported: Platform.OS === 'web' && webEngineSupportsMatroska(),
    }),
  );
  if (!controllerRef.current) controllerRef.current = controller;

  const [state, setState] = useState<Readonly<PlaybackSessionState>>(
    () => controller.getState(),
  );
  const [sourceChooserOpen, setSourceChooserOpen] = useState(false);
  const [subtitleChooserOpen, setSubtitleChooserOpen] = useState(false);
  const [activeMedia, setActiveMedia] = useState<WatchMediaSnapshot | null>(null);
  const [activeSeries, setActiveSeries] = useState<MediaDetails | null>(null);
  const [nextEpisode, setNextEpisode] = useState<SeriesEpisode | null>(null);
  const [nextEpisodeLoading, setNextEpisodeLoading] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(null);
  const [subtitleLoading, setSubtitleLoading] = useState(false);
  const subtitleGenerationRef = useRef(0);
  const nextEpisodeGenerationRef = useRef(0);
  const playbackIdentityRef = useRef(userId);

  useEffect(() => {
    setState(controller.getState());
    return controller.subscribe(setState);
  }, [controller]);

  const resolveSubtitles = useCallback(async (request: AddonMediaRequest) => {
    const generation = ++subtitleGenerationRef.current;
    setSubtitleChooserOpen(false);
    setSubtitleTracks([]);
    setSelectedSubtitleId(null);

    if (!preferencesRef.current.subtitlesEnabled) {
      setSubtitleLoading(false);
      return;
    }

    setSubtitleLoading(true);
    try {
      const tracks = await subtitleResolverRef.current.resolve(
        request,
        preferencesRef.current.preferredSubtitleLanguages,
      );
      if (generation !== subtitleGenerationRef.current) return;
      setSubtitleTracks(tracks);
      setSelectedSubtitleId(tracks[0]?.id ?? null);
    } catch {
      // Subtitle providers are optional. A provider failure must never reject
      // the movie/episode playback request or leave the subtitle spinner stuck.
      if (generation === subtitleGenerationRef.current) {
        setSubtitleTracks([]);
        setSelectedSubtitleId(null);
      }
    } finally {
      if (generation === subtitleGenerationRef.current) {
        setSubtitleLoading(false);
      }
    }
  }, []);

  const resolveRequest = useCallback(async (request: AddonMediaRequest) => {
    void resolveSubtitles(request);
    return controller.resolve(request);
  }, [controller, resolveSubtitles]);

  const loadNextEpisode = useCallback(async (
    series: MediaDetails,
    episode: SeriesEpisode,
  ) => {
    const generation = ++nextEpisodeGenerationRef.current;
    setNextEpisode(null);
    setNextEpisodeLoading(true);

    try {
      const currentSeason = await catalogService.getSeason(
        series.id,
        episode.seasonNumber,
      );
      if (generation !== nextEpisodeGenerationRef.current) return;

      const exactNextEpisode = currentSeason?.episodes.find(
        (candidate) => candidate.episodeNumber === episode.episodeNumber + 1,
      );

      if (exactNextEpisode) {
        setNextEpisode(exactNextEpisode);
        return;
      }

      const hasLaterEpisode = currentSeason?.episodes.some(
        (candidate) => candidate.episodeNumber > episode.episodeNumber,
      );
      if (hasLaterEpisode) {
        // A gap in the loaded season must not make autoplay skip the missing
        // episode or jump to another season.
        return;
      }

      const currentSeasonSummary = (series.seasons ?? []).find(
        (season) => season.seasonNumber === episode.seasonNumber,
      );
      const expectedCurrentSeasonEpisodes =
        currentSeasonSummary?.episodeCount;
      if (
        typeof expectedCurrentSeasonEpisodes === 'number'
        && Number.isInteger(expectedCurrentSeasonEpisodes)
        && expectedCurrentSeasonEpisodes > 0
        && (currentSeason?.episodes.length ?? 0)
          < expectedCurrentSeasonEpisodes
      ) {
        // Do not jump into the next season when this season is known to be
        // incomplete. A later catalog refresh can expose the missing episodes
        // without autoplay skipping them.
        return;
      }

      const nextSeasonNumber = episode.seasonNumber + 1;
      const hasImmediateNextSeason = (series.seasons ?? []).some(
        (season) => season.seasonNumber === nextSeasonNumber,
      );

      if (!hasImmediateNextSeason) return;

      const nextSeason = await catalogService.getSeason(series.id, nextSeasonNumber);
      if (generation !== nextEpisodeGenerationRef.current) return;

      const firstEpisode = nextSeason?.episodes
        .filter((candidate) => candidate.episodeNumber > 0)
        .sort((left, right) => left.episodeNumber - right.episodeNumber)[0];
      setNextEpisode(firstEpisode ?? null);
    } catch {
      if (generation === nextEpisodeGenerationRef.current) {
        setNextEpisode(null);
      }
    } finally {
      if (generation === nextEpisodeGenerationRef.current) {
        setNextEpisodeLoading(false);
      }
    }
  }, [catalogService]);

  const resolveMovieSources = useCallback(async (
    details: MediaDetails,
  ): Promise<StreamSource[]> => {
    if (details.kind !== 'movie' || !details.id?.trim()) return [];

    const resolved = await sourceResolverRef.current.resolve({
      mediaId: details.id,
      kind: 'movie',
      externalIds: details.externalIds,
    });

    return rankStreamSources(resolved, {
      preferredAudioLanguages: preferencesRef.current.preferredAudioLanguages,
      preferWebCompatible: Platform.OS === 'web',
      webMatroskaSupported: Platform.OS === 'web' && webEngineSupportsMatroska(),
    }).map(({ source }) => source);
  }, []);

  const playMovie = useCallback(async (details: MediaDetails) => {
    if (details.kind !== 'movie' || !details.id?.trim()) return;
    nextEpisodeGenerationRef.current += 1;
    setActiveSeries(null);
    setNextEpisode(null);
    setNextEpisodeLoading(false);
    setSourceChooserOpen(false);
    setSubtitleChooserOpen(false);
    setActiveMedia({
      mediaId: details.id,
      kind: 'movie',
      title: details.title,
      ...(details.posterUrl ? { posterUrl: details.posterUrl } : {}),
      ...(details.year ? { year: details.year } : {}),
      externalIds: details.externalIds,
    });
    await resolveRequest({
      mediaId: details.id,
      kind: 'movie',
      externalIds: details.externalIds,
    });
  }, [resolveRequest]);

  const resolveEpisodeSources = useCallback(async (
    series: MediaDetails,
    episode: SeriesEpisode,
  ): Promise<StreamSource[]> => {
    if (series.kind !== 'series' || !series.id?.trim() || !episode.id?.trim()) return [];
    if (episode.seriesId !== series.id) return [];
    if (!Number.isInteger(episode.seasonNumber) || episode.seasonNumber < 0) return [];
    if (!Number.isInteger(episode.episodeNumber) || episode.episodeNumber <= 0) return [];

    const resolved = await sourceResolverRef.current.resolve({
      mediaId: episode.id,
      kind: 'episode',
      externalIds: series.externalIds,
      seriesMediaId: series.id,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
    });

    return rankStreamSources(resolved, {
      preferredAudioLanguages: preferencesRef.current.preferredAudioLanguages,
      preferWebCompatible: Platform.OS === 'web',
      webMatroskaSupported: Platform.OS === 'web' && webEngineSupportsMatroska(),
    }).map(({ source }) => source);
  }, []);

  const playEpisode = useCallback(async (
    series: MediaDetails,
    episode: SeriesEpisode,
  ): Promise<boolean> => {
    if (series.kind !== 'series' || !series.id?.trim() || !episode.id?.trim()) return false;
    if (episode.seriesId !== series.id) return false;
    if (!Number.isInteger(episode.seasonNumber) || episode.seasonNumber < 0) return false;
    if (!Number.isInteger(episode.episodeNumber) || episode.episodeNumber <= 0) return false;

    setActiveSeries(series);
    setNextEpisode(null);
    setSourceChooserOpen(false);
    setSubtitleChooserOpen(false);
    void loadNextEpisode(series, episode);
    setActiveMedia({
      mediaId: episode.id,
      kind: 'episode',
      title: `${series.title} · S${episode.seasonNumber}E${episode.episodeNumber} · ${episode.title}`,
      ...((episode.stillUrl ?? series.posterUrl)
        ? { posterUrl: episode.stillUrl ?? series.posterUrl }
        : {}),
      ...(series.year ? { year: series.year } : {}),
      externalIds: series.externalIds,
      seriesId: series.id,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
    });
    return resolveRequest({
      mediaId: episode.id,
      kind: 'episode',
      externalIds: series.externalIds,
      seriesMediaId: series.id,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
    });
  }, [loadNextEpisode, resolveRequest]);

  const playNextEpisode = useCallback(async (): Promise<boolean> => {
    if (!activeSeries || !nextEpisode || !activeMedia || controller.getState().status === 'resolving') return false;
    const expectedMediaId = activeMedia.mediaId;
    // Do not advance if the user already changed/closed playback before this
    // async continuation gets to run.
    if (controller.getState().request?.mediaId !== expectedMediaId) return false;
    return playEpisode(activeSeries, nextEpisode);
  }, [activeMedia, activeSeries, controller, nextEpisode, playEpisode]);

  const resumeProgress = useCallback(async (record: WatchProgressRecord): Promise<boolean> => {
    if (!record.mediaId?.trim() || !record.title?.trim()) return false;
    if (
      record.kind === 'episode'
      && (!Number.isInteger(record.seasonNumber)
        || record.seasonNumber! < 0
        || !Number.isInteger(record.episodeNumber)
        || !record.episodeNumber
        || record.episodeNumber <= 0)
    ) {
      return false;
    }

    nextEpisodeGenerationRef.current += 1;
    setActiveSeries(null);
    setNextEpisode(null);
    setNextEpisodeLoading(false);
    setSourceChooserOpen(false);
    setSubtitleChooserOpen(false);
    setActiveMedia({
      mediaId: record.mediaId,
      kind: record.kind,
      title: record.title,
      ...(record.posterUrl ? { posterUrl: record.posterUrl } : {}),
      ...(record.year ? { year: record.year } : {}),
      externalIds: record.externalIds,
      ...(record.kind === 'episode' ? {
        ...(record.seriesId ? { seriesId: record.seriesId } : {}),
        seasonNumber: record.seasonNumber,
        episodeNumber: record.episodeNumber,
      } : {}),
    });

    if (
      record.kind === 'episode'
      && record.seriesId
      && record.seasonNumber !== undefined
      && record.episodeNumber !== undefined
    ) {
      const restoreGeneration = nextEpisodeGenerationRef.current;
      const storedSeriesId = record.seriesId;
      const storedExternalIds = record.externalIds ?? {};
      const storedSeriesTitle = seriesTitleFromProgressTitle(record.title);

      const restoreSeriesContext = async () => {
        let series: MediaDetails | null = null;
        try {
          series = await catalogService.getDetails(storedSeriesId);
        } catch {
          // A removed provider can still be recovered by external identity.
        }

        if (
          !series
          && storedSeriesTitle
          && (
            storedExternalIds.imdb?.trim()
            || storedExternalIds.tmdb?.trim()
          )
        ) {
          try {
            const page = await catalogService.search(storedSeriesTitle);
            const fallbackIdentity = {
              mediaId: storedSeriesId,
              kind: 'series' as const,
              externalIds: storedExternalIds,
            };
            for (const item of page.items) {
              const recoveredId = item.id.trim();
              if (
                item.kind !== 'series'
                || !recoveredId
                || recoveredId === storedSeriesId
                || !sameMyListMedia(
                  {
                    mediaId: recoveredId,
                    kind: item.kind,
                    externalIds: item.externalIds,
                  },
                  fallbackIdentity,
                )
              ) {
                continue;
              }

              try {
                const recovered = await catalogService.getDetails(
                  recoveredId,
                );
                if (recovered?.kind === 'series') {
                  series = recovered;
                  break;
                }
              } catch {
                // Try the next matching provider result.
              }
            }
          } catch {
            // Playback can still continue without next-episode metadata.
          }
        }

        if (restoreGeneration !== nextEpisodeGenerationRef.current) return;
        if (!series || series.kind !== 'series') return;
        setActiveSeries(series);
        void loadNextEpisode(series, {
          id: record.mediaId,
          seriesId: series.id,
          seasonNumber: record.seasonNumber!,
          episodeNumber: record.episodeNumber!,
          title: record.title,
        });
      };

      void restoreSeriesContext();
    }

    const request: AddonMediaRequest = record.kind === 'movie'
      ? {
        mediaId: record.mediaId,
        kind: 'movie',
        externalIds: record.externalIds ?? {},
      }
      : {
        mediaId: record.mediaId,
        kind: 'episode',
        externalIds: record.externalIds ?? {},
        ...(record.seriesId ? { seriesMediaId: record.seriesId } : {}),
        seasonNumber: record.seasonNumber!,
        episodeNumber: record.episodeNumber!,
      };

    return resolveRequest(request);
  }, [catalogService, loadNextEpisode, resolveRequest]);

  const retry = useCallback(async () => {
    if (controller.getState().status === 'resolving') return;
    const request = controller.getState().request;
    if (!request || !activeMedia) return;
    setSourceChooserOpen(false);
    setSubtitleChooserOpen(false);
    await resolveRequest(request);
  }, [activeMedia, controller, resolveRequest]);

  const refreshSources = useCallback(async (): Promise<boolean> => {
    const request = controller.getState().request;
    if (!request || !activeMedia || request.mediaId !== activeMedia.mediaId) return false;
    setSourceChooserOpen(false);
    return controller.refresh();
  }, [activeMedia, controller]);

  const selectSource = useCallback((sourceId: string) => {
    const selected = controller.selectSource(sourceId);
    if (selected) setSourceChooserOpen(false);
    return selected;
  }, [controller]);

  const selectSubtitle = useCallback((subtitleId: string | null) => {
    if (subtitleId === null) {
      setSelectedSubtitleId(null);
      setSubtitleChooserOpen(false);
      return true;
    }
    if (!subtitleId.trim() || !subtitleTracks.some((track) => track.id === subtitleId)) return false;
    setSelectedSubtitleId(subtitleId);
    setSubtitleChooserOpen(false);
    return true;
  }, [subtitleTracks]);

  const openSourceChooser = useCallback(() => {
    setSubtitleChooserOpen(false);
    setSourceChooserOpen(true);
  }, []);
  const closeSourceChooser = useCallback(() => setSourceChooserOpen(false), []);
  const openSubtitleChooser = useCallback(() => {
    setSourceChooserOpen(false);
    setSubtitleChooserOpen(true);
  }, []);
  const closeSubtitleChooser = useCallback(() => setSubtitleChooserOpen(false), []);

  const closePlayback = useCallback(() => {
    subtitleGenerationRef.current += 1;
    nextEpisodeGenerationRef.current += 1;
    setActiveSeries(null);
    setNextEpisode(null);
    setNextEpisodeLoading(false);
    setSourceChooserOpen(false);
    setSubtitleChooserOpen(false);
    setSubtitleTracks([]);
    setSelectedSubtitleId(null);
    setSubtitleLoading(false);
    setActiveMedia(null);
    controller.reset();
  }, [controller]);

  useEffect(() => {
    if (playbackIdentityRef.current === userId) return;
    playbackIdentityRef.current = userId;
    closePlayback();
  }, [closePlayback, userId]);

  const selectedSource = useMemo(
    () => state.sources.find((source) => source.id === state.selectedSourceId) ?? null,
    [state.selectedSourceId, state.sources],
  );
  const selectedSubtitle = useMemo(
    () => subtitleTracks.find((track) => track.id === selectedSubtitleId) ?? null,
    [selectedSubtitleId, subtitleTracks],
  );

  const api = useMemo<PlaybackApi>(() => ({
    state,
    selectedSource,
    activeMedia,
    subtitleTracks,
    selectedSubtitle,
    subtitleLoading,
    nextEpisode,
    nextEpisodeLoading,
    sourceChooserOpen,
    subtitleChooserOpen,
    playMovie,
    resolveMovieSources,
    resolveEpisodeSources,
    playEpisode,
    playNextEpisode,
    resumeProgress,
    retry,
    refreshSources,
    selectSource,
    selectSubtitle,
    openSourceChooser,
    closeSourceChooser,
    openSubtitleChooser,
    closeSubtitleChooser,
    closePlayback,
  }), [
    activeMedia,
    closePlayback,
    closeSourceChooser,
    closeSubtitleChooser,
    openSourceChooser,
    openSubtitleChooser,
    playEpisode,
    playMovie,
    resolveEpisodeSources,
    resolveMovieSources,
    playNextEpisode,
    resumeProgress,
    retry,
    refreshSources,
    selectSource,
    selectSubtitle,
    selectedSource,
    selectedSubtitle,
    sourceChooserOpen,
    state,
    subtitleChooserOpen,
    subtitleLoading,
    subtitleTracks,
    nextEpisode,
    nextEpisodeLoading,
  ]);

  return <PlaybackContext.Provider value={api}>{children}</PlaybackContext.Provider>;
}

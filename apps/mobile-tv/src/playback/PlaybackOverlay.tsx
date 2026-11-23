import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { AudioTrack, EmbeddedSubtitleTrack, StreamSource } from '@moviestv/core';
import {
  createProgressRecord,
  findWatchProgressRecord,
  isPlaybackResumable,
} from '@moviestv/sync';
import { fontFamily, type Theme } from '@moviestv/ui';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { safeDownloadErrorMessage } from '../downloads/downloadError';
import { useDownloadManager } from '../downloads/useDownloadManager';
import { useI18n } from '../i18n/useI18n';
import { usePreferences } from '../preferences/usePreferences';
import { useWatchProgress } from '../watch-progress/useWatchProgress';
import { AudioChooser } from './AudioChooser';
import { SourceChooser } from './SourceChooser';
import { readRememberedAudioTrack, rememberAudioTrack } from './audioTrackMemory';
import { DownloadChooser } from './DownloadChooser';
import { SubtitleChooser } from './SubtitleChooser';
import { loadSubtitleCues, type SubtitleCue } from './SubtitleCueLoader';
import { usePlayback } from './usePlayback';
import { VideoSurface } from './VideoSurface';
import { readSubtitleStyle, subtitleMetrics, type SubtitleStyle } from './subtitleStyle';
import {
  DEFAULT_PLAYER_PREFERENCES,
  loadPlayerPreferences,
  playerPreferencesSnapshot,
  subscribePlayerPreferences,
  type PlayerPreferences,
} from './playerPreferences';
import { canDownloadSource } from './downloadSource';
import { safePlaybackErrorMessage } from './playbackError';
import { safeInsetEdge } from '../app/safeAreaLayout';
import { playbackSourceFingerprint } from './playbackSourceIdentity';
import { playbackBackAction } from './playbackBackAction';
import {
  useWebTvBackHandler,
  useWebTvModalFocusRestore,
} from '../web/tvRemoteNavigation';
import { useTheme, useThemeStyles } from '../theme/ThemeProvider';

function OverlayButton({
  label,
  onPress,
  primary = false,
  compact = false,
}: {
  label: string;
  onPress(): void;
  primary?: boolean;
  compact?: boolean;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <Pressable
      focusable
      onPress={onPress}
      style={({ focused, pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        primary && styles.buttonPrimary,
        focused && styles.focused,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Compact icon action for the player header.
 *
 * These actions used to sit in an absolutely positioned row that, in landscape,
 * landed on top of the transport controls. The header has real layout, so they
 * cannot overlap anything.
 */
function OverlayIconButton({
  icon,
  accessibilityLabel,
  onPress,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  accessibilityLabel: string;
  onPress(): void;
  testID?: string;
}) {
  const styles = useThemeStyles(createStyles);
  return (
    <Pressable
      focusable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      style={({ focused, pressed }) => [
        styles.headerIconButton,
        focused && styles.focused,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={20} color="#ffffff" />
    </Pressable>
  );
}

function ReadyPlayer({
  source,
  initialPositionSeconds,
  onProgress,
  onEnded,
  onPlaybackError,
  preferredAudioLanguages,
  preferredSubtitleLanguages,
  embeddedSubtitlesEnabled,
  selectedAudioTrackId,
  onAudioTracksChange,
  selectedEmbeddedSubtitleTrackId,
  onEmbeddedSubtitleTracksChange,
  onControlsVisibilityChange,
  onOpenAudio,
  audioLabel,
  onOpenSubtitles,
  subtitleLabel,
  onOpenSource,
  sourceLabel,
  onDownload,
  downloadLabel,
  onNextEpisode,
  nextEpisodeLabel,
  title,
  meta,
  submeta,
  locked,
  onToggleLock,
  imdbId,
  seasonNumber,
  episodeNumber,
  skipIntroEnabled,
}: {
  source: StreamSource;
  initialPositionSeconds: number;
  onProgress(positionSeconds: number, durationSeconds: number): void;
  onEnded(): void;
  onPlaybackError(message?: string): void;
  preferredAudioLanguages: readonly string[];
  preferredSubtitleLanguages: readonly string[];
  embeddedSubtitlesEnabled: boolean;
  selectedAudioTrackId: string | null;
  onAudioTracksChange(tracks: AudioTrack[], selectedTrackId: string | null): void;
  selectedEmbeddedSubtitleTrackId: string | null;
  onEmbeddedSubtitleTracksChange(
    tracks: EmbeddedSubtitleTrack[],
    selectedTrackId: string | null,
  ): void;
  onControlsVisibilityChange(visible: boolean): void;
  onOpenAudio?(): void;
  audioLabel?: string;
  onOpenSubtitles?(): void;
  subtitleLabel?: string;
  onOpenSource?(): void;
  sourceLabel?: string;
  onDownload?(): void;
  downloadLabel?: string;
  onNextEpisode?(): void;
  nextEpisodeLabel?: string;
  title?: string;
  meta?: string;
  submeta?: string;
  locked?: boolean;
  onToggleLock?(): void;
  imdbId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  skipIntroEnabled?: boolean;
}) {
  return (
    <VideoSurface
      source={source}
      testID="native-video"
      initialPositionSeconds={initialPositionSeconds}
      onProgress={onProgress}
      onEnded={onEnded}
      onPlaybackError={onPlaybackError}
      preferredAudioLanguages={preferredAudioLanguages}
      preferredSubtitleLanguages={preferredSubtitleLanguages}
      embeddedSubtitlesEnabled={embeddedSubtitlesEnabled}
      selectedAudioTrackId={selectedAudioTrackId}
      onAudioTracksChange={onAudioTracksChange}
      selectedEmbeddedSubtitleTrackId={selectedEmbeddedSubtitleTrackId}
      onEmbeddedSubtitleTracksChange={onEmbeddedSubtitleTracksChange}
      onControlsVisibilityChange={onControlsVisibilityChange}
      onOpenAudio={onOpenAudio}
      audioLabel={audioLabel}
      onOpenSubtitles={onOpenSubtitles}
      subtitleLabel={subtitleLabel}
      onOpenSource={onOpenSource}
      sourceLabel={sourceLabel}
      onDownload={onDownload}
      downloadLabel={downloadLabel}
      onNextEpisode={onNextEpisode}
      nextEpisodeLabel={nextEpisodeLabel}
      title={title}
      meta={meta}
      submeta={submeta}
      locked={locked}
      onToggleLock={onToggleLock}
      imdbId={imdbId}
      seasonNumber={seasonNumber}
      episodeNumber={episodeNumber}
      skipIntroEnabled={skipIntroEnabled}
    />
  );
}

export function PlaybackOverlay({
  onOpenStreamProviders,
}: {
  onOpenStreamProviders?(): void;
} = {}) {
  const styles = useThemeStyles(createStyles);
  const theme = useTheme();
  const playback = usePlayback();
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const downloads = useDownloadManager();
  const watchProgress = useWatchProgress();
  const { preferences } = usePreferences();
  const { t } = useI18n();
  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const [downloadStartError, setDownloadStartError] = useState<string | null>(null);
  const [downloadChooserOpen, setDownloadChooserOpen] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const audioMemoryRef = useRef<string | null>(null);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string | null>(null);
  const [audioChooserOpen, setAudioChooserOpen] = useState(false);
  const [embeddedSubtitleTracks, setEmbeddedSubtitleTracks] = useState<EmbeddedSubtitleTrack[]>([]);
  const [selectedEmbeddedSubtitleTrackId, setSelectedEmbeddedSubtitleTrackId] = useState<string | null>(null);
  const [subtitlesOff, setSubtitlesOff] = useState(!preferences.subtitlesEnabled);
  const [playerChromeVisible, setPlayerChromeVisible] = useState(true);
  // Locking hides every control, including this overlay's header, so a stray
  // touch mid-film cannot pause or scrub. The surface keeps one unlock target.
  const [playerLocked, setPlayerLocked] = useState(false);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle | null>(null);

  // The overlay stays mounted for the whole session, so reading this once on
  // mount meant a style chosen in Settings only applied after a restart. Re-read
  // it whenever a film starts; that is the first moment it matters.
  const subtitleStyleSourceId = playback.selectedSource?.id ?? null;
  useEffect(() => {
    let active = true;
    void readSubtitleStyle().then((style) => { if (active) setSubtitleStyle(style); });
    return () => { active = false; };
  }, [subtitleStyleSourceId]);
  const subtitleLoadGenerationRef = useRef(0);
  const failedSourceFingerprintsRef = useRef(new Set<string>());
  const failedSubtitleIdsRef = useRef(new Set<string>());
  const failedSubtitleUrlsRef = useRef(new Set<string>());
  const embeddedSubtitleTracksRef = useRef<EmbeddedSubtitleTrack[]>([]);
  const externalSubtitleFallbackPendingRef = useRef(false);
  const refreshedAfterExhaustionRef = useRef(false);
  const sourceRefreshInFlightRef = useRef(false);
  const sourceSwitchGenerationRef = useRef(0);
  const sourceRefreshGenerationRef = useRef(0);
  const manualSourceSwitchGenerationRef = useRef(0);
  const latestProgressRef = useRef<{
    mediaId: string;
    positionSeconds: number;
    durationSeconds: number;
  } | null>(null);
  const lastSavedAtRef = useRef(0);
  const endedMediaIdRef = useRef<string | null>(null);
  const nextEpisodeInFlightRef = useRef(false);
  // Countdown before the next episode starts, so it can be cancelled.
  const [upNextSeconds, setUpNextSeconds] = useState<number | null>(null);
  const [playerPreferences, setPlayerPreferencesState] =
    useState<PlayerPreferences>(DEFAULT_PLAYER_PREFERENCES);

  useEffect(() => {
    let active = true;
    void loadPlayerPreferences().then((value) => {
      if (active) setPlayerPreferencesState(value);
    });
    const unsubscribe = subscribePlayerPreferences(() => {
      setPlayerPreferencesState(playerPreferencesSnapshot());
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const progressSaveGenerationRef = useRef(0);

  const activeMedia = playback.activeMedia;
  const selectedSourceFingerprint = playback.selectedSource
    ? playbackSourceFingerprint(playback.selectedSource)
    : null;
  const savedProgress = useMemo(
    () => activeMedia
      ? findWatchProgressRecord(watchProgress.records, activeMedia)
      : undefined,
    [activeMedia, watchProgress.records],
  );
  const latestPosition = (
    activeMedia
    && latestProgressRef.current?.mediaId === activeMedia.mediaId
  )
    ? latestProgressRef.current.positionSeconds
    : null;
  const initialPositionSeconds = latestPosition
    ?? (
      savedProgress && isPlaybackResumable(savedProgress)
        ? savedProgress.positionSeconds
        : 0
    );

  useEffect(() => {
    latestProgressRef.current = null;
    lastSavedAtRef.current = 0;
    endedMediaIdRef.current = null;
    nextEpisodeInFlightRef.current = false;
    progressSaveGenerationRef.current += 1;
    failedSourceFingerprintsRef.current = new Set();
    failedSubtitleIdsRef.current = new Set();
    failedSubtitleUrlsRef.current = new Set();
    embeddedSubtitleTracksRef.current = [];
    externalSubtitleFallbackPendingRef.current = false;
    refreshedAfterExhaustionRef.current = false;
    sourceRefreshInFlightRef.current = false;
    sourceSwitchGenerationRef.current += 1;
    sourceRefreshGenerationRef.current += 1;
    manualSourceSwitchGenerationRef.current += 1;
    setPlaybackError(null);
    subtitleLoadGenerationRef.current += 1;
    setSubtitleError(null);
    setDownloadStartError(null);
    setSubtitleCues([]);
    setPlaybackPosition(0);
    setEmbeddedSubtitleTracks([]);
    setSelectedEmbeddedSubtitleTrackId(null);
    setSubtitlesOff(!preferences.subtitlesEnabled);
    setPlayerChromeVisible(true);
  }, [activeMedia?.mediaId, preferences.subtitlesEnabled]);

  useLayoutEffect(() => {
    setAudioTracks([]);
    setSelectedAudioTrackId(null);
    setAudioChooserOpen(false);
    embeddedSubtitleTracksRef.current = [];
    externalSubtitleFallbackPendingRef.current = false;
    setEmbeddedSubtitleTracks([]);
    setSelectedEmbeddedSubtitleTrackId(null);
  }, [selectedSourceFingerprint]);

  useEffect(() => {
    let active = true;
    const generation = ++subtitleLoadGenerationRef.current;
    const selected = playback.selectedSubtitle;
    externalSubtitleFallbackPendingRef.current = false;
    setSubtitleCues([]);
    setSubtitleError(null);

    if (!selected || subtitlesOff) {
      return () => {
        active = false;
        subtitleLoadGenerationRef.current += 1;
      };
    }

    void loadSubtitleCues(selected.url)
      .then((cues) => {
        if (!active || generation !== subtitleLoadGenerationRef.current) return;
        failedSubtitleIdsRef.current.delete(selected.id);
        failedSubtitleUrlsRef.current.delete(selected.url);
        externalSubtitleFallbackPendingRef.current = false;
        setSubtitleCues(cues);
      })
      .catch(() => {
        if (!active || generation !== subtitleLoadGenerationRef.current) return;

        failedSubtitleIdsRef.current.add(selected.id);
        failedSubtitleUrlsRef.current.add(selected.url);
        const fallback = playback.subtitleTracks.find(
          (track) => (
            track.id !== selected.id
            && track.url !== selected.url
            && !failedSubtitleIdsRef.current.has(track.id)
            && !failedSubtitleUrlsRef.current.has(track.url)
          ),
        );

        if (fallback) {
          externalSubtitleFallbackPendingRef.current = false;
          setSubtitleError(null);
          playback.selectSubtitle(fallback.id);
          return;
        }

        if (embeddedSubtitleTracksRef.current.length > 0) {
          externalSubtitleFallbackPendingRef.current = false;
          setSubtitleError(null);
          setSubtitlesOff(false);
          setSelectedEmbeddedSubtitleTrackId(null);
          playback.selectSubtitle(null);
          return;
        }

        externalSubtitleFallbackPendingRef.current = true;
        setSubtitleError(t('playback.subtitleFailed'));
      });

    return () => {
      active = false;
      subtitleLoadGenerationRef.current += 1;
    };
  }, [
    playback.selectSubtitle,
    playback.selectedSubtitle,
    playback.subtitleTracks,
    subtitlesOff,
    t,
  ]);

  const persistProgress = useCallback(async (
    positionSeconds: number,
    durationSeconds: number,
    force = false,
  ) => {
    if (!activeMedia) return;
    if (endedMediaIdRef.current === activeMedia.mediaId && !force) return;
    if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return;

    latestProgressRef.current = {
      mediaId: activeMedia.mediaId,
      positionSeconds,
      durationSeconds,
    };
    const now = Date.now();
    if (!force && now - lastSavedAtRef.current < 10_000) return;
    const saveGeneration = progressSaveGenerationRef.current;
    lastSavedAtRef.current = now;

    await watchProgress.save(createProgressRecord(
      activeMedia,
      positionSeconds,
      durationSeconds,
      new Date(now).toISOString(),
      savedProgress?.resetAt,
    ));
    if (saveGeneration !== progressSaveGenerationRef.current) return;
  }, [activeMedia, savedProgress?.resetAt, watchProgress]);

  const handleProgress = useCallback((positionSeconds: number, durationSeconds: number) => {
    if (!activeMedia || endedMediaIdRef.current === activeMedia.mediaId) return;
    setPlaybackPosition(positionSeconds);
    void persistProgress(positionSeconds, durationSeconds, false).catch(() => undefined);
  }, [activeMedia, persistProgress]);

  const handleAudioTracksChange = useCallback((
    tracks: AudioTrack[],
    selectedTrackId: string | null,
  ) => {
    setAudioTracks(tracks);
    // A remembered choice wins over the automatic pick: providers mislabel
    // audio often enough that the user's correction must survive a reload.
    let next = selectedTrackId;
    const remembered = audioMemoryRef.current;
    if (remembered && tracks.some((track) => track.id === remembered)) {
      next = remembered;
    }
    setSelectedAudioTrackId(next);
  }, []);

  const selectedSource = playback.selectedSource;
  useEffect(() => {
    audioMemoryRef.current = null;
    if (!selectedSource) return undefined;
    let cancelled = false;
    void readRememberedAudioTrack(playbackSourceFingerprint(selectedSource))
      .then((trackId) => {
        if (cancelled || !trackId) return;
        audioMemoryRef.current = trackId;
        setSelectedAudioTrackId(trackId);
      });
    return () => { cancelled = true; };
  }, [selectedSource]);

  const handleEmbeddedSubtitleTracksChange = useCallback((
    tracks: EmbeddedSubtitleTrack[],
    selectedTrackId: string | null,
  ) => {
    embeddedSubtitleTracksRef.current = tracks;
    setEmbeddedSubtitleTracks(tracks);

    if (
      tracks.length > 0
      && externalSubtitleFallbackPendingRef.current
    ) {
      externalSubtitleFallbackPendingRef.current = false;
      setSubtitleError(null);
      setSubtitlesOff(false);
      setSelectedEmbeddedSubtitleTrackId(null);
      playbackRef.current.selectSubtitle(null);
      return;
    }

    if (!subtitlesOff && playback.selectedSubtitle === null) {
      setSelectedEmbeddedSubtitleTrackId(selectedTrackId);
    }
  }, [playback.selectedSubtitle, subtitlesOff]);

  const handleEnded = useCallback(() => {
    if (!activeMedia) return;
    if (endedMediaIdRef.current === activeMedia.mediaId) return;
    endedMediaIdRef.current = activeMedia.mediaId;

    const latest = latestProgressRef.current;
    if (latest) {
      const now = Date.now();
      setPlaybackPosition(latest.durationSeconds);
      lastSavedAtRef.current = Date.now();
      void watchProgress.save(createProgressRecord(
        activeMedia,
        latest.durationSeconds,
        latest.durationSeconds,
        new Date(now).toISOString(),
        savedProgress?.resetAt,
      )).catch(() => undefined);
    }

    if (activeMedia?.kind === 'episode' && playback.nextEpisode) {
      // The benchmark behaviour: give the viewer ten seconds and a way out.
      setUpNextSeconds(preferences.autoplay ? playerPreferences.upNextSeconds : null);
    }
  }, [
    activeMedia,
    playback,
    preferences.autoplay,
    savedProgress?.resetAt,
    watchProgress,
  ]);

  useEffect(() => {
    if (upNextSeconds === null) return undefined;
    if (upNextSeconds > 0) {
      const timer = setTimeout(
        () => setUpNextSeconds((current) => (current === null ? null : current - 1)),
        1_000,
      );
      return () => clearTimeout(timer);
    }
    if (nextEpisodeInFlightRef.current) return undefined;
    nextEpisodeInFlightRef.current = true;
    setUpNextSeconds(null);
    void playback.playNextEpisode()
      .catch(() => false)
      .finally(() => {
        nextEpisodeInFlightRef.current = false;
      });
    return undefined;
  }, [playback, upNextSeconds]);

  useEffect(() => {
    if (
      !preferences.autoplay
      || activeMedia?.kind !== 'episode'
      || endedMediaIdRef.current !== activeMedia.mediaId
      || playback.nextEpisodeLoading
      || !playback.nextEpisode
      || upNextSeconds !== null
    ) return;

    setUpNextSeconds(playerPreferences.upNextSeconds);
  }, [
    activeMedia,
    playback.nextEpisode,
    playback.nextEpisodeLoading,
    playback.playNextEpisode,
    preferences.autoplay,
  ]);

  const handlePlaybackError = useCallback((
    expectedSource: StreamSource,
    message?: string,
  ) => {
    const currentPlayback = playbackRef.current;
    const current = currentPlayback.selectedSource;
    const terminalMessage = message === 'Video source failed'
      ? t('playback.failed')
      : safePlaybackErrorMessage(
          message,
          t('playback.failed'),
        );
    if (!current) {
      // A source can disappear while a refresh/reset is replacing the session.
      // Let that state transition own the UI instead of surfacing a stale
      // terminal error from the unmounted player.
      if (sourceRefreshInFlightRef.current || currentPlayback.state.status !== 'ready') return;
      setPlaybackError(terminalMessage);
      return;
    }

    const expectedFingerprint = playbackSourceFingerprint(expectedSource);
    const currentFingerprint = playbackSourceFingerprint(current);
    if (expectedFingerprint !== currentFingerprint) return;

    failedSourceFingerprintsRef.current.add(currentFingerprint);
    const currentIndex = currentPlayback.state.sources.findIndex(
      (candidate) => playbackSourceFingerprint(candidate) === currentFingerprint,
    );
    const orderedFallbacks = currentIndex >= 0
      ? [
        ...currentPlayback.state.sources.slice(currentIndex + 1),
        ...currentPlayback.state.sources.slice(0, currentIndex),
      ]
      : currentPlayback.state.sources;
    const fallback = orderedFallbacks.find((candidate) => {
      const fingerprint = playbackSourceFingerprint(candidate);
      return fingerprint !== currentFingerprint
        && !failedSourceFingerprintsRef.current.has(fingerprint);
    });

    if (fallback) {
      if (endedMediaIdRef.current === activeMedia?.mediaId) return;
      setPlaybackError(null);
      setPlayerChromeVisible(true);
      const latest = latestProgressRef.current;
      const switchGeneration = ++sourceSwitchGenerationRef.current;
      if (latest) {
        // The in-memory progress snapshot already gives the replacement player
        // its exact resume position. Persist in parallel so slow IndexedDB/
        // sync storage cannot hold up Safari source failover.
        void persistProgress(
          latest.positionSeconds,
          latest.durationSeconds,
          true,
        ).catch(() => undefined);
      }
      if (switchGeneration === sourceSwitchGenerationRef.current) {
        currentPlayback.selectSource(fallback.id);
      }
      return;
    }

    // All currently resolved URLs failed. Providers can issue short-lived
    // stream URLs, so resolve the request once more before showing a terminal
    // error. Only do this once per media item to avoid a retry loop when a
    // provider repeatedly returns the same broken URLs.
    if (sourceRefreshInFlightRef.current) {
      // Another error from the exhausted source can arrive while the provider
      // refresh is still resolving. The in-flight refresh owns recovery; do
      // not surface a terminal error until that attempt actually fails.
      return;
    }

    if (!refreshedAfterExhaustionRef.current) {
      if (endedMediaIdRef.current === activeMedia?.mediaId) return;
      refreshedAfterExhaustionRef.current = true;
      sourceRefreshInFlightRef.current = true;
      setPlaybackError(null);
      setPlayerChromeVisible(true);
      const refreshGeneration = ++sourceRefreshGenerationRef.current;
      const latest = latestProgressRef.current;
      if (latest) {
        // Do not delay provider re-resolution on a local progress write. The
        // latest position remains in memory and will be reused by the next
        // source even while persistence finishes.
        void persistProgress(
          latest.positionSeconds,
          latest.durationSeconds,
          true,
        ).catch(() => undefined);
      }
      void (async () => {
        const refreshed = await currentPlayback.refreshSources();
        if (refreshGeneration !== sourceRefreshGenerationRef.current) return;
        if (!refreshed) {
          if (playbackRef.current.state.status === 'error') return;
          setPlaybackError(terminalMessage);
          return;
        }
        // Keep fingerprints that already failed before refresh. The session
        // controller now selects a genuinely fresh URL when one exists, and
        // retaining this memory prevents fallback from circling back through
        // the same broken URLs.
        setPlaybackError(null);
      })()
        .catch(() => {
          if (refreshGeneration === sourceRefreshGenerationRef.current) {
            setPlaybackError(terminalMessage);
          }
        })
        .finally(() => {
          if (refreshGeneration === sourceRefreshGenerationRef.current) {
            sourceRefreshInFlightRef.current = false;
          }
        });
      return;
    }

    setPlaybackError(terminalMessage);
  }, [activeMedia?.mediaId, persistProgress, t]);

  const closeWithProgress = useCallback(() => {
    // Closing is an explicit user action. Invalidate delayed automatic source
    // switches before awaiting persistence so they cannot revive playback.
    sourceSwitchGenerationRef.current += 1;
    sourceRefreshGenerationRef.current += 1;
    manualSourceSwitchGenerationRef.current += 1;
    sourceRefreshInFlightRef.current = false;
    nextEpisodeInFlightRef.current = false;
    const latest = latestProgressRef.current;
    progressSaveGenerationRef.current += 1;
    // Hide the session immediately; progress persistence can finish without
    // keeping a stale player interactive on screen.
    playback.closePlayback();
    if (latest && activeMedia && endedMediaIdRef.current !== activeMedia.mediaId) {
      const now = Date.now();
      void watchProgress.save(createProgressRecord(
        activeMedia,
        latest.positionSeconds,
        latest.durationSeconds,
        new Date(now).toISOString(),
        savedProgress?.resetAt,
      )).catch(() => undefined);
    }
  }, [activeMedia, playback, savedProgress?.resetAt, watchProgress]);

  const handlePlaybackBack = useCallback(() => {
    const action = playbackBackAction({
      audioChooserOpen,
      subtitleChooserOpen: playback.subtitleChooserOpen,
      sourceChooserOpen: playback.sourceChooserOpen,
      playbackOpen: playback.state.status !== 'idle',
    });

    if (action === 'audio') {
      setAudioChooserOpen(false);
      return true;
    }
    if (action === 'subtitles') {
      playback.closeSubtitleChooser();
      return true;
    }
    if (action === 'sources') {
      playback.closeSourceChooser();
      return true;
    }
    if (action === 'playback') {
      closeWithProgress();
      return true;
    }
    return false;
  }, [
    audioChooserOpen,
    closeWithProgress,
    playback.closeSourceChooser,
    playback.closeSubtitleChooser,
    playback.sourceChooserOpen,
    playback.state.status,
    playback.subtitleChooserOpen,
  ]);

  const playbackOpen = playback.state.status !== 'idle';

  useEffect(() => {
    if (Platform.OS === 'web' || Platform.isTV) return undefined;
    StatusBar.setHidden(playbackOpen, 'fade');
    return () => {
      StatusBar.setHidden(false, 'fade');
    };
  }, [playbackOpen]);

  const webPlaybackOpen = Platform.OS === 'web' && playbackOpen;
  useWebTvModalFocusRestore(webPlaybackOpen);
  useWebTvBackHandler(
    webPlaybackOpen,
    handlePlaybackBack,
  );

  useEffect(() => {
    if (
      Platform.OS === 'web'
      || !playbackOpen
      || (Platform.OS !== 'android' && !Platform.isTV)
    ) return undefined;

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      handlePlaybackBack,
    );
    return () => subscription.remove();
  }, [handlePlaybackBack, playbackOpen]);

  if (playback.state.status === 'idle') return null;

  if (playback.state.status === 'resolving') {
    return (
      <View
        aria-modal={true}
        testID="playback-overlay"
        style={[
          styles.overlay,
          {
            paddingTop: safeInsetEdge(theme.spacing.lg, safeAreaInsets.top, 8),
            paddingRight: safeInsetEdge(theme.spacing.lg, safeAreaInsets.right, 8),
            paddingBottom: safeInsetEdge(theme.spacing.lg, safeAreaInsets.bottom, 8),
            paddingLeft: safeInsetEdge(theme.spacing.lg, safeAreaInsets.left, 8),
          },
        ]}
      >
        <View style={styles.stateCard}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <Text style={styles.stateTitle}>{t('playback.findingSources')}</Text>
          <OverlayButton label={t('common.cancel')} onPress={closeWithProgress} />
        </View>
      </View>
    );
  }

  if (playback.state.status === 'no-sources' || playback.state.status === 'error') {
    const providerUnavailable = playback.state.status === 'error'
      && playback.state.error === 'Playback providers are unavailable';
    const message = playback.state.status === 'no-sources'
      ? t('playback.noSources')
      : providerUnavailable
        ? t('playback.providersUnavailable')
        : t('playback.failed');
    return (
      <View
        aria-modal={true}
        testID="playback-overlay"
        style={[
          styles.overlay,
          {
            paddingTop: safeInsetEdge(theme.spacing.lg, safeAreaInsets.top, 8),
            paddingRight: safeInsetEdge(theme.spacing.lg, safeAreaInsets.right, 8),
            paddingBottom: safeInsetEdge(theme.spacing.lg, safeAreaInsets.bottom, 8),
            paddingLeft: safeInsetEdge(theme.spacing.lg, safeAreaInsets.left, 8),
          },
        ]}
      >
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>{message}</Text>
          <View style={styles.actions}>
            <OverlayButton
            label={t('common.retry')}
            onPress={() => {
              sourceSwitchGenerationRef.current += 1;
              sourceRefreshGenerationRef.current += 1;
              manualSourceSwitchGenerationRef.current += 1;
              sourceRefreshInFlightRef.current = false;
              failedSourceFingerprintsRef.current = new Set();
              refreshedAfterExhaustionRef.current = false;
              setPlaybackError(null);
              void playback.retry().catch(() => undefined);
            }}
            primary
          />
            {(playback.state.status === 'no-sources' || providerUnavailable) && onOpenStreamProviders ? (
              <OverlayButton
                label={t('playback.manageProviders')}
                onPress={() => {
                  sourceSwitchGenerationRef.current += 1;
                  sourceRefreshGenerationRef.current += 1;
                  manualSourceSwitchGenerationRef.current += 1;
                  sourceRefreshInFlightRef.current = false;
                  playback.closePlayback();
                  onOpenStreamProviders();
                }}
              />
            ) : null}
            <OverlayButton label={t('playback.close')} onPress={closeWithProgress} />
          </View>
        </View>
      </View>
    );
  }

  const source = playback.selectedSource;
  if (!source) {
    return (
      <View
        aria-modal={true}
        testID="playback-overlay"
        style={[
          styles.overlay,
          {
            paddingTop: safeInsetEdge(theme.spacing.lg, safeAreaInsets.top, 8),
            paddingRight: safeInsetEdge(theme.spacing.lg, safeAreaInsets.right, 8),
            paddingBottom: safeInsetEdge(theme.spacing.lg, safeAreaInsets.bottom, 8),
            paddingLeft: safeInsetEdge(theme.spacing.lg, safeAreaInsets.left, 8),
          },
        ]}
      >
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>{t('playback.failed')}</Text>
          <OverlayButton label={t('playback.close')} onPress={closeWithProgress} />
        </View>
      </View>
    );
  }

  const matchingDownloadJob = downloads.jobs.find((job) => (
    activeMedia?.mediaId
      ? job.mediaId === activeMedia.mediaId
      : job.title === (activeMedia?.title ?? source.name ?? 'MoviesTv-Flix')
  ));
  const activeDownloadJob = matchingDownloadJob?.status === 'downloading'
    ? matchingDownloadJob
    : null;
  const failedDownloadJob = matchingDownloadJob?.status === 'error'
    ? matchingDownloadJob
    : null;

  const startDownload = async (chosen: StreamSource = source) => {
    if (activeDownloadJob) return;
    setDownloadStartError(null);
    try {
      await downloads.startDownload(
        chosen,
        activeMedia?.title,
        activeMedia ?? undefined,
      );
    } catch (error) {
      const safeError = safeDownloadErrorMessage(error);
      setDownloadStartError(
        safeError === 'Download failed'
          ? t('playback.failed')
          : safeError,
      );
    }
  };

  const selectSource = (sourceId: string) => {
    setAudioChooserOpen(false);
    // A manual source choice owns recovery from this point. Invalidate both a
    // delayed automatic switch and any provider refresh that started for the
    // previously selected source.
    sourceSwitchGenerationRef.current += 1;
    sourceRefreshGenerationRef.current += 1;
    sourceRefreshInFlightRef.current = false;
    const manualSwitchGeneration = ++manualSourceSwitchGenerationRef.current;
    // A manual source choice is an explicit recovery attempt. Allow one fresh
    // provider resolution again if the newly chosen source set is exhausted.
    refreshedAfterExhaustionRef.current = false;
    const nextSource = playback.state.sources.find(
      (candidate) => candidate.id === sourceId,
    );
    if (nextSource) {
      failedSourceFingerprintsRef.current.delete(
        playbackSourceFingerprint(nextSource),
      );
    }
    setPlaybackError(null);
    setPlayerChromeVisible(true);
    const latest = latestProgressRef.current;
    if (latest) {
      void persistProgress(
        latest.positionSeconds,
        latest.durationSeconds,
        true,
      ).catch(() => undefined);
    }
    if (manualSwitchGeneration === manualSourceSwitchGenerationRef.current) {
      playback.selectSource(sourceId);
    }
  };

  const activeSubtitle = subtitleCues
    .filter((cue) => cue.startSeconds <= playbackPosition && playbackPosition < cue.endSeconds)
    .map((cue) => cue.text)
    .join('\n');

  const selectedEmbeddedSubtitle = embeddedSubtitleTracks.find(
    (track) => track.id === selectedEmbeddedSubtitleTrackId,
  );
  const subtitleButtonLabel = playback.subtitleLoading
    ? '…'
    : playback.selectedSubtitle
      ? playback.selectedSubtitle.language.toUpperCase()
      : !subtitlesOff && selectedEmbeddedSubtitle
        ? selectedEmbeddedSubtitle.language.toUpperCase()
        : t('playback.off');

  const selectedAudioTrack = audioTracks.find((track) => track.id === selectedAudioTrackId);
  // Always name what is playing, even with a single track: hiding the control
  // when only one track exists made the feature look missing entirely.
  const audioButtonLabel = selectedAudioTrack
    ? selectedAudioTrack.language.toUpperCase()
    : audioTracks.length > 1
      ? t('playback.trackCount').replace('{count}', String(audioTracks.length))
      : t('playback.defaultTrack');


  const nextEpisodeButtonLabel = playback.nextEpisode
    ? `${t('playback.nextEpisode')} · S${playback.nextEpisode.seasonNumber}E${playback.nextEpisode.episodeNumber}`
    : t('playback.nextEpisode');

  const mediaTitle = activeMedia?.title ?? source.name ?? source.providerId ?? 'MoviesTv-Flix';
  // The picture names a series big and the episode underneath, so the player
  // does the same: "Modern Family" / "S3 E17 • J'ai 10 ans !".
  const titleParts = mediaTitle.split('·').map((part) => part.trim()).filter(Boolean);
  const playerTitle = activeMedia?.kind === 'episode'
    ? (titleParts[0] ?? mediaTitle)
    : mediaTitle;
  const playerMeta = activeMedia?.kind === 'episode'
    ? [
      activeMedia.seasonNumber && activeMedia.episodeNumber
        ? `S${activeMedia.seasonNumber} E${activeMedia.episodeNumber}`
        : null,
      titleParts.length > 2 ? titleParts.slice(2).join(' · ') : titleParts[1] ?? null,
    ].filter(Boolean).join(' • ')
    : undefined;

  const sourceContext = [
    source.quality,
    source.codec?.toUpperCase(),
    source.providerId,
  ].filter(Boolean).join(' · ');

  return (
    <View
        aria-modal={true}
        testID="playback-overlay"
        style={[styles.overlay, styles.playerOverlay]}
      >
      <ReadyPlayer
        key={playbackSourceFingerprint(source)}
        source={source}
        initialPositionSeconds={initialPositionSeconds}
        onProgress={handleProgress}
        onEnded={handleEnded}
        onPlaybackError={(message) => handlePlaybackError(source, message)}
        preferredAudioLanguages={preferences.preferredAudioLanguages}
        preferredSubtitleLanguages={preferences.preferredSubtitleLanguages}
        embeddedSubtitlesEnabled={
          !subtitlesOff && playback.selectedSubtitle === null
        }
        selectedAudioTrackId={selectedAudioTrackId}
        onAudioTracksChange={handleAudioTracksChange}
        selectedEmbeddedSubtitleTrackId={selectedEmbeddedSubtitleTrackId}
        onEmbeddedSubtitleTracksChange={handleEmbeddedSubtitleTracksChange}
        onControlsVisibilityChange={setPlayerChromeVisible}
        onOpenAudio={() => {
          playback.closeSourceChooser();
          playback.closeSubtitleChooser();
          setAudioChooserOpen(true);
        }}
        audioLabel={audioButtonLabel}
        onOpenSubtitles={() => {
          setAudioChooserOpen(false);
          playback.openSubtitleChooser();
        }}
        subtitleLabel={subtitleButtonLabel}
        onOpenSource={() => {
          setAudioChooserOpen(false);
          playback.openSourceChooser();
        }}
        sourceLabel={sourceContext}
        onDownload={playback.state.sources.some((candidate) => canDownloadSource(candidate))
          ? () => setDownloadChooserOpen(true)
          : undefined}
        downloadLabel={playback.state.sources.some((candidate) => canDownloadSource(candidate))
          ? t('downloads.chooseQuality')
          : undefined}
        onNextEpisode={playback.nextEpisode
          ? () => { void playback.playNextEpisode().catch(() => false); }
          : undefined}
        nextEpisodeLabel={playback.nextEpisode ? nextEpisodeButtonLabel : undefined}
        title={playerTitle}
        meta={playerMeta}
        submeta={sourceContext}
        locked={playerLocked}
        onToggleLock={() => setPlayerLocked(false)}
        skipIntroEnabled={playerPreferences.skipIntroEnabled}
        imdbId={activeMedia?.externalIds?.imdb ?? undefined}
        seasonNumber={activeMedia?.seasonNumber}
        episodeNumber={activeMedia?.episodeNumber}
      />
      {upNextSeconds !== null && playback.nextEpisode ? (
        <View
          testID="player-up-next"
          style={[styles.upNextCard, { bottom: safeInsetEdge(120, safeAreaInsets.bottom, 104) }]}
        >
          <View style={styles.upNextCopy}>
            <Text style={styles.upNextLabel}>
              {t('playback.upNextIn', { seconds: upNextSeconds })}
            </Text>
            <Text numberOfLines={2} style={styles.upNextTitle}>
              {playback.nextEpisode.title}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            testID="player-up-next-cancel"
            onPress={() => setUpNextSeconds(null)}
            style={({ pressed }) => [styles.upNextButton, pressed && styles.pressed]}
          >
            <Text style={styles.upNextButtonText}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            testID="player-up-next-play"
            onPress={() => setUpNextSeconds(0)}
            style={({ pressed }) => [
              styles.upNextButton,
              styles.upNextButtonPrimary,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.upNextButtonText, styles.upNextButtonTextPrimary]}>
              {t('playback.playNow')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {playerChromeVisible && !playerLocked ? (
      <LinearGradient
        pointerEvents="box-none"
        colors={['rgba(0,0,0,0.85)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0)']}
        style={[
          styles.playerHeader,
          {
            // Floor of 44 pt: if the inset reads as 0 (provider not resolved yet)
            // the title still clears the Dynamic Island.
            paddingTop: Math.max(44, safeInsetEdge(16, safeAreaInsets.top, 8)),
            paddingLeft: safeInsetEdge(22, safeAreaInsets.left, 12),
            paddingRight: safeInsetEdge(22, safeAreaInsets.right, 12),
          },
        ]}
      >
        {/* The title moved to the bottom of the picture; this bar is only
            controls, so the film keeps the top of the frame. */}
        <View style={styles.playerHeaderCopy} />
        <OverlayIconButton
          icon="lock-closed"
          accessibilityLabel={t('playback.lockControls')}
          testID="player-lock"
          onPress={() => setPlayerLocked(true)}
        />
        <OverlayIconButton
          icon="close"
          accessibilityLabel={t('playback.close')}
          testID="player-close"
          onPress={closeWithProgress}
        />
      </LinearGradient>
      ) : null}

      {activeSubtitle ? (
        <View
          pointerEvents="none"
          style={[
            styles.subtitleLayer,
            {
              // The user's vertical offset rides on top of the safe-area floor.
              bottom: safeInsetEdge(148, safeAreaInsets.bottom, 132)
                + (subtitleStyle?.offset ?? 0),
            },
          ]}
        >
          <Text
            style={[styles.subtitleText, subtitleStyle ? subtitleMetrics(subtitleStyle) : null]}
          >
            {activeSubtitle}
          </Text>
        </View>
      ) : null}

      {downloadStartError || failedDownloadJob?.error || playbackError || subtitleError ? (
        <View
          pointerEvents="none"
          style={[
            styles.errorBanner,
            {
              bottom: safeInsetEdge(132, safeAreaInsets.bottom, 116),
            },
          ]}
        >
          <Text style={styles.errorBannerText}>
            {downloadStartError ?? failedDownloadJob?.error ?? playbackError ?? subtitleError}
          </Text>
        </View>
      ) : null}
      {downloadChooserOpen ? (
        <DownloadChooser
          sources={playback.state.sources}
          selectedSourceId={playback.state.selectedSourceId}
          onSelect={(chosen) => {
            setDownloadChooserOpen(false);
            void startDownload(chosen);
          }}
          onClose={() => setDownloadChooserOpen(false)}
        />
      ) : null}
      {playback.sourceChooserOpen ? (
        <SourceChooser
          sources={playback.state.sources}
          selectedSourceId={playback.state.selectedSourceId}
          onSelect={selectSource}
          onClose={playback.closeSourceChooser}
        />
      ) : null}
      {playback.subtitleChooserOpen ? (
        <SubtitleChooser
          externalTracks={playback.subtitleTracks}
          embeddedTracks={embeddedSubtitleTracks}
          selectedExternalSubtitleId={playback.selectedSubtitle?.id ?? null}
          selectedEmbeddedSubtitleId={selectedEmbeddedSubtitleTrackId}
          subtitlesOff={subtitlesOff}
          onSelectExternal={(subtitleId) => {
            setSubtitlesOff(false);
            setSelectedEmbeddedSubtitleTrackId(null);
            playback.selectSubtitle(subtitleId);
          }}
          onSelectEmbedded={(subtitleId) => {
            playback.selectSubtitle(null);
            setSubtitlesOff(false);
            setSelectedEmbeddedSubtitleTrackId(subtitleId);
          }}
          onSelectOff={() => {
            playback.selectSubtitle(null);
            setSubtitlesOff(true);
            setSelectedEmbeddedSubtitleTrackId(null);
          }}
          onClose={playback.closeSubtitleChooser}
        />
      ) : null}
      {audioChooserOpen ? (
        <AudioChooser
          tracks={audioTracks}
          selectedTrackId={selectedAudioTrackId}
          onSelect={(trackId) => {
            setSelectedAudioTrackId(trackId);
            audioMemoryRef.current = trackId;
            if (source) void rememberAudioTrack(playbackSourceFingerprint(source), trackId);
            setAudioChooserOpen(false);
          }}
          onClose={() => setAudioChooserOpen(false)}
          onFindSources={() => {
            // Language is a property of the source, not of a track inside it, so
            // the only way to get another language is another source.
            setAudioChooserOpen(false);
            playback.openSourceChooser();
          }}
        />
      ) : null}
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.colors.background,
    zIndex: 1000,
    elevation: 1000,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  playerOverlay: {
    padding: 0,
    backgroundColor: '#000000',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  },
  stateCard: {
    minWidth: 280,
    maxWidth: 620,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.xl,
  },
  stateTitle: {
    color: theme.colors.text,
    fontFamily: fontFamily.display,
    fontSize: 21,
    textAlign: 'center',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: theme.spacing.md },
  playerHeader: {
    position: 'absolute',
    zIndex: 1120,
    top: 0,
    left: 0,
    right: 0,
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 22,
  },
  upNextCard: {
    position: 'absolute',
    right: 20,
    zIndex: 1300,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 520,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(10,10,14,0.92)',
  },
  upNextCopy: { flexShrink: 1, gap: 2, paddingRight: 4 },
  upNextLabel: {
    color: 'rgba(255,255,255,0.68)',
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  upNextTitle: { color: '#ffffff', fontFamily: fontFamily.uiMedium, fontSize: 14 },
  upNextButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  upNextButtonPrimary: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  upNextButtonText: { color: '#ffffff', fontFamily: fontFamily.uiSemiBold, fontSize: 12 },
  upNextButtonTextPrimary: { color: '#0b0b0f' },
  playerHeaderCopy: { flex: 1, minWidth: 0 },
  playerMediaTitle: {
    color: '#ffffff',
    fontFamily: fontFamily.display,
    fontSize: 19,
    lineHeight: 24,
    letterSpacing: -0.2,
  },
  playerMediaMeta: {
    color: 'rgba(255,255,255,0.62)',
    fontFamily: fontFamily.uiMedium,
    fontSize: 10.5,
    letterSpacing: 0.4,
    marginTop: 4,
  },
  subtitleLayer: {
    position: 'absolute',
    left: '8%',
    right: '8%',
    bottom: 148,
    alignItems: 'center',
    zIndex: 1100,
  },
  subtitleText: {
    maxWidth: 920,
    color: '#ffffff',
    fontFamily: fontFamily.uiMedium,
    fontSize: 21,
    lineHeight: 28,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.95)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.46)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 5,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIconButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  utilityBar: {
    position: 'absolute',
    zIndex: 1120,
    left: 16,
    right: 16,
    bottom: 78,
    alignItems: 'center',
  },
  utilityActions: {
    maxWidth: 980,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(10,10,13,0.76)',
  },
  button: { minHeight: 44, justifyContent: 'center', borderWidth: 2, borderColor: theme.colors.border, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, paddingHorizontal: 18, paddingVertical: 10 },
  buttonCompact: { minHeight: 38, paddingHorizontal: 13, paddingVertical: 8 },
  buttonPrimary: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  buttonText: {
    color: theme.colors.text,
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 13,
  },
  buttonTextPrimary: { color: '#09090b', fontFamily: fontFamily.uiSemiBold },
  focused: { borderColor: theme.colors.focus },
  pressed: { opacity: 0.72 },
  errorBanner: {
    position: 'absolute',
    zIndex: 1140,
    left: '8%',
    right: '8%',
    bottom: 132,
    alignItems: 'center',
  },
  errorBannerText: {
    maxWidth: 760,
    color: '#ffffff',
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    backgroundColor: 'rgba(160,30,38,0.9)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});

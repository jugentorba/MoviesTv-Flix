import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import {
  useVideoPlayer,
  VideoView,
  type AudioTrack as ExpoAudioTrack,
  type SubtitleTrack as ExpoSubtitleTrack,
} from 'expo-video';
import type { AudioTrack, EmbeddedSubtitleTrack, StreamSource } from '@moviestv/core';
import { fontFamily, type Theme } from '@moviestv/ui';
import { type BufferMode, expoForwardBufferSeconds, readBufferMode } from './bufferMode';
import Ionicons from '@expo/vector-icons/Ionicons';
import { isPictureInPictureSupported } from 'expo-video';
import { preferredLanguageTrackIndex } from './preferredTrack';
import { usePlayerOrientation } from './usePlaybackOrientation';
import { useSafeVideoFrame } from './useSafeVideoFrame';
import { PlayerChrome, type PlayerAction } from './PlayerChrome';
import { useHoldSpeed } from './useHoldSpeed';
import { usePlayerSliders } from './usePlayerSliders';
import { useSkipSegments } from './useSkipSegments';
import { PlayerSliderIndicator } from './PlayerSliderIndicator';
import { toEngineVolume } from './playerGestureMath';
import { loadBrightness } from './nativeModules';
import {
  nativeVideoSourceSignature,
  toNativeVideoSource,
} from './nativeVideoSource';
import { safeNativePlaybackErrorMessage, safePlaybackErrorMessage } from './playbackError';
import { useI18n } from '../i18n/useI18n';
import {
  nextPlaybackRate,
  toggleVideoFitMode,
  type VideoFitMode,
} from './playerControlState';
import { useThemeStyles } from '../theme/ThemeProvider';

type VideoViewPlayer = React.ComponentProps<typeof VideoView>['player'];
type VideoViewHandle = InstanceType<typeof VideoView>;

type NativeAudioTrackLike = {
  id?: string | null;
  language?: string | null;
  label?: string | null;
  name?: string | null;
};

function audioTrackId(
  track: NativeAudioTrackLike,
  index: number,
): string {
  const language = track.language || 'und';
  const label = track.name ?? track.label ?? 'track';
  return `embedded-audio:${track.id ?? `${language}:${label}:${index}`}`;
}

function mapAudioTracks(
  tracks: readonly NativeAudioTrackLike[],
): AudioTrack[] {
  return tracks.map((track, index) => ({
    id: audioTrackId(track, index),
    language: track.language || 'und',
    label: track.name ?? track.label ?? track.language ?? `Track ${index + 1}`,
  }));
}

/**
 * Chooses the track list to work from.
 *
 * AVPlayer resolves its media selection groups after the item loads, so a
 * native event can carry an empty list while the player property is still the
 * only source of tracks — and the reverse happens when the event arrives first.
 * Prefer whichever list is non-empty; a genuinely empty answer still wins when
 * both are empty.
 */
function pickTrackList<T>(
  snapshot: readonly T[] | undefined,
  playerTracks: readonly T[] | undefined,
): readonly T[] {
  if (Array.isArray(snapshot) && snapshot.length > 0) return snapshot;
  if (Array.isArray(playerTracks) && playerTracks.length > 0) return playerTracks;
  if (Array.isArray(snapshot)) return snapshot;
  if (Array.isArray(playerTracks)) return playerTracks;
  return [];
}

function subtitleTrackId(
  track: NativeAudioTrackLike,
  index: number,
): string {
  const language = track.language || 'und';
  const label = track.name ?? track.label ?? 'track';
  return `embedded-subtitle:${track.id ?? `${language}:${label}:${index}`}`;
}

function mapSubtitleTracks(
  tracks: readonly NativeAudioTrackLike[],
): EmbeddedSubtitleTrack[] {
  return tracks.map((track, index) => ({
    id: subtitleTrackId(track, index),
    language: track.language || 'und',
    label: track.name ?? track.label ?? track.language ?? `Track ${index + 1}`,
  }));
}


export function ExpoVideoSurface({
  source,
  testID,
  initialPositionSeconds = 0,
  onProgress,
  onEnded,
  onPlaybackError,
  preferredAudioLanguages = [],
  preferredSubtitleLanguages = [],
  embeddedSubtitlesEnabled = false,
  selectedAudioTrackId = null,
  onAudioTracksChange,
  selectedEmbeddedSubtitleTrackId = null,
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
  locked = false,
  onToggleLock,
  imdbId,
  seasonNumber,
  episodeNumber,
  skipIntroEnabled = true,
}: {
  source: StreamSource;
  testID?: string;
  initialPositionSeconds?: number;
  onProgress?(positionSeconds: number, durationSeconds: number): void;
  onEnded?(): void;
  onPlaybackError?(message?: string): void;
  preferredAudioLanguages?: readonly string[];
  preferredSubtitleLanguages?: readonly string[];
  embeddedSubtitlesEnabled?: boolean;
  selectedAudioTrackId?: string | null;
  onAudioTracksChange?(tracks: AudioTrack[], selectedTrackId: string | null): void;
  selectedEmbeddedSubtitleTrackId?: string | null;
  onEmbeddedSubtitleTracksChange?(
    tracks: EmbeddedSubtitleTrack[],
    selectedTrackId: string | null,
  ): void;
  onControlsVisibilityChange?(visible: boolean): void;
  /**
   * Actions owned by the player overlay. They live in this menu so the player
   * has exactly one place to act from, instead of a header row plus a menu.
   */
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
  /** Bottom-left block: series name, episode line, quality/provider line. */
  title?: string;
  meta?: string;
  submeta?: string;
  /** When locked, every control hides and only an unlock target remains. */
  locked?: boolean;
  onToggleLock?(): void;
  /** IntroDB lookup target; absent for sources without an IMDb id. */
  imdbId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  skipIntroEnabled?: boolean;
}) {
  const styles = useThemeStyles(createStyles);
  const { t } = useI18n();
  const safeAreaInsets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const initialAppliedRef = useRef(false);
  const videoViewRef = useRef<VideoViewHandle | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  // Show the whole frame by default; 'cover' cropped 16:9 films.
  const [contentFit, setContentFit] = useState<VideoFitMode>('contain');
  // Portrait letterboxes a 16:9 film into a sliver; playback rotates instead.
  const { orientation, toggleOrientation } = usePlayerOrientation(true);
  // Keeps the picture clear of the notch / Dynamic Island / punch-hole.
  const videoFrame = useSafeVideoFrame();
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  // Opening the menu is the moment the user needs the real track list, so ask
  // the engine again instead of trusting whatever was parsed at start-up.
  const applyPreferredTracksRef = useRef<(() => void) | null>(null);
  const [bufferMode, setBufferMode] = useState<BufferMode>('balanced');
  const bufferModeRef = useRef<BufferMode>('balanced');
  const lastTapRef = useRef<{ at: number; zone: 'left' | 'right' | 'center' } | null>(null);
  const holdSpeed = useHoldSpeed(playbackRate, setPlaybackRate);
  const [brightness, setBrightness] = useState(0.5);
  const [volume, setVolume] = useState(1);
  const [surfaceSize, setSurfaceSize] = useState({ width: 1, height: 1 });

  // App brightness, not the system setting: no WRITE_SETTINGS prompt on
  // Android, and the value is restored when the player closes.
  const brightnessAtOpenRef = useRef<number | null>(null);
  useEffect(() => {
    const brightnessModule = loadBrightness();
    if (!brightnessModule) return undefined;
    let active = true;
    void brightnessModule.getBrightnessAsync()
      .then((value) => {
        if (!active || !Number.isFinite(value)) return;
        brightnessAtOpenRef.current = value;
        setBrightness(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      const restore = brightnessAtOpenRef.current;
      if (restore !== null) {
        void brightnessModule.setBrightnessAsync(restore).catch(() => undefined);
      }
    };
  }, []);

  const sliders = usePlayerSliders({
    brightness,
    volume,
    width: surfaceSize.width,
    height: surfaceSize.height,
    enabled: !locked,
    onBrightness: (value) => {
      setBrightness(value);
      const brightnessModule = loadBrightness();
      if (brightnessModule) {
        void brightnessModule.setBrightnessAsync(value).catch(() => undefined);
      }
    },
    onVolume: setVolume,
  });
  // Guarded: the capability probe is a native call, and older or mocked builds
  // of expo-video do not expose it.
  const [pictureInPictureSupported] = useState(
    () => typeof isPictureInPictureSupported === 'function' && isPictureInPictureSupported(),
  );
  const sourceFailedRef = useRef(false);
  const endedRef = useRef(false);
  const resumeAfterForegroundRef = useRef(false);
  const sourceGenerationRef = useRef(0);
  const lastExplicitSourceSignatureRef = useRef<string | null>(null);
  const audioTracksRef = useRef<readonly ExpoAudioTrack[] | undefined>(undefined);
  const subtitleTracksRef = useRef<readonly ExpoSubtitleTrack[] | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void readBufferMode().then((mode) => {
      if (!active) return;
      bufferModeRef.current = mode;
      setBufferMode(mode);
    });
    return () => { active = false; };
  }, []);

  const player = useVideoPlayer(
    toNativeVideoSource(source, Platform.OS),
    (instance) => {
      instance.timeUpdateEventInterval = 1;
      instance.bufferOptions = {
        preferredForwardBufferDuration: expoForwardBufferSeconds(bufferModeRef.current),
      };
      if (initialPositionSeconds > 0) {
        instance.currentTime = initialPositionSeconds;
        initialAppliedRef.current = true;
      }
      if (AppState.currentState !== 'background'
          && AppState.currentState !== 'inactive') {
        instance.play();
      } else {
        resumeAfterForegroundRef.current = true;
      }
    },
  );

  useEffect(() => {
    try {
      player.volume = toEngineVolume(volume, 'expo');
    } catch {
      // Older engines ignore volume; playback still works.
    }
  }, [player, volume]);

  useEffect(() => {
    try {
      player.bufferOptions = {
        preferredForwardBufferDuration: expoForwardBufferSeconds(bufferMode),
      };
    } catch {
      // Older engines ignore buffer options; playback still works.
    }
  }, [bufferMode, player]);

  const applyPreferredTracks = useCallback((
    audioTracksOverride?: readonly ExpoAudioTrack[],
    subtitleTracksOverride?: readonly ExpoSubtitleTrack[],
  ) => {
    // Native events can arrive before the player's track properties update.
    // Retain their snapshot across parent renders and selection changes.
    if (audioTracksOverride !== undefined) audioTracksRef.current = audioTracksOverride;
    if (subtitleTracksOverride !== undefined) subtitleTracksRef.current = subtitleTracksOverride;
    const audioTracks = pickTrackList(
      audioTracksRef.current,
      player.availableAudioTracks,
    );
    const mappedAudioTracks = mapAudioTracks(audioTracks);
    let audioIndex = selectedAudioTrackId
      ? mappedAudioTracks.findIndex((track) => track.id === selectedAudioTrackId)
      : -1;

    if (audioIndex < 0) {
      audioIndex = preferredLanguageTrackIndex(audioTracks, preferredAudioLanguages);
    }
    if (audioIndex < 0 && audioTracks.length > 0) audioIndex = 0;

    if (audioIndex >= 0 && audioTracks[audioIndex]) {
      player.audioTrack = audioTracks[audioIndex];
      onAudioTracksChange?.(
        mappedAudioTracks,
        mappedAudioTracks[audioIndex]?.id ?? null,
      );
    } else {
      onAudioTracksChange?.(mappedAudioTracks, null);
    }

    const subtitleTracks = pickTrackList(
      subtitleTracksRef.current,
      player.availableSubtitleTracks,
    );
    const mappedSubtitleTracks = mapSubtitleTracks(subtitleTracks);

    if (!embeddedSubtitlesEnabled) {
      player.subtitleTrack = null;
      onEmbeddedSubtitleTracksChange?.(mappedSubtitleTracks, null);
      return;
    }

    let subtitleIndex = selectedEmbeddedSubtitleTrackId
      ? mappedSubtitleTracks.findIndex(
        (track) => track.id === selectedEmbeddedSubtitleTrackId,
      )
      : -1;

    if (subtitleIndex < 0) {
      subtitleIndex = preferredLanguageTrackIndex(
        subtitleTracks,
        preferredSubtitleLanguages,
      );
    }
    if (subtitleIndex < 0 && subtitleTracks.length > 0) subtitleIndex = 0;

    player.subtitleTrack = subtitleIndex >= 0
      ? subtitleTracks[subtitleIndex] ?? null
      : null;
    onEmbeddedSubtitleTracksChange?.(
      mappedSubtitleTracks,
      mappedSubtitleTracks[subtitleIndex]?.id ?? null,
    );
  }, [
    embeddedSubtitlesEnabled,
    onAudioTracksChange,
    onEmbeddedSubtitleTracksChange,
    player,
    preferredAudioLanguages,
    preferredSubtitleLanguages,
    selectedAudioTrackId,
    selectedEmbeddedSubtitleTrackId,
  ]);


  useEffect(() => {
    player.playbackRate = playbackRate;
    player.preservesPitch = true;
  }, [playbackRate, player]);

  useEffect(() => {
    onControlsVisibilityChange?.(controlsVisible);
  }, [controlsVisible, onControlsVisibilityChange]);

  useEffect(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (controlsVisible && playing) {
      hideTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3200);
    }

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [controlsVisible, playing]);

  const sourceResetSignature = nativeVideoSourceSignature(
    source,
    Platform.OS,
  );

  useEffect(() => {
    sourceGenerationRef.current += 1;
    audioTracksRef.current = undefined;
    subtitleTracksRef.current = undefined;
    initialAppliedRef.current = false;
    sourceFailedRef.current = false;
    endedRef.current = false;
    resumeAfterForegroundRef.current = (
      AppState.currentState === 'background'
      || AppState.currentState === 'inactive'
    );
    setPosition(0);
    setDuration(0);
    setControlsVisible(true);
  }, [sourceResetSignature]);

  useEffect(() => {
    const previousSignature = lastExplicitSourceSignatureRef.current;
    lastExplicitSourceSignatureRef.current = sourceResetSignature;
    if (previousSignature === null || previousSignature === sourceResetSignature) {
      return undefined;
    }

    let active = true;
    const nextSource = toNativeVideoSource(source, Platform.OS);

    void player.replaceAsync(nextSource)
      .then(() => {
        if (!active || sourceFailedRef.current || endedRef.current) return;
        if (initialPositionSeconds > 0) {
          player.currentTime = initialPositionSeconds;
          initialAppliedRef.current = true;
          setPosition(initialPositionSeconds);
        }
        if (AppState.currentState !== 'background'
          && AppState.currentState !== 'inactive') {
          resumeAfterForegroundRef.current = false;
          player.play();
        } else {
          resumeAfterForegroundRef.current = true;
        }
      })
      .catch((error: unknown) => {
        if (!active || sourceFailedRef.current || endedRef.current) return;
        sourceFailedRef.current = true;
        setPlaying(false);
        setControlsVisible(true);
        onPlaybackError?.(
          safePlaybackErrorMessage(
            error instanceof Error ? error.message : error,
            'Video source failed',
          ),
        );
      });

    return () => {
      active = false;
    };
  }, [
    initialPositionSeconds,
    onPlaybackError,
    player,
    source,
    sourceResetSignature,
  ]);



  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (
          resumeAfterForegroundRef.current
          && !sourceFailedRef.current
          && !endedRef.current
        ) {
          resumeAfterForegroundRef.current = false;
          player.play();
        }
        return;
      }

      const wasPlaying = Boolean(player.playing);
      resumeAfterForegroundRef.current = wasPlaying;
      if (wasPlaying) player.pause();
    });

    return () => subscription.remove();
  }, [player, sourceResetSignature]);

  useEffect(() => {
    if (initialAppliedRef.current || initialPositionSeconds <= 0) return;
    player.currentTime = initialPositionSeconds;
    initialAppliedRef.current = true;
    setPosition(initialPositionSeconds);
  }, [initialPositionSeconds, player]);

  useEffect(() => {
    const generation = sourceGenerationRef.current;
    applyPreferredTracks();
    const sourceSubscription = player.addListener('sourceLoad', (payload) => {
      if (
        generation !== sourceGenerationRef.current
        || endedRef.current
      ) return;
      sourceFailedRef.current = false;
      endedRef.current = false;
      const nextDuration = Number.isFinite(payload?.duration)
        ? payload!.duration
        : Number.isFinite(player.duration)
          ? player.duration
          : 0;
      setDuration(nextDuration);
      applyPreferredTracks(
        payload?.availableAudioTracks,
        payload?.availableSubtitleTracks,
      );
    });
    const audioTracksSubscription = player.addListener(
      'availableAudioTracksChange',
      (payload) => {
        if (
          generation !== sourceGenerationRef.current
          || sourceFailedRef.current
          || endedRef.current
        ) return;
        applyPreferredTracks(payload?.availableAudioTracks);
      },
    );
    const subtitleTracksSubscription = player.addListener(
      'availableSubtitleTracksChange',
      (payload) => {
        if (
          generation !== sourceGenerationRef.current
          || sourceFailedRef.current
          || endedRef.current
        ) return;
        applyPreferredTracks(
          undefined,
          payload?.availableSubtitleTracks,
        );
      },
    );

    return () => {
      sourceSubscription.remove();
      audioTracksSubscription.remove();
      subtitleTracksSubscription.remove();
    };
  }, [applyPreferredTracks, player, sourceResetSignature]);

  useEffect(() => {
    const generation = sourceGenerationRef.current;
    player.timeUpdateEventInterval = 1;
    const timeSubscription = player.addListener('timeUpdate', ({ currentTime }) => {
      if (
        generation !== sourceGenerationRef.current
        || sourceFailedRef.current
        || endedRef.current
      ) return;
      if (!Number.isFinite(currentTime) || currentTime < 0) return;
      const nextDuration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 0;
      const safeCurrentTime = nextDuration > 0 ? Math.min(currentTime, nextDuration) : currentTime;
      setPosition(safeCurrentTime);
      setDuration(nextDuration);
      onProgress?.(safeCurrentTime, nextDuration);
    });
    const playingSubscription = player.addListener('playingChange', ({ isPlaying }) => {
      if (generation !== sourceGenerationRef.current) return;
      if ((sourceFailedRef.current || endedRef.current) && isPlaying) return;
      setPlaying(isPlaying);
    });
    const endSubscription = player.addListener('playToEnd', () => {
      if (
        generation !== sourceGenerationRef.current
        || endedRef.current
        || sourceFailedRef.current
      ) return;
      endedRef.current = true;
      const nextDuration = Number.isFinite(player.duration) ? player.duration : 0;
      setPosition(nextDuration);
      onProgress?.(nextDuration, nextDuration);
      onEnded?.();
      setControlsVisible(true);
    });
    const statusSubscription = player.addListener('statusChange', ({ status, error }) => {
      if (generation !== sourceGenerationRef.current || endedRef.current) return;
      if (status === 'readyToPlay') {
        // Media selection groups can resolve after `sourceLoad`, which is the
        // last point where the audio chooser would otherwise stay empty.
        if (!sourceFailedRef.current) applyPreferredTracks();
        return;
      }
      if (
        status !== 'error'
        || sourceFailedRef.current
      ) return;
      sourceFailedRef.current = true;
      setPlaying(false);
      setControlsVisible(true);
      onPlaybackError?.(
        safeNativePlaybackErrorMessage(error?.message, 'Video source failed'),
      );
    });

    return () => {
      timeSubscription.remove();
      playingSubscription.remove();
      endSubscription.remove();
      statusSubscription.remove();
    };
  }, [
    onEnded,
    onPlaybackError,
    onProgress,
    player,
    sourceResetSignature,
  ]);

  const togglePlayback = useCallback(() => {
    if (sourceFailedRef.current || endedRef.current) return;
    if (player.playing) player.pause();
    else player.play();
    setControlsVisible(true);
  }, [player]);

  const seekBy = useCallback((seconds: number) => {
    if (sourceFailedRef.current || endedRef.current) return;
    const current = Number.isFinite(player.currentTime) ? player.currentTime : 0;
    const target = Math.max(0, current + seconds);
    const next = Number.isFinite(player.duration) && player.duration > 0
      ? Math.min(player.duration, target)
      : target;
    player.currentTime = next;
    setPosition(next);
    setControlsVisible(true);
  }, [player]);

  const seekToRatio = useCallback((ratio: number) => {
    if (sourceFailedRef.current || endedRef.current) return;
    if (!Number.isFinite(ratio) || duration <= 0) return;
    const next = Math.max(0, Math.min(duration, duration * ratio));
    player.currentTime = next;
    setPosition(next);
    onProgress?.(next, duration);
    setControlsVisible(true);
  }, [duration, onProgress, player]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    player.muted = next;
    setMuted(next);
    setControlsVisible(true);
  }, [muted, player]);

  const cyclePlaybackRate = useCallback(() => {
    setPlaybackRate((current) => nextPlaybackRate(current));
    setControlsVisible(true);
  }, []);

  const toggleContentFit = useCallback(() => {
    setContentFit(toggleVideoFitMode);
    setControlsVisible(true);
  }, []);

  /**
   * One tap toggles the chrome; a double tap in the left or right third seeks
   * ten seconds, which is the gesture every modern player has.
   */
  const handleSurfacePress = useCallback((event: { nativeEvent?: { locationX?: number } }) => {
    const x = event.nativeEvent?.locationX;
    const width = surfaceWidth > 0 ? surfaceWidth : 0;
    if (typeof x !== 'number' || width <= 0) {
      setControlsVisible((visible) => !visible);
      return;
    }
    const zone: 'left' | 'right' | 'center' = x < width * 0.35
      ? 'left'
      : x > width * 0.65
        ? 'right'
        : 'center';
    const now = Date.now();
    const last = lastTapRef.current;
    lastTapRef.current = { at: now, zone };
    if (last && zone !== 'center' && last.zone === zone && now - last.at < 320) {
      lastTapRef.current = null;
      seekBy(zone === 'left' ? -10 : 10);
      return;
    }
    setControlsVisible((visible) => !visible);
  }, [seekBy, surfaceWidth]);

  /** Hold to play at 2x, release to return to the chosen rate. */
  const enterPictureInPicture = useCallback(() => {
    void videoViewRef.current?.startPictureInPicture().catch(() => undefined);
  }, []);

  const enterFullscreen = useCallback(() => {
    void videoViewRef.current?.enterFullscreen().catch(() => undefined);
  }, []);

  const skip = useSkipSegments({
    imdbId,
    season: seasonNumber,
    episode: episodeNumber,
    enabled: skipIntroEnabled,
    position,
    onSeek: (seconds) => {
      player.currentTime = seconds;
      setPosition(seconds);
      onProgress?.(seconds, duration);
      setControlsVisible(true);
    },
  });
  const skipLabel = skip.segment
    ? t(`playback.skip${skip.segment.kind.charAt(0).toUpperCase()}${skip.segment.kind.slice(1)}`)
    : undefined;

  // Everything the old ⋯ sheet held, as icons with their state visible.
  const actions: PlayerAction[] = [];
  if (onOpenAudio) {
    actions.push({
      key: 'audio',
      icon: 'musical-notes',
      label: 'Audio',
      accessibilityLabel: audioLabel ?? 'Audio track',
      testID: 'player-audio',
      // The chooser is where the real track list matters.
      onPress: () => { applyPreferredTracksRef.current?.(); onOpenAudio(); },
    });
  }
  if (onOpenSubtitles) {
    actions.push({
      key: 'subtitles',
      icon: 'language',
      label: 'Subs',
      accessibilityLabel: subtitleLabel ?? 'Subtitles',
      testID: 'player-subtitles',
      onPress: onOpenSubtitles,
    });
  }
  if (onOpenSource) {
    actions.push({
      key: 'source',
      icon: 'albums',
      label: 'Source',
      accessibilityLabel: sourceLabel ?? 'Change source',
      testID: 'player-source',
      onPress: onOpenSource,
    });
  }
  if (onNextEpisode && nextEpisodeLabel) {
    actions.push({
      key: 'next',
      icon: 'play-skip-forward',
      label: 'Next',
      accessibilityLabel: nextEpisodeLabel,
      testID: 'player-next-episode',
      onPress: onNextEpisode,
    });
  }
  if (onDownload) {
    actions.push({
      key: 'download',
      icon: 'cloud-download',
      label: 'Save',
      accessibilityLabel: downloadLabel ?? 'Download',
      testID: 'player-download',
      onPress: onDownload,
    });
  }
  actions.push(
    {
      key: 'speed',
      icon: 'speedometer',
      label: 'Speed',
      value: `${Number(playbackRate)}×`,
      accessibilityLabel: `Playback speed ${playbackRate}x`,
      testID: 'native-video-playback-rate',
      onPress: cyclePlaybackRate,
    },
    {
      key: 'fit',
      icon: contentFit === 'cover' ? 'contract' : 'expand',
      label: 'Fit',
      value: contentFit === 'cover' ? 'Fill' : 'Fit',
      active: contentFit === 'cover',
      accessibilityLabel: contentFit === 'contain' ? 'Fill screen' : 'Fit whole video',
      testID: 'native-video-content-fit',
      onPress: toggleContentFit,
    },
    {
      key: 'rotate',
      icon: orientation === 'landscape' ? 'phone-portrait' : 'phone-landscape',
      label: 'Rotate',
      accessibilityLabel: `Rotate to ${orientation === 'landscape' ? 'portrait' : 'landscape'}`,
      testID: 'native-video-rotate',
      onPress: () => { toggleOrientation(); setControlsVisible(true); },
    },
    {
      key: 'sound',
      icon: muted ? 'volume-mute' : 'volume-high',
      label: muted ? 'Muted' : 'Sound',
      active: muted,
      accessibilityLabel: muted ? 'Unmute' : 'Mute',
      testID: 'native-video-mute',
      onPress: toggleMute,
    },
    {
      key: 'hold',
      icon: 'flash',
      label: 'Hold 2×',
      accessibilityLabel: t('playback.holdSpeed'),
      testID: 'native-video-hold-speed',
      onPressIn: holdSpeed.begin,
      onPressOut: holdSpeed.end,
    },
    {
      key: 'fullscreen',
      icon: 'scan',
      label: 'Full',
      accessibilityLabel: t('playback.fullscreen'),
      testID: 'native-video-fullscreen',
      onPress: enterFullscreen,
    },
  );
  if (pictureInPictureSupported) {
    actions.push({
      key: 'pip',
      icon: 'copy',
      label: 'PiP',
      accessibilityLabel: t('playback.pictureInPicture'),
      testID: 'native-video-pip',
      onPress: enterPictureInPicture,
    });
  }


  return (
    <View
      style={styles.root}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSurfaceSize({
          width: Math.max(1, width),
          height: Math.max(1, height),
        });
      }}
      {...sliders.panHandlers}
    >
      <View
        testID={testID ? `${testID}-safe-frame` : undefined}
        style={[
          styles.videoFrame,
          {
            paddingTop: videoFrame.top,
            paddingRight: videoFrame.right,
            paddingBottom: videoFrame.bottom,
            paddingLeft: videoFrame.left,
          },
        ]}
      >
        <VideoView
          ref={videoViewRef}
          testID={testID}
          pointerEvents="none"
          style={styles.video}
          player={player as unknown as VideoViewPlayer}
          nativeControls={false}
          contentFit={contentFit}
          fullscreenOptions={{ enable: true }}
        />
      </View>

      <PlayerSliderIndicator
        indicator={sliders.indicator}
        insetsTop={Math.max(16, safeAreaInsets.top)}
      />

      {holdSpeed.active ? (
        <View pointerEvents="none" testID="hold-speed-badge" style={styles.holdBadge}>
          <Text style={styles.holdBadgeText}>2×</Text>
        </View>
      ) : null}

      {locked ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('playback.toggleControls')}
          testID={testID ? `${testID}-tap-surface` : undefined}
          onLayout={(event) => setSurfaceWidth(event.nativeEvent.layout.width)}
          onPress={handleSurfacePress}
          onLongPress={holdSpeed.begin}
          onPressOut={holdSpeed.end}
          delayLongPress={350}
          style={StyleSheet.absoluteFill}
        />
      )}

      {locked ? (
        <PlayerChrome
          title={title ?? source.name ?? 'MoviesTv-Flix'}
          meta={meta}
          submeta={submeta}
          position={position}
          duration={duration}
          actions={actions}
          insets={safeAreaInsets}
          locked
          onToggleLock={onToggleLock}
          onSeekRatio={seekToRatio}
        />
      ) : controlsVisible ? (
        <>
          <View pointerEvents="box-none" style={styles.centerControls}>
          <Pressable
            focusable
            accessibilityRole="button"
            accessibilityLabel="Back 10 seconds"
            onPress={() => seekBy(-10)}
            style={styles.centerSeekButton}
          >
            <View style={styles.seekGlyphRow}>
              <Ionicons name="arrow-undo" size={17} color="#ffffff" />
              <Text style={styles.centerSeekText}>10</Text>
            </View>
          </Pressable>
          <Pressable
            focusable
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause' : t('playback.play')}
            onPress={togglePlayback}
            style={styles.playButton}
          >
            <Ionicons name={playing ? 'pause' : 'play'} size={30} color="#0b0b0f" />
          </Pressable>
          <Pressable
            focusable
            accessibilityRole="button"
            accessibilityLabel="Forward 10 seconds"
            onPress={() => seekBy(10)}
            style={styles.centerSeekButton}
          >
            <View style={styles.seekGlyphRow}>
              <Text style={styles.centerSeekText}>10</Text>
              <Ionicons name="arrow-redo" size={17} color="#ffffff" />
            </View>
          </Pressable>
        </View>
          <PlayerChrome
            title={title ?? source.name ?? 'MoviesTv-Flix'}
            meta={meta}
            submeta={submeta}
            position={position}
            duration={duration}
            actions={actions}
            insets={safeAreaInsets}
            locked={locked}
            onToggleLock={onToggleLock}
            onSeekRatio={seekToRatio}
            skipLabel={skipLabel}
            onSkip={skip.segment ? skip.skip : undefined}
          />
        </>
      ) : null}
    </View>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  root: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
    position: 'relative',
    overflow: 'hidden',
  },
  videoFrame: {
    flex: 1,
    backgroundColor: '#000000',
  },
  holdBadge: {
    position: 'absolute',
    top: 18,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,14,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    zIndex: 30,
  },
  holdBadgeText: { color: '#ffffff', fontSize: 13, fontWeight: '900' },
  video: { width: '100%', height: '100%' },
  centerControls: {
    position: 'absolute',
    zIndex: 4,
    left: 0,
    right: 0,
    top: '42%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
  },
  centerSeekButton: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(12,12,15,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  seekGlyphRow: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  centerSeekText: {
    color: '#ffffff',
    fontFamily: fontFamily.uiSemiBold,
    fontSize: 13,
  },
  bottomControls: {
    position: 'absolute',
    zIndex: 4,
    left: 18,
    right: 18,
    bottom: 18,
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(8,8,11,0.88)',
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.accent,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 2,
  },
  textControlButton: {
    minWidth: 46,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 9,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  textControlText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  playButton: {
    width: 66,
    height: 66,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#ffffff',
  },
  iconText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
  fullscreenIcon: { color: '#ffffff', fontSize: 19, fontWeight: '900' },
  playIcon: { color: '#0a0a0c', fontSize: 23, fontWeight: '900' },
  timeText: { color: 'rgba(255,255,255,0.78)', fontSize: 12, fontWeight: '700' },
  flex: { flex: 1 },
});

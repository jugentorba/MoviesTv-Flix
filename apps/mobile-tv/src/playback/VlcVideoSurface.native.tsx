import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import VLCPlayer, {
  type VLCPlayerRef,
  type VLCPlayerTracks,
  type VLCTrack,
} from '@lunarr/vlc-player';
import {
  inferMediaLanguages,
  type AudioTrack,
  type EmbeddedSubtitleTrack,
  type StreamSource,
} from '@moviestv/core';
import { type Theme } from '@moviestv/ui';
import { type BufferMode, readBufferMode, vlcCachingMs } from './bufferMode';
import { usePlayerOrientation } from './usePlaybackOrientation';
import { useSafeVideoFrame } from './useSafeVideoFrame';
import { PlayerChrome, type PlayerAction } from './PlayerChrome';
import { useHoldSpeed } from './useHoldSpeed';
import { usePlayerSliders } from './usePlayerSliders';
import { useSkipSegments } from './useSkipSegments';
import { PlayerSliderIndicator } from './PlayerSliderIndicator';
import { toEngineVolume } from './playerGestureMath';
import { loadBrightness } from './nativeModules';
import { useI18n } from '../i18n/useI18n';
import { preferredLanguageTrackIndex } from './preferredTrack';
import {
  nextPlaybackRate,
  toggleVideoFitMode,
  type VideoFitMode,
} from './playerControlState';
import { useThemeStyles } from '../theme/ThemeProvider';


function trackLanguage(track: VLCTrack): string {
  return inferMediaLanguages(track.name)[0] ?? 'und';
}

function audioTrackId(id: number): string {
  return `vlc-audio:${id}`;
}

function subtitleTrackId(id: number): string {
  return `vlc-subtitle:${id}`;
}

function mapAudioTracks(tracks: readonly VLCTrack[]): AudioTrack[] {
  return tracks.map((track) => ({
    id: audioTrackId(track.id),
    language: trackLanguage(track),
    label: track.name || `Track ${track.id}`,
  }));
}

function mapSubtitleTracks(
  tracks: readonly VLCTrack[],
): EmbeddedSubtitleTrack[] {
  return tracks.map((track) => ({
    id: subtitleTrackId(track.id),
    language: trackLanguage(track),
    label: track.name || `Track ${track.id}`,
  }));
}

/*
 * libvlc takes request identity as media options. Only the two credentialed
 * header types a provider can require are forwarded, and never in a log or URL.
 */
/**
 * Network cache, in milliseconds, before the first frame.
 *
 * The value follows the device's buffer setting: 3000 was the old hard-coded
 * default and made a 4K stream sit on a black screen for three seconds.
 */
function vlcMediaOptions(source: StreamSource, cachingMs: number): string[] {
  const options = [
    `network-caching=${cachingMs}`,
    'http-reconnect=true',
    'audio-time-stretch',
    // No `clock-jitter=0` here: it changes A/V clock behaviour and made some
    // sources fail that had played before. Startup speed is handled by the
    // buffer setting instead.
  ];

  for (const [rawName, rawValue] of Object.entries(source.headers ?? {})) {
    const name = rawName.trim().toLowerCase();
    const value = rawValue.trim();
    if (!value) continue;
    if (name === 'user-agent') options.push(`http-user-agent=${value}`);
    if (name === 'referer' || name === 'referrer') {
      options.push(`http-referrer=${value}`);
    }
  }

  return options;
}

/**
 * Options for the single retry after a failure.
 *
 * If a stream that used to play now fails, the most likely culprit is a tighter
 * buffer, so the retry goes back to the long-standing 3000 ms with nothing else
 * changed. Better a slow start than a dead end.
 */
function conservativeVlcOptions(source: StreamSource): string[] {
  return vlcMediaOptions(source, 3000);
}

export function VlcVideoSurface({
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
  useEffect(() => () => {
    for (const timer of trackRefreshTimersRef.current) clearTimeout(timer);
    trackRefreshTimersRef.current = [];
  }, []);

  useEffect(() => {
    let active = true;
    void readBufferMode().then((mode) => {
      if (active) setBufferMode(mode);
    });
    return () => { active = false; };
  }, []);

  const playerRef = useRef<VLCPlayerRef | null>(null);
  const trackRefreshTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // 0 = normal options, 1 = conservative retry after a failure.
  const [attempt, setAttempt] = useState(0);
  const initialSeekAppliedRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  // Show the whole frame by default: 'cover' cropped a 16:9 film into a
  // portrait screen. Fill remains one tap away in the menu.
  const [contentFit, setContentFit] = useState<VideoFitMode>('contain');
  // Rotates the moment the surface mounts; the menu can flip back to portrait.
  const { orientation, toggleOrientation } = usePlayerOrientation(true);
  // Keeps the picture clear of the notch / Dynamic Island / punch-hole.
  const videoFrame = useSafeVideoFrame();
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [tracks, setTracks] = useState<VLCPlayerTracks | null>(null);
  // Hold anywhere on the picture for 2×, the way handset players do it.
  const holdSpeed = useHoldSpeed(playbackRate, setPlaybackRate);
  // Brightness and playback volume, driven by vertical drags on the picture.
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
  const [bufferMode, setBufferMode] = useState<BufferMode>('balanced');

  const vlcSource = useMemo(() => ({
    uri: source.url,
    mediaOptions: attempt === 0
      ? vlcMediaOptions(source, vlcCachingMs(bufferMode))
      : conservativeVlcOptions(source),
    isNetwork: /^https?:/i.test(source.url),
    autoplay: true,
  }), [attempt, bufferMode, source.headers, source.url]);

  const applyTracks = useCallback((snapshot: VLCPlayerTracks) => {
    const mappedAudio = mapAudioTracks(snapshot.audio);
    let audioArrayIndex = selectedAudioTrackId
      ? mappedAudio.findIndex((track) => track.id === selectedAudioTrackId)
      : -1;
    if (audioArrayIndex < 0) {
      audioArrayIndex = preferredLanguageTrackIndex(
        mappedAudio,
        preferredAudioLanguages,
      );
    }
    if (audioArrayIndex < 0 && snapshot.audio.length > 0) audioArrayIndex = 0;
    const audio = audioArrayIndex >= 0
      ? snapshot.audio[audioArrayIndex]
      : undefined;
    if (audio && snapshot.audioIndex !== audio.id) {
      playerRef.current?.selectAudioTrack(audio.id);
    }
    onAudioTracksChange?.(
      mappedAudio,
      audio ? audioTrackId(audio.id) : null,
    );

    const mappedSubtitles = mapSubtitleTracks(snapshot.subtitle);
    if (!embeddedSubtitlesEnabled) {
      if (snapshot.subtitleIndex !== -1) {
        playerRef.current?.selectSubtitleTrack(-1);
      }
      onEmbeddedSubtitleTracksChange?.(mappedSubtitles, null);
      return;
    }

    let subtitleArrayIndex = selectedEmbeddedSubtitleTrackId
      ? mappedSubtitles.findIndex(
        (track) => track.id === selectedEmbeddedSubtitleTrackId,
      )
      : -1;
    if (subtitleArrayIndex < 0) {
      subtitleArrayIndex = preferredLanguageTrackIndex(
        mappedSubtitles,
        preferredSubtitleLanguages,
      );
    }
    if (subtitleArrayIndex < 0 && snapshot.subtitle.length > 0) {
      subtitleArrayIndex = 0;
    }
    const subtitle = subtitleArrayIndex >= 0
      ? snapshot.subtitle[subtitleArrayIndex]
      : undefined;
    const subtitleId = subtitle?.id ?? -1;
    if (snapshot.subtitleIndex !== subtitleId) {
      playerRef.current?.selectSubtitleTrack(subtitleId);
    }
    onEmbeddedSubtitleTracksChange?.(
      mappedSubtitles,
      subtitle ? subtitleTrackId(subtitle.id) : null,
    );
  }, [
    embeddedSubtitlesEnabled,
    onAudioTracksChange,
    onEmbeddedSubtitleTracksChange,
    preferredAudioLanguages,
    preferredSubtitleLanguages,
    selectedAudioTrackId,
    selectedEmbeddedSubtitleTrackId,
  ]);

  useEffect(() => {
    if (tracks) applyTracks(tracks);
  }, [applyTracks, tracks]);

  useEffect(() => {
    onControlsVisibilityChange?.(controlsVisible);
  }, [controlsVisible, onControlsVisibilityChange]);

  useEffect(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (controlsVisible && playing) {
      hideTimerRef.current = setTimeout(
        () => setControlsVisible(false),
        3200,
      );
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [controlsVisible, playing]);

  /*
   * `@lunarr/vlc-player` declares its imperative handle without a dependency
   * array, so React re-applies the ref on every render: it calls this with
   * `null`, then with the new handle. That transient `null` is not an unmount.
   *
   * Releasing on it (as an earlier teardown fix did) destroyed the libvlc
   * player as soon as the surface re-rendered — long before `onLoad`, so the
   * player never reported progress and the video never appeared.
   *
   * So: ignore `null` here, keep the instance, and release once on unmount.
   * `playerRef` is ours, not a React ref, so React cannot null it for us.
   */
  const attachPlayer = useCallback((instance: VLCPlayerRef | null) => {
    if (!instance) return;
    playerRef.current = instance;
  }, []);

  useEffect(() => () => {
    const player = playerRef.current;
    playerRef.current = null;
    if (!player) return;
    try {
      player.release();
    } catch {
      // The native view can already be gone during app teardown.
    }
  }, []);

  const togglePlayback = useCallback(() => {
    if (playing) {
      playerRef.current?.pause();
      setPlaying(false);
    } else {
      playerRef.current?.play();
      setPlaying(true);
    }
    setControlsVisible(true);
  }, [playing]);

  const seekBy = useCallback((seconds: number) => {
    const target = Math.max(
      0,
      duration > 0
        ? Math.min(duration, position + seconds)
        : position + seconds,
    );
    playerRef.current?.seek(target);
    setPosition(target);
    if (duration > 0) onProgress?.(target, duration);
    setControlsVisible(true);
  }, [duration, onProgress, position]);

  const seekToRatio = useCallback((ratio: number) => {
    if (!Number.isFinite(ratio) || duration <= 0) return;
    const target = Math.max(0, Math.min(duration, duration * ratio));
    playerRef.current?.seek(target);
    setPosition(target);
    onProgress?.(target, duration);
    setControlsVisible(true);
  }, [duration, onProgress]);

  const skip = useSkipSegments({
    imdbId,
    season: seasonNumber,
    episode: episodeNumber,
    enabled: skipIntroEnabled,
    position,
    onSeek: (seconds) => {
      playerRef.current?.seek(seconds);
      setPosition(seconds);
      onProgress?.(seconds, duration);
      setControlsVisible(true);
    },
  });
  const skipLabel = skip.segment
    ? t(`playback.skip${skip.segment.kind.charAt(0).toUpperCase()}${skip.segment.kind.slice(1)}`)
    : undefined;

  // Every control the old ⋯ sheet held, as one row of icons with visible state.
  const actions: PlayerAction[] = [];
  if (onOpenAudio) {
    actions.push({
      key: 'audio',
      icon: 'musical-notes',
      label: 'Audio',
      accessibilityLabel: audioLabel ?? 'Audio track',
      testID: 'player-audio',
      // Opening the chooser is the moment the real track list is needed.
      onPress: () => { playerRef.current?.getTracks(); onOpenAudio(); },
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
      onPress: () => { setPlaybackRate((value) => nextPlaybackRate(value)); setControlsVisible(true); },
    },
    {
      key: 'fit',
      icon: contentFit === 'cover' ? 'contract' : 'expand',
      label: 'Fit',
      value: contentFit === 'cover' ? 'Fill' : 'Fit',
      active: contentFit === 'cover',
      accessibilityLabel: contentFit === 'contain' ? 'Fill screen' : 'Fit whole video',
      testID: 'native-video-content-fit',
      onPress: () => { setContentFit(toggleVideoFitMode); setControlsVisible(true); },
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
      onPress: () => { setMuted((value) => !value); setControlsVisible(true); },
    },
  );

  return (
    <View
      testID={testID}
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
        <VLCPlayer
          key={`vlc-attempt-${attempt}`}
          ref={attachPlayer}
          source={vlcSource}
          style={styles.video}
          autoplay
          paused={!playing}
          muted={muted}
          rate={playbackRate}
          resizeMode={contentFit === 'cover' ? 'cover' : 'contain'}
          volume={toEngineVolume(volume, 'vlc')}
          continueAudioInBackground={false}
          showNowPlaying={false}
          progressUpdateInterval={500}
          onLoad={({ duration: nextDuration }) => {
            if (Number.isFinite(nextDuration) && nextDuration > 0) {
              setDuration(nextDuration);
            }
            if (!initialSeekAppliedRef.current && initialPositionSeconds > 0) {
              initialSeekAppliedRef.current = true;
              playerRef.current?.seek(initialPositionSeconds);
              setPosition(initialPositionSeconds);
            }
            playerRef.current?.getTracks();
            // Track metadata arrives progressively for remote files.
            for (const delay of [1_000, 3_000, 6_000]) {
              const timer = setTimeout(() => playerRef.current?.getTracks(), delay);
              trackRefreshTimersRef.current.push(timer);
            }
          }}
          onProgress={({ currentTime, duration: nextDuration }) => {
            if (!Number.isFinite(currentTime) || currentTime < 0) return;
            const safeDuration = typeof nextDuration === 'number'
              && Number.isFinite(nextDuration)
              && nextDuration > 0
              ? nextDuration
              : duration;
            setPosition(currentTime);
            if (safeDuration > 0) setDuration(safeDuration);
            onProgress?.(currentTime, safeDuration);
          }}
          onPlaying={() => setPlaying(true)}
          onPaused={() => setPlaying(false)}
          onEnd={({ duration: endedDuration }) => {
            const safeDuration = typeof endedDuration === 'number'
              && Number.isFinite(endedDuration)
              && endedDuration > 0
              ? endedDuration
              : duration;
            setPosition(safeDuration);
            if (safeDuration > 0) onProgress?.(safeDuration, safeDuration);
            onEnded?.();
            setControlsVisible(true);
          }}
          onError={() => {
            if (attempt === 0) {
              // First failure: retry with the conservative buffer before giving up.
              setAttempt(1);
              return;
            }
            setPlaying(false);
            setControlsVisible(true);
            onPlaybackError?.('Video source failed');
          }}
          onTracks={(snapshot) => {
            setTracks(snapshot);
            applyTracks(snapshot);
          }}
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
          accessibilityLabel="Toggle player controls"
          testID={testID ? `${testID}-tap-surface` : undefined}
          onPress={() => setControlsVisible((visible) => !visible)}
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
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.scrim]}
          />

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
              <Text style={styles.playIcon}>{playing ? 'Ⅱ' : '▶'}</Text>
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
  video: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
  },
  videoFrame: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scrim: {
    backgroundColor: 'rgba(0,0,0,0.42)',
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
  seekGlyphRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  centerSeekText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  playButton: {
    width: 66,
    height: 66,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#ffffff',
  },
  playIcon: { color: '#0a0a0c', fontSize: 23, fontWeight: '900' },
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
  timeText: { color: 'rgba(255,255,255,0.78)', fontSize: 12, fontWeight: '700' },
  iconText: { color: '#ffffff', fontSize: 12, fontWeight: '900' },
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
  flex: { flex: 1 },
});

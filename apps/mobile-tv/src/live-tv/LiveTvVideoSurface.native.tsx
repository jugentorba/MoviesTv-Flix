import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView, type AudioTrack as ExpoAudioTrack } from 'expo-video';
import type { StreamSource } from '@moviestv/core';
import Ionicons from '@expo/vector-icons/Ionicons';
import { fontFamily } from '@moviestv/ui';
import { I18nContext } from '../i18n/useI18n';
import { livePauseMode } from './livePause';
import { preferredLanguageTrackIndex } from '../playback/preferredTrack';
import { safePlaybackErrorMessage } from '../playback/playbackError';
import {
  nativeVideoSourceSignature,
  toNativeVideoSource,
} from '../playback/nativeVideoSource';
import {
  createLiveTvStallWatchdog,
  createLiveTvStartupWatchdog,
} from './liveTvPlaybackHealth';

type VideoViewPlayer = React.ComponentProps<typeof VideoView>['player'];

export function LiveTvVideoSurface({
  source,
  preferredAudioLanguages = [],
  testID,
  onPress,
  onPlaybackError,
}: {
  source: StreamSource;
  preferredAudioLanguages?: readonly string[];
  testID?: string;
  onPress?(): void;
  onPlaybackError?(message?: string): void;
}) {
  // Optional i18n: this surface is rendered in isolation by tests, and a
  // missing provider must not break playback. Same fallback rule as useTheme.
  const i18n = useContext(I18nContext);
  const t = useCallback(
    (key: string, fallback: string) => (i18n ? i18n.t(key) : fallback),
    [i18n],
  );
  // A channel can only be paused when the engine exposes a window behind the
  // live edge; a plain live stream reports Infinity and offers no control.
  const [duration, setDuration] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const pauseAvailable = livePauseMode(duration) === 'pausable';
  const sourceFailedRef = useRef(false);
  const playbackStartedRef = useRef(false);
  const resumeAfterForegroundRef = useRef(false);
  const sourceGenerationRef = useRef(0);
  const playbackErrorRef = useRef(onPlaybackError);
  const lastExplicitSourceSignatureRef = useRef<string | null>(null);
  const preferredAudioLanguagesRef = useRef(preferredAudioLanguages);
  const startupWatchdogRef = useRef<ReturnType<
    typeof createLiveTvStartupWatchdog
  > | null>(null);
  const stallWatchdogRef = useRef<ReturnType<
    typeof createLiveTvStallWatchdog
  > | null>(null);
  const reportSourceFailureRef = useRef<(message?: string) => void>(
    () => undefined,
  );
  playbackErrorRef.current = onPlaybackError;
  preferredAudioLanguagesRef.current = preferredAudioLanguages;
  const player = useVideoPlayer(
    toNativeVideoSource(source, Platform.OS),
    (instance) => {
      if (AppState.currentState !== 'background'
          && AppState.currentState !== 'inactive') {
        instance.play();
      } else {
        resumeAfterForegroundRef.current = true;
      }
    },
  );

  const sourceFailureResetSignature = nativeVideoSourceSignature(
    source,
    Platform.OS,
  );

  useEffect(() => {
    sourceGenerationRef.current += 1;
    sourceFailedRef.current = false;
    playbackStartedRef.current = false;
    resumeAfterForegroundRef.current = (
      AppState.currentState === 'background'
      || AppState.currentState === 'inactive'
    );

    const reportSourceFailure = (message?: string) => {
      if (sourceFailedRef.current) return;
      sourceFailedRef.current = true;
      startupWatchdogRef.current?.dispose();
      stallWatchdogRef.current?.dispose();
      playbackErrorRef.current?.(
        safePlaybackErrorMessage(message, 'Live TV source failed'),
      );
    };
    reportSourceFailureRef.current = reportSourceFailure;

    const startupWatchdog = createLiveTvStartupWatchdog(() => {
      reportSourceFailure('Live TV source did not start in time');
    });
    const stallWatchdog = createLiveTvStallWatchdog(() => {
      reportSourceFailure('Live TV source stalled for too long');
    });
    startupWatchdogRef.current = startupWatchdog;
    stallWatchdogRef.current = stallWatchdog;
    startupWatchdog.start();
    if (
      AppState.currentState === 'background'
      || AppState.currentState === 'inactive'
    ) {
      startupWatchdog.pause();
    }

    return () => {
      startupWatchdog.dispose();
      stallWatchdog.dispose();
      if (startupWatchdogRef.current === startupWatchdog) {
        startupWatchdogRef.current = null;
      }
      if (stallWatchdogRef.current === stallWatchdog) {
        stallWatchdogRef.current = null;
      }
      if (reportSourceFailureRef.current === reportSourceFailure) {
        reportSourceFailureRef.current = () => undefined;
      }
    };
  }, [sourceFailureResetSignature]);

  useEffect(() => {
    const generation = sourceGenerationRef.current;
    const applyPreferredAudio = (
      tracksOverride?: readonly ExpoAudioTrack[],
    ) => {
      if (generation !== sourceGenerationRef.current) return;
      const tracks = tracksOverride ?? player.availableAudioTracks ?? [];
      const index = preferredLanguageTrackIndex(
        tracks,
        preferredAudioLanguagesRef.current,
      );
      if (index >= 0 && tracks[index]) {
        player.audioTrack = tracks[index];
      }
    };

    applyPreferredAudio();
    const sourceSubscription = player.addListener(
      'sourceLoad',
      (payload) => {
        if (
          generation !== sourceGenerationRef.current
          || sourceFailedRef.current
        ) return;
        startupWatchdogRef.current?.progress();
        applyPreferredAudio(payload?.availableAudioTracks);
        if (
          AppState.currentState !== 'background'
          && AppState.currentState !== 'inactive'
        ) {
          resumeAfterForegroundRef.current = false;
          player.play();
        } else {
          resumeAfterForegroundRef.current = true;
        }
      },
    );
    const audioTracksSubscription = player.addListener(
      'availableAudioTracksChange',
      (payload) => {
        if (
          generation !== sourceGenerationRef.current
          || sourceFailedRef.current
        ) return;
        applyPreferredAudio(payload?.availableAudioTracks);
      },
    );
    // AVPlayer resolves its audio selection group after the item loads, so a
    // `sourceLoad` payload can be empty. Re-apply once playback is ready.
    const readySubscription = player.addListener(
      'statusChange',
      (payload) => {
        if (
          generation !== sourceGenerationRef.current
          || sourceFailedRef.current
          || payload?.status !== 'readyToPlay'
        ) return;
        applyPreferredAudio();
      },
    );
    return () => {
      sourceSubscription.remove();
      audioTracksSubscription.remove();
      readySubscription.remove();
    };
  }, [player, sourceFailureResetSignature]);

  const preferredAudioSignature = preferredAudioLanguages.map((language) => language.trim().toLowerCase()).filter(Boolean).join('\u0000');
  useEffect(() => {
    const tracks = player.availableAudioTracks ?? [];
    const index = preferredLanguageTrackIndex(tracks, preferredAudioLanguagesRef.current);
    if (index >= 0 && tracks[index]) player.audioTrack = tracks[index];
  }, [player, preferredAudioSignature]);

  useEffect(() => {
    const appStateSubscription = AppState.addEventListener(
      'change',
      (state) => {
        if (state === 'active') {
          startupWatchdogRef.current?.resume();
          if (
            resumeAfterForegroundRef.current
            && !sourceFailedRef.current
          ) {
            resumeAfterForegroundRef.current = false;
            player.play();
          }
          return;
        }

        startupWatchdogRef.current?.pause();
        stallWatchdogRef.current?.ready();
        if (
          !resumeAfterForegroundRef.current
          && !sourceFailedRef.current
          && (playbackStartedRef.current || Boolean(player.playing))
        ) {
          resumeAfterForegroundRef.current = true;
          player.pause();
        }
      },
    );

    return () => appStateSubscription.remove();
  }, [player]);

  useEffect(() => {
    const generation = sourceGenerationRef.current;
    const playingSubscription = player.addListener(
      'playingChange',
      ({ isPlaying }) => {
        if (
          generation !== sourceGenerationRef.current
          || sourceFailedRef.current
        ) return;
        if (isPlaying) {
          playbackStartedRef.current = true;
          startupWatchdogRef.current?.ready();
          stallWatchdogRef.current?.ready();
          return;
        }
        if (
          resumeAfterForegroundRef.current
          || AppState.currentState === 'background'
          || AppState.currentState === 'inactive'
        ) {
          stallWatchdogRef.current?.ready();
          return;
        }
        if (playbackStartedRef.current) {
          stallWatchdogRef.current?.stall();
        }
      },
    );
    const statusSubscription = player.addListener(
      'statusChange',
      ({ status, error }) => {
        if (
          generation !== sourceGenerationRef.current
          || status !== 'error'
          || sourceFailedRef.current
        ) return;
        reportSourceFailureRef.current(
          error?.message ?? 'Live TV source failed',
        );
      },
    );
    return () => {
      playingSubscription.remove();
      statusSubscription.remove();
    };
  }, [player, sourceFailureResetSignature]);

  useEffect(() => {
    const previousSignature = lastExplicitSourceSignatureRef.current;
    lastExplicitSourceSignatureRef.current = sourceFailureResetSignature;
    if (
      previousSignature === null
      || previousSignature === sourceFailureResetSignature
    ) {
      return undefined;
    }

    let active = true;
    const nextSource = toNativeVideoSource(source, Platform.OS);

    void player.replaceAsync(nextSource)
      .then(() => {
        if (!active || sourceFailedRef.current) return;
        playbackStartedRef.current = false;
        startupWatchdogRef.current?.progress();
        if (AppState.currentState !== 'background'
          && AppState.currentState !== 'inactive') {
          resumeAfterForegroundRef.current = false;
          player.play();
        } else {
          resumeAfterForegroundRef.current = true;
        }
      })
      .catch((error: unknown) => {
        if (!active || sourceFailedRef.current) return;
        reportSourceFailureRef.current(
          safePlaybackErrorMessage(
            error instanceof Error ? error.message : error,
            'Live TV source failed',
          ),
        );
      });

    return () => {
      active = false;
    };
  }, [
    player,
    source,
    sourceFailureResetSignature,
  ]);

  useEffect(() => {
    // Sampling is cheap and avoids depending on engine-specific events; a live
    // stream reports Infinity for duration, which is exactly what we check.
    const tick = () => {
      const nextDuration = typeof player.duration === 'number' ? player.duration : null;
      setDuration((current) => (current === nextDuration ? current : nextDuration));
      const nextPlaying = Boolean(player.playing);
      setPlaying((current) => (current === nextPlaying ? current : nextPlaying));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [player]);

  const togglePause = useCallback(() => {
    if (!pauseAvailable) return;
    if (player.playing) player.pause();
    else player.play();
  }, [pauseAvailable, player]);

  return (
    <Pressable
      accessibilityRole="button"
      focusable
      testID={testID ? `${testID}-tap-surface` : undefined}
      onPress={onPress}
      style={styles.root}
    >
      <View pointerEvents="none" style={styles.video}>
        <VideoView
          testID={testID}
          style={styles.video}
          player={player as unknown as VideoViewPlayer}
          nativeControls={false}
          contentFit="contain"
          fullscreenOptions={{ enable: false }}
        />
      </View>

      {pauseAvailable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? t('playback.pause', 'Pause') : t('playback.play', 'Play')}
          testID={testID ? `${testID}-pause` : 'live-tv-pause'}
          onPress={togglePause}
          style={styles.pauseButton}
        >
          <Ionicons name={playing ? 'pause' : 'play'} size={20} color="#ffffff" />
        </Pressable>
      ) : null}

      <View pointerEvents="none" style={styles.liveBadge}>
        <View style={styles.liveDot} />
        <Text style={styles.liveText}>{playing ? t('liveTv.live', 'LIVE') : t('liveTv.paused', 'PAUSED')}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', height: '100%', backgroundColor: '#000000' },
  video: { width: '100%', height: '100%' },
  pauseButton: {
    position: 'absolute',
    left: 24,
    bottom: 24,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,14,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  liveBadge: {
    position: 'absolute',
    right: 24,
    top: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(10,10,14,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  liveDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: '#FF5A5F' },
  liveText: { color: '#ffffff', fontFamily: fontFamily.uiSemiBold, fontSize: 11, letterSpacing: 0.6 },
});

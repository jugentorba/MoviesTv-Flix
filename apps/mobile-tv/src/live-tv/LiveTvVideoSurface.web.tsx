import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { StreamSource } from '@moviestv/core';
import { attachWebMediaSource } from '../playback/attachWebMediaSource';
import { preferredLanguageTrackIndex } from '../playback/preferredTrack';
import { safePlaybackErrorMessage } from '../playback/playbackError';
import { useI18n } from '../i18n/useI18n';
import {
  pauseWebMediaForBackground,
  shouldResumeWebMediaAfterBackground,
} from '../playback/webBackgroundMedia';
import {
  classifyWebPlayFailure,
  shouldAttemptWebPlayback,
  shouldDeferWebPlayFailure,
  shouldRevealWebPlayButton,
} from '../playback/webPlayAttempt';
import {
  createLiveTvStallWatchdog,
  createLiveTvStartupWatchdog,
} from './liveTvPlaybackHealth';

interface BrowserAudioTrackLike {
  language?: string;
  label?: string;
  enabled: boolean;
}

interface BrowserAudioTrackListLike {
  length: number;
  [index: number]: BrowserAudioTrackLike | undefined;
  item?(index: number): BrowserAudioTrackLike | null;
  addEventListener?(
    type: 'addtrack' | 'removetrack' | 'change',
    listener: () => void,
  ): void;
  removeEventListener?(
    type: 'addtrack' | 'removetrack' | 'change',
    listener: () => void,
  ): void;
}

type BrowserVideoElement = HTMLVideoElement & {
  audioTracks?: BrowserAudioTrackListLike;
};

function browserAudioTracks(
  list: BrowserAudioTrackListLike,
): BrowserAudioTrackLike[] {
  const tracks: BrowserAudioTrackLike[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const track = list[index] ?? list.item?.(index) ?? null;
    if (track) tracks.push(track);
  }
  return tracks;
}

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
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playbackErrorRef = useRef(onPlaybackError);
  const preferredAudioLanguagesRef = useRef(
    preferredAudioLanguages,
  );
  const attachedSourceRef = useRef<ReturnType<
    typeof attachWebMediaSource
  > | null>(null);
  preferredAudioLanguagesRef.current = preferredAudioLanguages.filter((language): language is string => typeof language === 'string').map((language) => language.trim()).filter(Boolean).slice(0, 20);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const sourceFailedRef = useRef(false);
  const sourceGenerationRef = useRef(0);
  const reportSourceFailureRef = useRef<(message?: string) => void>(() => undefined);

  useEffect(() => {
    playbackErrorRef.current = onPlaybackError;
  }, [onPlaybackError]);

  const applyPreferredBrowserAudio = useCallback(() => {
    const video = videoRef.current as BrowserVideoElement | null;
    if (!video || attachedSourceRef.current?.usesHlsJs) return;

    const list = video.audioTracks;
    if (!list?.length) return;

    const tracks = browserAudioTracks(list).slice(0, 256);
    const index = preferredLanguageTrackIndex(
      tracks,
      preferredAudioLanguagesRef.current,
    );
    if (index < 0) return;

    tracks.forEach((track, trackIndex) => {
      track.enabled = trackIndex === index;
    });
  }, []);

  const preferredLanguageSignature = preferredAudioLanguages.map((language) => typeof language === 'string' ? language.trim().toLowerCase() : '').filter(Boolean).slice(0, 20).join('|');

  useEffect(() => {
    if (attachedSourceRef.current?.usesHlsJs) {
      attachedSourceRef.current.selectPreferredAudioTrack?.();
      return;
    }
    applyPreferredBrowserAudio();
  }, [applyPreferredBrowserAudio, preferredLanguageSignature]);

  const attemptPlayback = useCallback((revealFallback: boolean) => {
    const video = videoRef.current;
    const generation = sourceGenerationRef.current;
    if (
      !video
      || sourceFailedRef.current
      || !shouldAttemptWebPlayback(
        document.visibilityState,
        globalThis.navigator?.onLine,
      )
    ) return;

    try {
      const attempt = video.play();
      if (attempt && typeof attempt.then === 'function') {
        void attempt
          .then(() => {
            if (generation === sourceGenerationRef.current && !sourceFailedRef.current) setPlaybackBlocked(false);
          })
          .catch((error) => {
            if (generation !== sourceGenerationRef.current || sourceFailedRef.current) return;
            if (globalThis.navigator?.onLine === false) return;
            const failure = classifyWebPlayFailure(error);
            if (failure === 'source-failed') {
              if (
                shouldDeferWebPlayFailure(
                  failure,
                  attachedSourceRef.current?.usesHlsJs ?? false,
                  video.readyState,
                )
              ) return;
              reportSourceFailureRef.current('Live TV source is not supported by this browser');
            } else if (shouldRevealWebPlayButton(failure, revealFallback)) {
              setPlaybackBlocked(true);
            }
          });
      } else {
        if (generation === sourceGenerationRef.current && !sourceFailedRef.current) setPlaybackBlocked(false);
      }
    } catch (error) {
      if (generation !== sourceGenerationRef.current || sourceFailedRef.current) return;
      if (globalThis.navigator?.onLine === false) return;
      const failure = classifyWebPlayFailure(error);
      if (failure === 'source-failed') {
        if (
          shouldDeferWebPlayFailure(
            failure,
            attachedSourceRef.current?.usesHlsJs ?? false,
            video.readyState,
          )
        ) return;
        reportSourceFailureRef.current('Live TV source is not supported by this browser');
      } else if (shouldRevealWebPlayButton(failure, revealFallback)) {
        setPlaybackBlocked(true);
      }
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    setPlaybackBlocked(false);
    sourceFailedRef.current = false;
    const sourceGeneration = ++sourceGenerationRef.current;
    let disposeWatchdogs: () => void = () => undefined;
    let networkWasOffline = globalThis.navigator?.onLine === false;
    const reportSourceFailure = (message?: string) => {
      if (sourceGeneration !== sourceGenerationRef.current || sourceFailedRef.current) return;
      sourceFailedRef.current = true;
      disposeWatchdogs();
      setPlaybackBlocked(false);
      playbackErrorRef.current?.(
        safePlaybackErrorMessage(message, 'Live TV source failed'),
      );
    };
    reportSourceFailureRef.current = reportSourceFailure;
    const startupWatchdog = createLiveTvStartupWatchdog(() => {
      reportSourceFailure('Live TV source did not become ready in time');
    });
    const stallWatchdog = createLiveTvStallWatchdog(() => {
      reportSourceFailure('Live TV source stalled for too long');
    });
    disposeWatchdogs = () => {
      startupWatchdog.dispose();
      stallWatchdog.dispose();
    };
    const attached = attachWebMediaSource(
      video,
      source,
      reportSourceFailure,
      {
        get preferredLanguages() {
          return preferredAudioLanguagesRef.current;
        },
        preservePositionOnReconnect: false,
      },
    );
    attachedSourceRef.current = attached;

    let lastBufferedEnd = 0;
    let lastNativeAudioTrackCount = -1;
    let hasPlayed = false;
    let resumeWhenVisible = false;
    let networkPausedForBackground = false;
    const noteLoadingProgress = () => {
      if (sourceGeneration !== sourceGenerationRef.current || sourceFailedRef.current) return;
      let bufferedEnd = 0;
      try {
        const ranges = video.buffered;
        if (ranges.length > 0) bufferedEnd = ranges.end(ranges.length - 1);
      } catch {
        return;
      }
      if (bufferedEnd > lastBufferedEnd) {
        lastBufferedEnd = bufferedEnd;
        startupWatchdog.progress();
        stallWatchdog.progress();
      }
      const audioTrackCount = (
        video as BrowserVideoElement
      ).audioTracks?.length ?? 0;
      if (audioTrackCount !== lastNativeAudioTrackCount) {
        lastNativeAudioTrackCount = audioTrackCount;
        applyPreferredBrowserAudio();
      }
    };
    const metadataLoaded = () => {
      if (sourceGeneration !== sourceGenerationRef.current || sourceFailedRef.current) return;
      startupWatchdog.progress();
      applyPreferredBrowserAudio();
      attemptPlayback(true);
    };
    const retryWhenReady = () => {
      if (sourceGeneration !== sourceGenerationRef.current || sourceFailedRef.current) return;
      startupWatchdog.ready();
      stallWatchdog.ready();
      applyPreferredBrowserAudio();
      attemptPlayback(true);
    };
    const markPlaying = () => {
      if (sourceGeneration !== sourceGenerationRef.current || sourceFailedRef.current) return;
      hasPlayed = true;
      startupWatchdog.ready();
      stallWatchdog.ready();
      setPlaybackBlocked(false);
    };
    const markStalled = () => {
      if (
        sourceGeneration !== sourceGenerationRef.current
        || sourceFailedRef.current
        || !hasPlayed
        || video.paused
        || video.ended
      ) return;
      stallWatchdog.stall();
    };
    const clearStall = () => {
      if (sourceGeneration !== sourceGenerationRef.current) return;
      stallWatchdog.ready();
    };
    const resumeAfterForeground = () => {
      if (
        sourceGeneration !== sourceGenerationRef.current
        || sourceFailedRef.current
      ) return;

      if (
        resumeWhenVisible
        && shouldResumeWebMediaAfterBackground({
          resumeRequested: true,
          visibilityState: document.visibilityState,
          online: globalThis.navigator?.onLine !== false,
          ended: video.ended,
        })
      ) {
        resumeWhenVisible = false;
        attemptPlayback(true);
        return;
      }

      if (
        document.visibilityState === 'hidden'
        || globalThis.navigator?.onLine === false
        || video.ended
      ) return;

      if (video.paused) return;

      if (hasPlayed && video.readyState < 3) {
        stallWatchdog.stall();
      }
    };
    const pauseForBackground = () => {
      if (pauseWebMediaForBackground(video)) {
        resumeWhenVisible = true;
      }
      if (attached.pauseNetwork?.()) {
        networkPausedForBackground = true;
      }
    };
    const resumeNetworkWhenVisible = () => {
      if (
        document.visibilityState === 'hidden'
        || globalThis.navigator?.onLine === false
      ) return;
      if (networkWasOffline || networkPausedForBackground) {
        attached.resumeNetwork?.();
      }
      networkWasOffline = false;
      networkPausedForBackground = false;
    };
    const handleVisibilityChange = () => {
      if (
        sourceGeneration !== sourceGenerationRef.current
        || sourceFailedRef.current
      ) return;
      if (
        document.visibilityState === 'hidden'
        || globalThis.navigator?.onLine === false
      ) {
        startupWatchdog.pause();
        stallWatchdog.ready();
        pauseForBackground();
        return;
      }
      resumeNetworkWhenVisible();
      startupWatchdog.resume();
      resumeAfterForeground();
    };
    const handlePageHide = () => {
      if (sourceGeneration !== sourceGenerationRef.current) return;
      startupWatchdog.pause();
      stallWatchdog.ready();
      pauseForBackground();
    };
    const handleOffline = () => {
      if (sourceGeneration !== sourceGenerationRef.current) return;
      networkWasOffline = true;
      attached.pauseNetwork?.();
      handlePageHide();
    };
    const mediaError = () => {
      if (
        sourceGeneration !== sourceGenerationRef.current
        || sourceFailedRef.current
        || attached.usesHlsJs
        || globalThis.navigator?.onLine === false
      ) return;
      const mediaErrorCode = video.error?.code ?? 0;
      reportSourceFailure(
        mediaErrorCode === 4
          ? 'Live TV source is not supported by this browser'
          : video.error?.message || 'Live TV source failed',
      );
    };

    const nativeAudioTracks = (video as BrowserVideoElement).audioTracks;
    const nativeTracksChanged = () => {
      if (
        sourceGeneration !== sourceGenerationRef.current
        || sourceFailedRef.current
        || attached.usesHlsJs
      ) return;
      lastNativeAudioTrackCount = (
        video as BrowserVideoElement
      ).audioTracks?.length ?? 0;
      applyPreferredBrowserAudio();
    };

    video.addEventListener('loadedmetadata', metadataLoaded);
    video.addEventListener('progress', noteLoadingProgress);
    video.addEventListener('canplay', retryWhenReady);
    video.addEventListener('playing', markPlaying);
    video.addEventListener('waiting', markStalled);
    video.addEventListener('stalled', markStalled);
    video.addEventListener('pause', clearStall);
    video.addEventListener('ended', clearStall);
    video.addEventListener('error', mediaError);
    nativeAudioTracks?.addEventListener?.('addtrack', nativeTracksChanged);
    nativeAudioTracks?.addEventListener?.('removetrack', nativeTracksChanged);
    nativeAudioTracks?.addEventListener?.('change', nativeTracksChanged);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    const handlePageResume = () => {
      if (sourceGeneration !== sourceGenerationRef.current) return;
      if (globalThis.navigator?.onLine === false) {
        handleOffline();
        return;
      }
      resumeNetworkWhenVisible();
      if (document.visibilityState === 'hidden') return;
      startupWatchdog.resume();
      resumeAfterForeground();
    };
    const handleOnline = () => {
      if (
        sourceGeneration !== sourceGenerationRef.current
        || sourceFailedRef.current
      ) return;
      resumeNetworkWhenVisible();
      if (document.visibilityState === 'hidden') return;
      startupWatchdog.resume();
      resumeAfterForeground();
    };
    window.addEventListener('pageshow', handlePageResume);
    window.addEventListener('focus', handlePageResume);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // A cached/invalid native source can fail immediately after src assignment,
    // before the effect has finished registering listeners. Re-check the media
    // element once so that fast Safari failures enter the same source-failover
    // path instead of waiting for the startup watchdog.
    if (video.error && !attached.usesHlsJs) {
      mediaError();
    }

    // HLS.js may still be attaching its MediaSource here. An early failure is
    // intentionally quiet; loadedmetadata/canplay retries once the source is ready.
    startupWatchdog.start();
    if (
      document.visibilityState === 'hidden'
      || globalThis.navigator?.onLine === false
    ) {
      startupWatchdog.pause();
    }
    attemptPlayback(false);

    return () => {
      if (sourceGeneration === sourceGenerationRef.current) sourceGenerationRef.current += 1;
      disposeWatchdogs();
      video.removeEventListener('loadedmetadata', metadataLoaded);
      video.removeEventListener('progress', noteLoadingProgress);
      video.removeEventListener('canplay', retryWhenReady);
      video.removeEventListener('playing', markPlaying);
      video.removeEventListener('waiting', markStalled);
      video.removeEventListener('stalled', markStalled);
      video.removeEventListener('pause', clearStall);
      video.removeEventListener('ended', clearStall);
      video.removeEventListener('error', mediaError);
      nativeAudioTracks?.removeEventListener?.('addtrack', nativeTracksChanged);
      nativeAudioTracks?.removeEventListener?.('removetrack', nativeTracksChanged);
      nativeAudioTracks?.removeEventListener?.('change', nativeTracksChanged);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageResume);
      window.removeEventListener('focus', handlePageResume);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (attachedSourceRef.current === attached) {
        attachedSourceRef.current = null;
      }
      attached.destroy();
      if (reportSourceFailureRef.current === reportSourceFailure) {
        reportSourceFailureRef.current = () => undefined;
      }
    };
  }, [
    applyPreferredBrowserAudio,
    attemptPlayback,
    source,
  ]);

  const videoElement = React.createElement('video', {
    ref: videoRef,
    autoPlay: false,
    playsInline: true,
    controls: false,
    preload: 'auto',
    'data-testid': testID,
    style: {
      width: '100%',
      height: '100%',
      display: 'block',
      objectFit: 'contain',
      backgroundColor: '#000000',
      pointerEvents: 'none',
    },
  });

  return (
    <Pressable
      accessibilityRole="button"
      focusable
      testID={testID ? `${testID}-tap-surface` : undefined}
      onPress={onPress}
      style={styles.root}
    >
      {videoElement}
      {playbackBlocked ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('playback.play')}
          focusable
          testID={testID ? `${testID}-start` : undefined}
          onPress={(event) => {
            event.stopPropagation();
            attemptPlayback(true);
          }}
          style={({ focused, pressed }) => [
            styles.startButton,
            focused && styles.startButtonFocused,
            pressed && styles.startButtonPressed,
          ]}
        >
          <Text style={styles.startIcon}>▶</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000000',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  startButton: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  startButtonFocused: {
    borderColor: '#ffffff',
    transform: [{ scale: 1.08 }],
  },
  startButtonPressed: {
    opacity: 0.75,
  },
  startIcon: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '900',
    marginLeft: 4,
  },
});

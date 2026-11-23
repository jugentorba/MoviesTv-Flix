import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { AudioTrack, EmbeddedSubtitleTrack, StreamSource } from '@moviestv/core';
import { type Theme } from '@moviestv/ui';
import { attachWebMediaSource } from './attachWebMediaSource';
import { preferredLanguageTrackIndex } from './preferredTrack';
import { safeInsetEdge } from '../app/safeAreaLayout';
import { createWebPlaybackStartupWatchdog } from './webPlaybackStartupWatchdog';
import { createWebPlaybackStallWatchdog } from './webPlaybackStallWatchdog';
import {
  classifyWebPlayFailure,
  shouldAttemptWebPlayback,
  shouldDeferWebPlayFailure,
  shouldRevealWebPlayButton,
} from './webPlayAttempt';
import { toggleWebVideoFullscreen } from './webFullscreen';
import { safePlaybackErrorMessage } from './playbackError';
import { useI18n } from '../i18n/useI18n';
import {
  nextPlaybackRate,
  toggleVideoFitMode,
  type VideoFitMode,
} from './playerControlState';
import { useThemeStyles } from '../theme/ThemeProvider';

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

function browserAudioTracks(list: BrowserAudioTrackListLike): BrowserAudioTrackLike[] {
  const tracks: BrowserAudioTrackLike[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const track = list[index] ?? list.item?.(index) ?? null;
    if (track) tracks.push(track);
  }
  return tracks;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function VideoSurface({
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
  imdbId: _imdbId,
  seasonNumber: _seasonNumber,
  episodeNumber: _episodeNumber,
  skipIntroEnabled: _skipIntroEnabled,
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
  title?: string;
  meta?: string;
  submeta?: string;
  locked?: boolean;
  onToggleLock?(): void;
  /** IntroDB skip segments are not wired on web yet. */
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [contentFit, setContentFit] = useState<VideoFitMode>('cover');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progressWidth, setProgressWidth] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [tapToPlayRequired, setTapToPlayRequired] = useState(false);
  const initialAppliedRef = useRef(false);
  const attachedSourceRef = useRef<ReturnType<typeof attachWebMediaSource> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackErrorRef = useRef(onPlaybackError);
  const audioTracksChangeRef = useRef(onAudioTracksChange);
  const subtitleTracksChangeRef = useRef(onEmbeddedSubtitleTracksChange);
  const preferredAudioLanguagesRef = useRef(preferredAudioLanguages);
  const preferredSubtitleLanguagesRef = useRef(preferredSubtitleLanguages);
  const selectedAudioTrackIdRef = useRef(selectedAudioTrackId);
  const selectedEmbeddedSubtitleTrackIdRef = useRef(selectedEmbeddedSubtitleTrackId);
  const embeddedSubtitlesEnabledRef = useRef(embeddedSubtitlesEnabled);
  const autoplayPendingRef = useRef(true);
  const sourceReadyRef = useRef(false);
  const sourceFailedRef = useRef(false);
  const endedRef = useRef(false);
  const resumeWhenVisibleRef = useRef(false);
  const sourceGenerationRef = useRef(0);
  const reportSourceFailureRef = useRef<(message?: string) => void>(
    () => undefined,
  );

  playbackErrorRef.current = onPlaybackError;
  audioTracksChangeRef.current = onAudioTracksChange;
  subtitleTracksChangeRef.current = onEmbeddedSubtitleTracksChange;
  preferredAudioLanguagesRef.current = preferredAudioLanguages;
  preferredSubtitleLanguagesRef.current = preferredSubtitleLanguages;
  selectedAudioTrackIdRef.current = selectedAudioTrackId;
  selectedEmbeddedSubtitleTrackIdRef.current = selectedEmbeddedSubtitleTrackId;
  embeddedSubtitlesEnabledRef.current = embeddedSubtitlesEnabled;

  const applyPreferredBrowserTracks = useCallback(() => {
    const video = videoRef.current as BrowserVideoElement | null;
    if (!video || attachedSourceRef.current?.usesHlsJs) return;

    const audioTracks = video.audioTracks;
    if (audioTracks?.length) {
      const candidates = browserAudioTracks(audioTracks);
      const mappedTracks: AudioTrack[] = candidates.map((track, index) => ({
        id: `embedded-audio:web:${track?.language ?? 'und'}:${track?.label ?? index}:${index}`,
        language: track?.language || 'und',
        label: track?.label || track?.language || `Track ${index + 1}`,
      }));
      const selectedAudioTrackId = selectedAudioTrackIdRef.current;
      let selectedIndex = selectedAudioTrackId
        ? mappedTracks.findIndex((track) => track.id === selectedAudioTrackId)
        : -1;
      if (selectedIndex < 0) {
        selectedIndex = preferredLanguageTrackIndex(
          candidates,
          preferredAudioLanguagesRef.current,
        );
      }
      if (selectedIndex < 0 && candidates.length > 0) selectedIndex = 0;

      candidates.forEach((track, index) => {
        if (track) track.enabled = index === selectedIndex;
      });
      audioTracksChangeRef.current?.(
        mappedTracks,
        mappedTracks[selectedIndex]?.id ?? null,
      );
    } else {
      audioTracksChangeRef.current?.([], null);
    }

    const textTracks = video.textTracks;
    if (textTracks?.length) {
      const candidates = Array.from(
        { length: textTracks.length },
        (_, index) => textTracks[index],
      );
      const mappedTracks: EmbeddedSubtitleTrack[] = candidates.map((track, index) => ({
        id: `embedded-subtitle:web:${track?.language || 'und'}:${track?.label || index}:${index}`,
        language: track?.language || 'und',
        label: track?.label || track?.language || `Track ${index + 1}`,
      }));

      const subtitlesEnabled = embeddedSubtitlesEnabledRef.current;
      const selectedSubtitleTrackId = selectedEmbeddedSubtitleTrackIdRef.current;
      let preferredIndex = subtitlesEnabled && selectedSubtitleTrackId
        ? mappedTracks.findIndex(
          (track) => track.id === selectedSubtitleTrackId,
        )
        : -1;

      if (subtitlesEnabled && preferredIndex < 0) {
        preferredIndex = preferredLanguageTrackIndex(
          candidates,
          preferredSubtitleLanguagesRef.current,
        );
      }
      if (subtitlesEnabled && preferredIndex < 0 && candidates.length > 0) {
        preferredIndex = 0;
      }

      candidates.forEach((track, index) => {
        if (track) {
          track.mode = subtitlesEnabled && index === preferredIndex
            ? 'showing'
            : 'disabled';
        }
      });
      subtitleTracksChangeRef.current?.(
        mappedTracks,
        subtitlesEnabled ? mappedTracks[preferredIndex]?.id ?? null : null,
      );
    } else {
      subtitleTracksChangeRef.current?.([], null);
    }
  }, []);

  const preferredAudioSignature = preferredAudioLanguages
    .map((language) => language.trim().toLowerCase())
    .filter(Boolean)
    .join('\u0000');
  const preferredSubtitleSignature = preferredSubtitleLanguages
    .map((language) => language.trim().toLowerCase())
    .filter(Boolean)
    .join('\u0000');

  useEffect(() => {
    const video = videoRef.current;
    if (video && video.readyState >= 1) applyPreferredBrowserTracks();
  }, [
    applyPreferredBrowserTracks,
    embeddedSubtitlesEnabled,
    preferredAudioSignature,
    preferredSubtitleSignature,
    selectedAudioTrackId,
    selectedEmbeddedSubtitleTrackId,
  ]);

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

  const updateProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video || sourceFailedRef.current) return;
    setPosition(video.currentTime || 0);
    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    setPlaying(!video.paused);
    onProgress?.(
      video.currentTime || 0,
      Number.isFinite(video.duration) ? video.duration : 0,
    );
  }, [onProgress]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
  }, [muted]);


  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackRate;
    video.preservesPitch = true;
  }, [playbackRate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || initialAppliedRef.current || initialPositionSeconds <= 0) return;
    if (video.readyState >= 1) {
      video.currentTime = initialPositionSeconds;
      initialAppliedRef.current = true;
      updateProgress();
    }
  }, [initialPositionSeconds, updateProgress]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const sourceGeneration = ++sourceGenerationRef.current;
    initialAppliedRef.current = false;
    autoplayPendingRef.current = true;
    sourceReadyRef.current = false;
    setPlaying(false);
    setPosition(0);
    setDuration(0);
    setControlsVisible(true);
    sourceFailedRef.current = false;
    endedRef.current = false;
    resumeWhenVisibleRef.current = false;
    setTapToPlayRequired(false);
    let disposeWatchdogs: () => void = () => undefined;
    let networkWasOffline = globalThis.navigator?.onLine === false;
    const reportSourceFailure = (message?: string) => {
      if (
        sourceGeneration !== sourceGenerationRef.current
        || sourceFailedRef.current
      ) return;
      sourceFailedRef.current = true;
      autoplayPendingRef.current = false;
      disposeWatchdogs();
      setTapToPlayRequired(false);
      setPlaying(false);
      playbackErrorRef.current?.(
        safePlaybackErrorMessage(message, 'Video source failed'),
      );
    };
    reportSourceFailureRef.current = reportSourceFailure;
    const startupWatchdog = createWebPlaybackStartupWatchdog(() => {
      reportSourceFailure('Video source did not become ready in time');
    });
    const stallWatchdog = createWebPlaybackStallWatchdog(() => {
      reportSourceFailure('Video source stalled for too long');
    });
    disposeWatchdogs = () => {
      startupWatchdog.dispose();
      stallWatchdog.dispose();
    };
    let lastBufferedEnd = 0;
    let lastNativeAudioTrackCount = -1;
    let lastNativeTextTrackCount = -1;
    const attached = attachWebMediaSource(
      video,
      source,
      reportSourceFailure,
      {
        get preferredLanguages() {
          return preferredAudioLanguagesRef.current;
        },
        get selectedTrackId() {
          return selectedAudioTrackIdRef.current;
        },
        onTracksChange: (tracks, selectedTrackId) => {
          audioTracksChangeRef.current?.(tracks, selectedTrackId);
        },
        get preferredSubtitleLanguages() {
          return preferredSubtitleLanguagesRef.current;
        },
        get selectedSubtitleTrackId() {
          return selectedEmbeddedSubtitleTrackIdRef.current;
        },
        get subtitlesEnabled() {
          return embeddedSubtitlesEnabledRef.current;
        },
        onSubtitleTracksChange: (tracks, selectedTrackId) => {
          subtitleTracksChangeRef.current?.(tracks, selectedTrackId);
        },
      },
    );
    attachedSourceRef.current = attached;

    const attemptPlayback = () => {
      if (
        !autoplayPendingRef.current
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
              if (
                sourceGeneration !== sourceGenerationRef.current
                || sourceFailedRef.current
              ) return;
              autoplayPendingRef.current = false;
              resumeWhenVisibleRef.current = true;
              setTapToPlayRequired(false);
              setPlaying(true);
            })
            .catch((error: unknown) => {
              if (
                sourceGeneration !== sourceGenerationRef.current
                || sourceFailedRef.current
              ) return;
              if (globalThis.navigator?.onLine === false) return;
              const failure = classifyWebPlayFailure(error);
              if (failure === 'source-failed') {
                if (
                  shouldDeferWebPlayFailure(
                    failure,
                    attached.usesHlsJs,
                    video.readyState,
                  )
                ) return;
                reportSourceFailure('Browser cannot play this video source');
                return;
              }
              if (failure === 'interrupted') return;
              // Safari commonly reports NotAllowedError after async provider
              // resolution loses the original tap. Surface the gesture button
              // immediately; waiting for canplay can leave some iPhone PWAs
              // with a black player and no actionable control.
              setTapToPlayRequired(
                shouldRevealWebPlayButton(failure)
                  ? true
                  : sourceReadyRef.current,
              );
              setPlaying(false);
              setControlsVisible(true);
            });
        } else {
          autoplayPendingRef.current = false;
          resumeWhenVisibleRef.current = true;
        }
      } catch (error: unknown) {
        if (globalThis.navigator?.onLine === false) return;
        const failure = classifyWebPlayFailure(error);
        if (failure === 'source-failed') {
          if (
            shouldDeferWebPlayFailure(
              failure,
              attached.usesHlsJs,
              video.readyState,
            )
          ) return;
          reportSourceFailure('Browser cannot play this video source');
          return;
        }
        if (failure === 'interrupted') return;
        setTapToPlayRequired(
          shouldRevealWebPlayButton(failure)
            ? true
            : sourceReadyRef.current,
        );
        setPlaying(false);
        setControlsVisible(true);
      }
    };
    const noteLoadingProgress = () => {
      if (
        sourceGeneration !== sourceGenerationRef.current
        || sourceFailedRef.current
      ) return;
      // Some browsers emit progress events even when no additional media bytes
      // arrived. Only extend startup while the buffered range actually grows.
      const ranges = video.buffered;
      let bufferedEnd = 0;
      try {
        if (ranges.length > 0) bufferedEnd = ranges.end(ranges.length - 1);
      } catch {
        return;
      }
      if (bufferedEnd > lastBufferedEnd) {
        lastBufferedEnd = bufferedEnd;
        startupWatchdog.progress();
        stallWatchdog.progress();
      }
      // Native Safari HLS can expose alternate audio/text tracks after
      // metadata, while buffering is already underway. Avoid repeating the
      // React track callbacks on every progress event when nothing changed.
      const nativeVideo = video as BrowserVideoElement;
      const audioTrackCount = nativeVideo.audioTracks?.length ?? 0;
      const textTrackCount = nativeVideo.textTracks?.length ?? 0;
      if (
        audioTrackCount !== lastNativeAudioTrackCount
        || textTrackCount !== lastNativeTextTrackCount
      ) {
        lastNativeAudioTrackCount = audioTrackCount;
        lastNativeTextTrackCount = textTrackCount;
        applyPreferredBrowserTracks();
      }
    };
    const metadataLoaded = () => {
      if (
        sourceGeneration !== sourceGenerationRef.current
        || sourceFailedRef.current
      ) return;
      startupWatchdog.progress();
      attemptPlayback();
    };
    const readyToPlay = () => {
      if (
        sourceGeneration !== sourceGenerationRef.current
        || sourceFailedRef.current
      ) return;
      // canplay means the source itself is healthy. From this point an iOS
      // autoplay rejection needs a user gesture, not source failover.
      sourceReadyRef.current = true;
      startupWatchdog.ready();
      stallWatchdog.ready();
      attemptPlayback();
    };
    const markPlaying = () => {
      if (
        sourceGeneration !== sourceGenerationRef.current
        || sourceFailedRef.current
        || endedRef.current
      ) return;
      sourceReadyRef.current = true;
      startupWatchdog.ready();
      stallWatchdog.ready();
      autoplayPendingRef.current = false;
      resumeWhenVisibleRef.current = true;
      setTapToPlayRequired(false);
      setPlaying(true);
    };
    const markStalled = () => {
      if (
        sourceGeneration !== sourceGenerationRef.current
        || sourceFailedRef.current
        || endedRef.current
        || !sourceReadyRef.current
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
        || globalThis.navigator?.onLine === false
        || endedRef.current
        || (!resumeWhenVisibleRef.current && !autoplayPendingRef.current)
      ) return;

      if (video.paused) {
        autoplayPendingRef.current = true;
        attemptPlayback();
        return;
      }

      // iOS can return from the background with paused=false while the media
      // pipeline is still starved. Re-arm bounded stall recovery instead of
      // leaving a frozen frame indefinitely.
      if (video.readyState < 3) stallWatchdog.stall();
    };
    const handleVisibilityChange = () => {
      if (
        sourceGeneration !== sourceGenerationRef.current
        || sourceFailedRef.current
        || endedRef.current
      ) return;
      if (
        document.visibilityState === 'hidden'
        || globalThis.navigator?.onLine === false
      ) {
        startupWatchdog.pause();
        stallWatchdog.ready();
        return;
      }
      startupWatchdog.resume();
      resumeAfterForeground();
    };
    const handlePageHide = () => {
      if (sourceGeneration !== sourceGenerationRef.current) return;
      startupWatchdog.pause();
      stallWatchdog.ready();
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
          ? 'Browser cannot play this video source'
          : video.error?.message || 'Video source failed',
      );
    };

    const nativeTracksChanged = () => {
      if (
        sourceGeneration !== sourceGenerationRef.current
        || sourceFailedRef.current
        || attached.usesHlsJs
      ) return;
      const nativeVideo = video as BrowserVideoElement;
      lastNativeAudioTrackCount = nativeVideo.audioTracks?.length ?? 0;
      lastNativeTextTrackCount = nativeVideo.textTracks?.length ?? 0;
      applyPreferredBrowserTracks();
    };
    const nativeAudioTracks = (video as BrowserVideoElement).audioTracks;
    const nativeTextTracks = video.textTracks;

    video.addEventListener('loadedmetadata', metadataLoaded);
    video.addEventListener('progress', noteLoadingProgress);
    video.addEventListener('canplay', readyToPlay);
    video.addEventListener('playing', markPlaying);
    video.addEventListener('waiting', markStalled);
    video.addEventListener('stalled', markStalled);
    video.addEventListener('pause', clearStall);
    video.addEventListener('ended', clearStall);
    video.addEventListener('error', mediaError);
    nativeAudioTracks?.addEventListener?.('addtrack', nativeTracksChanged);
    nativeAudioTracks?.addEventListener?.('removetrack', nativeTracksChanged);
    nativeAudioTracks?.addEventListener?.('change', nativeTracksChanged);
    nativeTextTracks.addEventListener('addtrack', nativeTracksChanged);
    nativeTextTracks.addEventListener('removetrack', nativeTracksChanged);
    nativeTextTracks.addEventListener('change', nativeTracksChanged);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    const handlePageResume = () => {
      if (sourceGeneration !== sourceGenerationRef.current) return;
      if (globalThis.navigator?.onLine === false) {
        handleOffline();
        return;
      }
      if (networkWasOffline && !sourceFailedRef.current) {
        networkWasOffline = false;
        attached.resumeNetwork?.();
      }
      startupWatchdog.resume();
      resumeAfterForeground();
    };
    const handleOnline = () => {
      if (
        sourceGeneration !== sourceGenerationRef.current
        || sourceFailedRef.current
      ) return;
      const shouldResumeNetwork = networkWasOffline;
      networkWasOffline = false;
      if (shouldResumeNetwork) attached.resumeNetwork?.();
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

    // HLS.js may still be attaching its MediaSource on the first call.
    // Retry when browser media readiness advances instead of leaving the
    // in-app player stalled until the user manually presses Play.
    startupWatchdog.start();
    if (
      document.visibilityState === 'hidden'
      || globalThis.navigator?.onLine === false
    ) {
      startupWatchdog.pause();
    }
    attemptPlayback();

    return () => {
      if (sourceGeneration === sourceGenerationRef.current) {
        sourceGenerationRef.current += 1;
      }
      disposeWatchdogs();
      video.removeEventListener('loadedmetadata', metadataLoaded);
      video.removeEventListener('progress', noteLoadingProgress);
      video.removeEventListener('canplay', readyToPlay);
      video.removeEventListener('playing', markPlaying);
      video.removeEventListener('waiting', markStalled);
      video.removeEventListener('stalled', markStalled);
      video.removeEventListener('pause', clearStall);
      video.removeEventListener('ended', clearStall);
      video.removeEventListener('error', mediaError);
      nativeAudioTracks?.removeEventListener?.('addtrack', nativeTracksChanged);
      nativeAudioTracks?.removeEventListener?.('removetrack', nativeTracksChanged);
      nativeAudioTracks?.removeEventListener?.('change', nativeTracksChanged);
      nativeTextTracks.removeEventListener('addtrack', nativeTracksChanged);
      nativeTextTracks.removeEventListener('removetrack', nativeTracksChanged);
      nativeTextTracks.removeEventListener('change', nativeTracksChanged);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageResume);
      window.removeEventListener('focus', handlePageResume);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (attachedSourceRef.current === attached) attachedSourceRef.current = null;
      if (reportSourceFailureRef.current === reportSourceFailure) {
        reportSourceFailureRef.current = () => undefined;
      }
      attached.destroy();
    };
  }, [source]);

  useEffect(() => {
    if (!attachedSourceRef.current?.usesHlsJs || !selectedAudioTrackId) return;
    attachedSourceRef.current.selectAudioTrack(selectedAudioTrackId);
  }, [selectedAudioTrackId]);

  useEffect(() => {
    if (!attachedSourceRef.current?.usesHlsJs) return;
    attachedSourceRef.current.selectPreferredAudioTrack?.();
  }, [preferredAudioSignature]);

  useEffect(() => {
    if (!attachedSourceRef.current?.usesHlsJs) {
      applyPreferredBrowserTracks();
      return;
    }

    if (!embeddedSubtitlesEnabled) {
      attachedSourceRef.current.selectSubtitleTrack(null);
      return;
    }
    if (selectedEmbeddedSubtitleTrackId) {
      attachedSourceRef.current.selectSubtitleTrack(
        selectedEmbeddedSubtitleTrackId,
      );
    }
  }, [
    applyPreferredBrowserTracks,
    embeddedSubtitlesEnabled,
    selectedEmbeddedSubtitleTrackId,
  ]);

  useEffect(() => {
    if (
      !embeddedSubtitlesEnabled
      || !attachedSourceRef.current?.usesHlsJs
    ) return;
    attachedSourceRef.current.selectPreferredSubtitleTrack?.();
  }, [embeddedSubtitlesEnabled, preferredSubtitleSignature]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    const sourceGeneration = sourceGenerationRef.current;
    if (!video || sourceFailedRef.current || endedRef.current) return;
    autoplayPendingRef.current = false;
    if (video.paused) {
      try {
        const attempt = video.play();
        if (attempt && typeof attempt.then === 'function') {
          void attempt
            .then(() => {
              if (
                sourceGeneration !== sourceGenerationRef.current
                || sourceFailedRef.current
              ) return;
              resumeWhenVisibleRef.current = true;
              setTapToPlayRequired(false);
              setPlaying(true);
            })
            .catch((error: unknown) => {
              if (
                sourceGeneration !== sourceGenerationRef.current
                || sourceFailedRef.current
              ) return;
              const failure = classifyWebPlayFailure(error);
              if (failure === 'source-failed') {
                if (
                  shouldDeferWebPlayFailure(
                    failure,
                    attachedSourceRef.current?.usesHlsJs ?? false,
                    video.readyState,
                  )
                ) return;
                reportSourceFailureRef.current(
                  'Browser cannot play this video source',
                );
                return;
              }
              if (failure === 'interrupted') return;
              setTapToPlayRequired(true);
              setPlaying(false);
            });
        }
      } catch (error: unknown) {
        const failure = classifyWebPlayFailure(error);
        if (failure === 'source-failed') {
          if (
            shouldDeferWebPlayFailure(
              failure,
              attachedSourceRef.current?.usesHlsJs ?? false,
              video.readyState,
            )
          ) return;
          reportSourceFailureRef.current(
            'Browser cannot play this video source',
          );
          return;
        }
        if (failure === 'interrupted') return;
        setTapToPlayRequired(true);
        setPlaying(false);
      }
    } else {
      resumeWhenVisibleRef.current = false;
      video.pause();
    }
    setControlsVisible(true);
  }, []);

  const seekBy = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video || sourceFailedRef.current || endedRef.current) return;
    const max = Number.isFinite(video.duration) ? video.duration : Math.max(0, video.currentTime + seconds);
    video.currentTime = Math.min(max, Math.max(0, video.currentTime + seconds));
    updateProgress();
  }, [updateProgress]);

  const cyclePlaybackRate = useCallback(() => {
    setPlaybackRate((current) => nextPlaybackRate(current));
    setControlsVisible(true);
  }, []);

  const toggleContentFit = useCallback(() => {
    setContentFit(toggleVideoFitMode);
    setControlsVisible(true);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      await toggleWebVideoFullscreen(
        video as HTMLVideoElement & { webkitEnterFullscreen?: () => void },
        document,
      );
    } catch {
      // Keep the app-owned full-screen overlay when the browser blocks fullscreen.
    }
  }, []);

  const seekFromPress = useCallback((event: { nativeEvent?: { locationX?: number } }) => {
    const video = videoRef.current;
    const locationX = event.nativeEvent?.locationX;
    if (!video || sourceFailedRef.current || endedRef.current || typeof locationX !== 'number' || !duration || !progressWidth) return;
    video.currentTime = Math.max(0, Math.min(duration, duration * (locationX / progressWidth)));
    updateProgress();
  }, [duration, progressWidth, updateProgress]);

  const videoElement = React.createElement('video', {
    ref: videoRef,
    autoPlay: false,
    playsInline: true,
    controls: false,
    preload: 'auto',
    muted,
    onPlay: () => {
      if (sourceFailedRef.current || endedRef.current) return;
      autoplayPendingRef.current = false;
      resumeWhenVisibleRef.current = true;
      setTapToPlayRequired(false);
      updateProgress();
    },
    onPause: () => {
      if (sourceFailedRef.current || endedRef.current) return;
      updateProgress();
    },
    onTimeUpdate: updateProgress,
    onLoadedMetadata: () => {
      const video = videoRef.current;
      if (sourceFailedRef.current || endedRef.current) return;
      if (video && !initialAppliedRef.current && initialPositionSeconds > 0) {
        video.currentTime = initialPositionSeconds;
        initialAppliedRef.current = true;
      }
      applyPreferredBrowserTracks();
      updateProgress();
    },
    onDurationChange: () => {
      if (sourceFailedRef.current || endedRef.current) return;
      updateProgress();
    },
    onEnded: () => {
      if (endedRef.current || sourceFailedRef.current) return;
      endedRef.current = true;
      resumeWhenVisibleRef.current = false;
      updateProgress();
      onEnded?.();
    },
    onClick: () => setControlsVisible((visible) => !visible),
    'data-testid': testID,
    style: {
      width: '100%',
      height: '100%',
      display: 'block',
      objectFit: contentFit,
      backgroundColor: '#000000',
    },
  });

  return (
    <View style={styles.root}>
      {videoElement}
      {tapToPlayRequired ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('playback.play')}
          testID="web-video-tap-to-play"
          onPress={togglePlayback}
          style={styles.tapToPlayOverlay}
        >
          <View style={styles.tapToPlayButton}>
            <Text style={styles.tapToPlayIcon}>▶</Text>
          </View>
          <Text style={styles.tapToPlayText}>{t('playback.play')}</Text>
        </Pressable>
      ) : null}
      {locked ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('playback.unlockControls')}
          testID="web-video-unlock"
          onPress={onToggleLock}
          style={styles.unlockButton}
        >
          <Text style={styles.unlockIcon}>🔒</Text>
        </Pressable>
      ) : null}
      {controlsVisible && !locked ? (
        <>
          <View pointerEvents="box-none" style={styles.centerControls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back 10 seconds"
              onPress={() => seekBy(-10)}
              style={styles.centerSeekButton}
            >
              <Text style={styles.centerSeekText}>↶10</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={playing ? 'Pause' : t('playback.play')}
              onPress={togglePlayback}
              style={styles.playButton}
            >
              <Text style={styles.playIcon}>{playing ? 'Ⅱ' : '▶'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Forward 10 seconds"
              onPress={() => seekBy(10)}
              style={styles.centerSeekButton}
            >
              <Text style={styles.centerSeekText}>10↷</Text>
            </Pressable>
          </View>
          <View
            style={[
              styles.bottomControls,
              {
                left: safeInsetEdge(18, safeAreaInsets.left, 8),
                right: safeInsetEdge(18, safeAreaInsets.right, 8),
                bottom: safeInsetEdge(18, safeAreaInsets.bottom, 8),
              },
            ]}
          >
            {title ? (
              <View style={styles.titleBlock}>
                <Text numberOfLines={1} style={styles.titleText}>{title}</Text>
                {meta ? <Text numberOfLines={1} style={styles.metaText}>{meta}</Text> : null}
                {submeta ? <Text numberOfLines={1} style={styles.submetaText}>{submeta}</Text> : null}
              </View>
            ) : null}
            <Pressable
              onPress={seekFromPress}
              onLayout={(event) => setProgressWidth(Math.max(1, event.nativeEvent.layout.width))}
              style={styles.progressTrack}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${duration > 0
                      ? Math.min(100, (position / duration) * 100)
                      : 0}%` as `${number}%`,
                  },
                ]}
              />
            </Pressable>
            <View style={styles.controlRow}>
              <Text style={styles.timeText}>{formatTime(position)} / {formatTime(duration)}</Text>
              <View style={styles.flex} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Playback speed ${playbackRate}x`}
                testID="web-video-playback-rate"
                onPress={cyclePlaybackRate}
                style={styles.textControlButton}
              >
                <Text style={styles.textControlText}>{playbackRate}×</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={contentFit === 'contain' ? 'Fill screen' : 'Fit whole video'}
                testID="web-video-content-fit"
                onPress={toggleContentFit}
                style={styles.textControlButton}
              >
                <Text style={styles.textControlText}>
                  {contentFit === 'contain' ? 'FILL' : 'FIT'}
                </Text>
              </Pressable>
              <Pressable onPress={() => setMuted((value) => !value)} style={styles.iconButton}>
                <Text style={styles.iconText}>{muted ? '🔇' : '🔊'}</Text>
              </Pressable>
              {onOpenSubtitles ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={subtitleLabel ?? t('playback.subtitles')}
                  testID="web-video-subtitles"
                  onPress={onOpenSubtitles}
                  style={styles.textControlButton}
                >
                  <Text style={styles.textControlText}>CC</Text>
                </Pressable>
              ) : null}
              {onOpenAudio ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={audioLabel ?? t('playback.audioLanguage')}
                  testID="web-video-audio"
                  onPress={onOpenAudio}
                  style={styles.textControlButton}
                >
                  <Text style={styles.textControlText}>AUDIO</Text>
                </Pressable>
              ) : null}
              {onOpenSource ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={sourceLabel ?? t('playback.changeSource')}
                  testID="web-video-source"
                  onPress={onOpenSource}
                  style={styles.textControlButton}
                >
                  <Text style={styles.textControlText}>SOURCE</Text>
                </Pressable>
              ) : null}
              {onNextEpisode ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={nextEpisodeLabel ?? t('playback.nextEpisode')}
                  testID="web-video-next-episode"
                  onPress={onNextEpisode}
                  style={styles.textControlButton}
                >
                  <Text style={styles.textControlText}>NEXT</Text>
                </Pressable>
              ) : null}
              {onDownload ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={downloadLabel ?? t('playback.download')}
                  testID="web-video-download"
                  onPress={onDownload}
                  style={styles.textControlButton}
                >
                  <Text style={styles.textControlText}>SAVE</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('playback.fullscreen')}
                testID="web-video-fullscreen"
                onPress={() => { void toggleFullscreen(); }}
                style={styles.iconButton}
              >
                <Text style={styles.fullscreenIcon}>⛶</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('playback.lockControls')}
                testID="web-video-lock"
                onPress={onToggleLock}
                style={styles.iconButton}
              >
                <Text style={styles.iconText}>🔒</Text>
              </Pressable>
            </View>
          </View>
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
  tapToPlayOverlay: {
    position: 'absolute',
    zIndex: 3,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  tapToPlayButton: {
    width: 68,
    height: 68,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  tapToPlayIcon: { color: '#0a0a0c', fontSize: 25, fontWeight: '900' },
  tapToPlayText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  unlockButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,14,0.55)',
  },
  unlockIcon: { fontSize: 18 },
  titleBlock: { gap: 2, marginBottom: 6 },
  titleText: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  metaText: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '700' },
  submetaText: { color: 'rgba(255,255,255,0.55)', fontSize: 11 },
  centerControls: {
    position: 'absolute',
    zIndex: 2,
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
  centerSeekText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  bottomControls: {
    position: 'absolute',
    zIndex: 2,
    left: 18,
    right: 18,
    bottom: 18,
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(8,8,11,0.78)',
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
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: {
    minWidth: 38,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
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
  timeText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },
  flex: { flex: 1 },
});

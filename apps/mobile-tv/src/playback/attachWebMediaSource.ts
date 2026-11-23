import Hls, { ErrorTypes, Events } from 'hls.js';
import type { AudioTrack, EmbeddedSubtitleTrack, StreamSource } from '@moviestv/core';
import { preferredLanguageTrackIndex } from './preferredTrack';
import { webContainerDecision } from './webContainerSupport';
import {
  nativePlayerAvailable,
  requestNativePlayback,
  stopNativePlayback,
} from './nativePlaybackBridge';
import {
  remuxFallbackAvailable,
  requestRemuxSource,
  unplayableSourceMessage,
  type UnplayableReason,
} from './webRemuxFallback';

function mediaType(source: StreamSource): string {
  return source.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function looksLikeHls(source: StreamSource): boolean {
  const contentType = mediaType(source);
  const filename = source.filename?.trim().toLowerCase() ?? '';
  if (
    contentType === 'application/vnd.apple.mpegurl'
    || contentType === 'application/x-mpegurl'
    || contentType === 'application/mpegurl'
    || contentType === 'audio/mpegurl'
    || contentType === 'audio/x-mpegurl'
    || /\.m3u8(?:$|[?#])/i.test(source.url)
    || /\.m3u8$/i.test(filename)
  ) {
    return true;
  }

  try {
    const url = new URL(source.url);
    if (/(?:^|\/)hls(?:\/|$)/i.test(url.pathname)) return true;

    for (const [name, value] of url.searchParams) {
      if (!/format|type|mime|content|container|filename|file|stream|url|src|source|playlist|media/i.test(name)) continue;
      if (/m3u8|mpegurl|\bhls\b/i.test(value)) return true;
    }
  } catch {
    // Invalid source URLs are rejected before playback.
  }

  return false;
}

export function isMixedContentWebSource(
  source: StreamSource,
  pageProtocol = globalThis.location?.protocol,
): boolean {
  return pageProtocol === 'https:' && /^http:\/\//i.test(source.url);
}

function explicitProgressiveContainer(
  source: StreamSource,
): 'mp4' | 'm4v' | 'mov' | null {
  const filename = source.filename?.trim().toLowerCase() ?? '';
  const contentType = mediaType(source);
  if (contentType === 'video/mp4') return 'mp4';
  if (contentType === 'video/x-m4v') return 'm4v';
  if (contentType === 'video/quicktime') return 'mov';
  if (/\.mp4(?:$|[?#])/i.test(source.url) || /\.mp4$/i.test(filename)) return 'mp4';
  if (/\.m4v(?:$|[?#])/i.test(source.url) || /\.m4v$/i.test(filename)) return 'm4v';
  if (/\.mov(?:$|[?#])/i.test(source.url) || /\.mov$/i.test(filename)) return 'mov';

  try {
    const url = new URL(source.url);
    for (const [name, value] of url.searchParams) {
      if (!/format|type|mime|container|filename|file|stream|url|src|source|playlist|media/i.test(name)) continue;
      if (/\b(?:mp4|video\/mp4)\b/i.test(value)) return 'mp4';
      if (/\bm4v\b/i.test(value)) return 'm4v';
      if (/\b(?:mov|quicktime|video\/quicktime)\b/i.test(value)) return 'mov';
    }
  } catch {
    // Invalid URLs are rejected elsewhere.
  }

  return null;
}

function browserRejectsExplicitCodec(
  video: HTMLVideoElement,
  source: StreamSource,
): boolean {
  const container = explicitProgressiveContainer(source);
  if (!container) return false;
  const codec = (
    source.codecDetail
    ?? source.codec
  )?.trim().toLowerCase();
  if (!codec) return false;

  const mime = container === 'mov' ? 'video/quicktime' : 'video/mp4';
  const supports = (codecValue: string) => Boolean(
    video.canPlayType(`${mime}; codecs="${codecValue}"`)
    || (
      mime !== 'video/mp4'
      && video.canPlayType(`video/mp4; codecs="${codecValue}"`)
    ),
  );

  const exactCodec = codec.match(/^(avc1|hvc1|hev1|dvhe|dvh1|av01)(?:\.[a-z0-9]+)+/i)?.[0];

  if (/^(?:h\.?264|x264|avc|avc1)\b/.test(codec)) {
    return ![
      ...(exactCodec ? [exactCodec] : []),
      'avc1.42E01E',
    ].some(supports);
  }
  if (/^(?:h\.?265|x265|hevc|hvc1|hev1|dvhe|dvh1)\b/.test(codec)) {
    return ![
      ...(exactCodec ? [exactCodec] : []),
      'hvc1',
      'hvc1.1.6.L93.B0',
      'hvc1.2.4.L123.B0',
      'hev1',
      'hev1.2.4.L120.B0',
    ].some(supports);
  }
  if (/^(?:av1|av01)\b/.test(codec)) {
    return ![
      ...(exactCodec ? [exactCodec] : []),
      'av01.0.05M.08',
    ].some(supports);
  }

  return false;
}


function riskyAudioCodecFromContentType(
  contentType: string | undefined,
): StreamSource['audioCodec'] | undefined {
  if (!contentType) return undefined;
  const match = contentType.match(
    /(?:^|;)\s*codecs\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;]*))/i,
  );
  const declared = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!declared) return undefined;

  for (const raw of declared.split(',').slice(0, 16)) {
    const codec = raw.trim().toLowerCase();
    if (/^(?:mlpa|true[ ._-]?hd)(?:\b|[ .:_-])/.test(codec)) {
      return 'truehd';
    }
    if (
      /^dts(?:c|h|e|l|x|y)(?:\b|[ .:_-])/.test(codec)
      || /^dts(?:[ .:_-]?(?:hd(?:[ .:_-]?ma)?|x|ma))?(?:$|[ .:_-])/.test(codec)
    ) {
      return 'dts';
    }
  }
  return undefined;
}

function browserRejectsExplicitAudioCodec(
  video: HTMLVideoElement,
  source: StreamSource,
): boolean {
  const container = explicitProgressiveContainer(source);
  if (!container) return false;

  const label = `${source.filename ?? ''} ${source.name ?? ''}`.toLowerCase();
  const audioCodec = source.audioCodec
    ?? riskyAudioCodecFromContentType(source.contentType)
    ?? (/\btrue[ ._-]?hd\b/i.test(label)
      ? 'truehd'
      : /\bdts(?:[ .:_-]?(?:hd|x|ma))?\b/i.test(label)
        ? 'dts'
        : undefined);
  const codecCandidates = audioCodec === 'truehd'
    ? ['mlpa']
    : audioCodec === 'dts'
      ? ['dtsc', 'dtsh', 'dtse', 'dtsl', 'dtsx', 'dtsy']
      : [];

  if (!codecCandidates.length) return false;

  const containerMime = container === 'mov' ? 'video/quicktime' : 'video/mp4';
  const supports = (codecValue: string) => Boolean(
    video.canPlayType(`audio/mp4; codecs="${codecValue}"`)
    || video.canPlayType(`${containerMime}; codecs="${codecValue}"`)
    || (
      containerMime !== 'video/mp4'
      && video.canPlayType(`video/mp4; codecs="${codecValue}"`)
    ),
  );

  return !codecCandidates.some(supports);
}

function canPlayNativeHls(video: HTMLVideoElement): boolean {
  return Boolean(
    video.canPlayType('application/vnd.apple.mpegurl')
    || video.canPlayType('application/x-mpegURL'),
  );
}

function isBrowserForbiddenRequestHeader(name: string): boolean {
  const normalized = name.trim();
  return /^(?:accept-charset|accept-encoding|access-control-request-headers|access-control-request-method|connection|content-length|cookie|cookie2|date|dnt|expect|host|keep-alive|origin|permissions-policy|referer|set-cookie|te|trailer|transfer-encoding|upgrade|user-agent|via)$/i.test(normalized)
    || /^(?:sec-|proxy-)/i.test(normalized);
}

function browserSettableRequestHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const entries = Object.entries(headers).filter(
    ([name]) => !isBrowserForbiddenRequestHeader(name),
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function applyHeaders(xhr: XMLHttpRequest, headers?: Record<string, string>): void {
  if (!headers) return;
  for (const [name, value] of Object.entries(headers)) {
    try {
      xhr.setRequestHeader(name, value);
    } catch {
      // Ignore browser-forbidden request headers; provider failover can still run.
    }
  }
}

function hlsAudioTracks(hls: Hls): AudioTrack[] {
  return hls.audioTracks.map((track, index) => ({
    id: `hls-audio:${index}`,
    language: track.lang || 'und',
    label: track.name || track.lang || `Track ${index + 1}`,
  }));
}

function hlsResponseStatus(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  const response = (data as { response?: { code?: unknown } }).response;
  const rawCode = response?.code;
  const code = typeof rawCode === 'number'
    ? rawCode
    : typeof rawCode === 'string' && /^\d{3}$/.test(rawCode.trim())
      ? Number(rawCode.trim())
      : Number.NaN;
  return Number.isFinite(code)
    && code >= 100
    && code <= 599
    ? code
    : null;
}

function hlsSubtitleTracks(hls: Hls): EmbeddedSubtitleTrack[] {
  return hls.subtitleTracks.map((track, index) => ({
    id: `hls-subtitle:${index}`,
    language: track.lang || 'und',
    label: track.name || track.lang || `Track ${index + 1}`,
  }));
}

export interface WebMediaAudioOptions {
  preferredLanguages?: readonly string[];
  selectedTrackId?: string | null;
  onTracksChange?(tracks: AudioTrack[], selectedTrackId: string | null): void;
  preferredSubtitleLanguages?: readonly string[];
  selectedSubtitleTrackId?: string | null;
  subtitlesEnabled?: boolean;
  preservePositionOnReconnect?: boolean;
  onSubtitleTracksChange?(
    tracks: EmbeddedSubtitleTrack[],
    selectedTrackId: string | null,
  ): void;
}

export interface AttachedWebMediaSource {
  usesHlsJs: boolean;
  selectAudioTrack(trackId: string | null): boolean;
  selectSubtitleTrack(trackId: string | null): boolean;
  selectPreferredAudioTrack?(): boolean;
  selectPreferredSubtitleTrack?(): boolean;
  pauseNetwork?(): boolean;
  resumeNetwork?(): boolean;
  destroy(): void;
}

/**
 * A source the engine cannot demux: play it natively when the macOS wrapper is
 * present, otherwise remux it server-side, otherwise fail with a message that
 * names the container and the audio codec instead of the resolution.
 */
function attachUnplayableSource(
  video: HTMLVideoElement,
  source: StreamSource,
  onPlaybackError: ((message?: string) => void) | undefined,
  audioOptions: WebMediaAudioOptions | undefined,
  reason: UnplayableReason,
): AttachedWebMediaSource {
  video.removeAttribute('src');
  video.load();

  if (nativePlayerAvailable() && requestNativePlayback(source, { video })) {
    return {
      usesHlsJs: false,
      selectAudioTrack() { return false; },
      selectSubtitleTrack() { return false; },
      destroy() { stopNativePlayback(); },
    };
  }

  let inner: AttachedWebMediaSource | null = null;
  let destroyed = false;

  const controller: AttachedWebMediaSource = {
    usesHlsJs: false,
    selectAudioTrack(trackId: string | null) { return inner?.selectAudioTrack(trackId) ?? false; },
    selectSubtitleTrack(trackId: string | null) { return inner?.selectSubtitleTrack(trackId) ?? false; },
    selectPreferredAudioTrack() { return inner?.selectPreferredAudioTrack?.() ?? false; },
    selectPreferredSubtitleTrack() { return inner?.selectPreferredSubtitleTrack?.() ?? false; },
    pauseNetwork() { return inner?.pauseNetwork?.() ?? false; },
    resumeNetwork() { return inner?.resumeNetwork?.() ?? false; },
    destroy() { destroyed = true; inner?.destroy(); },
  };

  void (async () => {
    const remuxed = remuxFallbackAvailable()
      ? await requestRemuxSource(source)
      : null;
    if (destroyed) return;
    if (!remuxed) {
      onPlaybackError?.(unplayableSourceMessage(source, {
        reason,
        nativePlayerAvailable: nativePlayerAvailable(),
        remuxConfigured: remuxFallbackAvailable(),
      }));
      return;
    }
    inner = attachWebMediaSource(video, remuxed, onPlaybackError, audioOptions);
    controller.usesHlsJs = inner.usesHlsJs;
  })();

  return controller;
}

export function attachWebMediaSource(
  video: HTMLVideoElement,
  source: StreamSource,
  onPlaybackError?: (message?: string) => void,
  audioOptions?: WebMediaAudioOptions,
): AttachedWebMediaSource {
  const hlsSource = looksLikeHls(source);
  // Treat notWebReady as a ranking hint, not an absolute browser veto.
  // Providers sometimes apply it conservatively to opaque direct URLs even
  // when iOS Safari can play the actual H.264/HEVC media. Known bad containers
  // and insecure URLs are still rejected below. Header-advertised sources stay
  // eligible as a last chance because the header may be advisory and Safari
  // may still play the signed URL directly; a real media error then triggers
  // normal source failover.
  if (isMixedContentWebSource(source)) {
    video.removeAttribute('src');
    video.load();
    void Promise.resolve().then(() => {
      onPlaybackError?.(
        'This media source uses insecure HTTP and is blocked by the HTTPS web app',
      );
    });
    return {
      usesHlsJs: false,
      selectAudioTrack() {
        return false;
      },
      selectSubtitleTrack() {
        return false;
      },
      destroy() {
        video.removeAttribute('src');
        video.load();
      },
    };
  }

  const settableHeaders = browserSettableRequestHeaders(source.headers);
  const hasSettableHeaders = Boolean(
    settableHeaders && Object.keys(settableHeaders).length,
  );
  const hlsJsSupported = Hls.isSupported();
  const nativeHlsSupported = hlsSource && canPlayNativeHls(video);

  if (!hlsSource && browserRejectsExplicitCodec(video, source)) {
    return attachUnplayableSource(video, source, onPlaybackError, audioOptions, 'video-codec');
  }

  if (!hlsSource && browserRejectsExplicitAudioCodec(video, source)) {
    return attachUnplayableSource(video, source, onPlaybackError, audioOptions, 'audio-codec');
  }

  // Progressive browser media and HLS are attached directly. Containers the
  // current engine cannot demux must fail over before attaching, otherwise the
  // player waits for the startup watchdog to fire. WebKit has no Matroska
  // support at all, while Chromium advertises it through canPlayType and does
  // play MKV files whose codecs it supports.
  const containerDecision = hlsSource ? null : webContainerDecision(video, source);
  if (containerDecision?.rejects) {
    return attachUnplayableSource(video, source, onPlaybackError, audioOptions, 'container');
  }

  // If HLS.js is unavailable (notably some Safari/iOS paths), still let the
  // native media element try the URL without JavaScript-settable headers.
  // Providers sometimes include optional proxy headers even when the signed
  // URL itself is sufficient. Ranking already keeps these sources behind
  // headerless alternatives, so this is a safe last-chance attempt.
  // Only feed HLS.js sources we can positively identify as HLS. Passing an
  // arbitrary extensionless movie URL to HLS.js just because it needs headers
  // can turn a valid progressive response into a manifest parse failure.
  const useHlsJs = hlsJsSupported
    && hlsSource
    && (!nativeHlsSupported || hasSettableHeaders);

  // Progressive media elements cannot inject custom request headers, but the
  // header can be advisory/optional on some providers. Try the direct URL as a
  // final browser fallback and let the native media error path move on quickly
  // if the upstream actually requires the header.
  if (!useHlsJs) {
    let pendingResumeListener: (() => void) | null = null;
    let pausedResumeTime: number | null = null;

    const clearPendingResume = () => {
      if (
        pendingResumeListener
        && typeof video.removeEventListener === 'function'
      ) {
        video.removeEventListener(
          'loadedmetadata',
          pendingResumeListener,
        );
      }
      pendingResumeListener = null;
    };

    const captureResumeTime = () => (
      audioOptions?.preservePositionOnReconnect === false
        ? 0
        : Number.isFinite(video.currentTime)
          ? Math.max(0, video.currentTime)
          : 0
    );

    const pauseDirectNetwork = () => {
      if (pausedResumeTime === null) {
        pausedResumeTime = captureResumeTime();
      }
      clearPendingResume();
      video.removeAttribute('src');
      video.load();
      return true;
    };

    if (globalThis.navigator?.onLine === false) {
      pauseDirectNetwork();
    } else {
      video.src = source.url;
    }

    return {
      usesHlsJs: false,
      selectAudioTrack() {
        return false;
      },
      selectSubtitleTrack() {
        return false;
      },
      pauseNetwork() {
        return pauseDirectNetwork();
      },
      resumeNetwork() {
        clearPendingResume();

        const resumeTime = pausedResumeTime ?? captureResumeTime();
        pausedResumeTime = null;
        if (
          resumeTime > 0
          && typeof video.addEventListener === 'function'
          && typeof video.removeEventListener === 'function'
        ) {
          const restorePosition = () => {
            video.removeEventListener(
              'loadedmetadata',
              restorePosition,
            );
            if (pendingResumeListener === restorePosition) {
              pendingResumeListener = null;
            }
            try {
              video.currentTime = resumeTime;
            } catch {
              // Live streams or freshly renewed URLs may not be seekable.
            }
          };
          pendingResumeListener = restorePosition;
          video.addEventListener('loadedmetadata', restorePosition);
        }
        video.src = source.url;
        video.load();
        return true;
      },
      destroy() {
        clearPendingResume();
        pausedResumeTime = null;
        video.removeAttribute('src');
        video.load();
      },
    };
  }

  let recoveredMediaError = false;
  let recoveredNetworkError = false;
  let terminalErrorReported = false;
  let nativeFallbackTried = false;
  let networkPausedForOffline = globalThis.navigator?.onLine === false;
  let manifestLoaded = false;
  let usingHlsJs = true;
  let selectedAudioTrackId = audioOptions?.selectedTrackId ?? null;
  let selectedSubtitleTrackId = audioOptions?.selectedSubtitleTrackId ?? null;
  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: true,
    xhrSetup: (xhr) => applyHeaders(xhr, settableHeaders),
  });

  const notifyAudioTracks = () => {
    if (!usingHlsJs) return;
    const tracks = hlsAudioTracks(hls);
    if (!tracks.length) {
      audioOptions?.onTracksChange?.([], null);
      return;
    }

    let selectedIndex = selectedAudioTrackId
      ? tracks.findIndex((track) => track.id === selectedAudioTrackId)
      : -1;

    if (selectedIndex < 0) {
      selectedIndex = preferredLanguageTrackIndex(
        tracks,
        audioOptions?.preferredLanguages ?? [],
      );
    }
    if (selectedIndex < 0) selectedIndex = Math.max(0, hls.audioTrack);

    if (selectedIndex >= 0 && selectedIndex < tracks.length) {
      hls.audioTrack = selectedIndex;
      selectedAudioTrackId = tracks[selectedIndex]?.id ?? null;
    }

    audioOptions?.onTracksChange?.(tracks, selectedAudioTrackId);
  };

  const notifySubtitleTracks = () => {
    if (!usingHlsJs) return;
    const tracks = hlsSubtitleTracks(hls);
    if (!tracks.length) {
      audioOptions?.onSubtitleTracksChange?.([], null);
      return;
    }

    if (!audioOptions?.subtitlesEnabled) {
      hls.subtitleTrack = -1;
      selectedSubtitleTrackId = null;
      audioOptions?.onSubtitleTracksChange?.(tracks, null);
      return;
    }

    let selectedIndex = selectedSubtitleTrackId
      ? tracks.findIndex((track) => track.id === selectedSubtitleTrackId)
      : -1;

    if (selectedIndex < 0) {
      selectedIndex = preferredLanguageTrackIndex(
        tracks,
        audioOptions?.preferredSubtitleLanguages ?? [],
      );
    }
    if (selectedIndex < 0 && tracks.length > 0) selectedIndex = 0;

    hls.subtitleTrack = selectedIndex;
    selectedSubtitleTrackId = tracks[selectedIndex]?.id ?? null;
    audioOptions?.onSubtitleTracksChange?.(tracks, selectedSubtitleTrackId);
  };

  hls.on(Events.AUDIO_TRACKS_UPDATED, () => {
    notifyAudioTracks();
  });
  hls.on(Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
    if (!usingHlsJs) return;
    const tracks = hlsAudioTracks(hls);
    selectedAudioTrackId = tracks[data.id]?.id ?? null;
    audioOptions?.onTracksChange?.(tracks, selectedAudioTrackId);
  });
  hls.on(Events.MANIFEST_PARSED, () => {
    if (!usingHlsJs) return;
    manifestLoaded = true;
    notifySubtitleTracks();
  });
  hls.on(Events.SUBTITLE_TRACKS_UPDATED, () => {
    notifySubtitleTracks();
  });

  const tryNativeHlsFallback = (): boolean => {
    if (
      nativeFallbackTried
      || !nativeHlsSupported
      || !hasSettableHeaders
      || terminalErrorReported
      || video.currentTime > 0.5
    ) return false;

    nativeFallbackTried = true;
    usingHlsJs = false;
    selectedAudioTrackId = null;
    selectedSubtitleTrackId = null;
    audioOptions?.onTracksChange?.([], null);
    audioOptions?.onSubtitleTracksChange?.([], null);
    try {
      hls.destroy();
    } catch {
      // The native media element can still attempt the URL directly.
    }
    video.src = source.url;
    video.load();
    return true;
  };

  const reportHlsFailure = (details?: string) => {
    if (terminalErrorReported) return;
    terminalErrorReported = true;
    try {
      hls.stopLoad();
    } catch {
      // The controller will replace/destroy the failed source immediately.
    }
    onPlaybackError?.(
      details
        ? `HLS playback failed: ${details}`
        : 'HLS playback failed',
    );
  };

  hls.on(Events.ERROR, (_event, data) => {
    if (!usingHlsJs || !data.fatal || terminalErrorReported) return;

    const responseStatus = hlsResponseStatus(data);
    if (
      data.type === ErrorTypes.NETWORK_ERROR
      && globalThis.navigator?.onLine === false
    ) {
      networkPausedForOffline = true;
      try {
        hls.stopLoad();
      } catch {
        // The online lifecycle hook will retry when connectivity returns.
      }
      return;
    }
    if (
      data.type === ErrorTypes.NETWORK_ERROR
      && responseStatus === null
      && tryNativeHlsFallback()
    ) {
      // Most often this is a CORS/preflight failure caused by an optional
      // provider header. Native Safari HLS may still play the signed URL.
      return;
    }
    if (
      data.type === ErrorTypes.NETWORK_ERROR
      && responseStatus !== null
      && [401, 403, 404, 410].includes(responseStatus)
    ) {
      // Retrying the same expired/denied signed URL only delays provider
      // re-resolution. Hand it back to the normal source-refresh path now.
      reportHlsFailure(data.details);
      return;
    }

    if (data.type === ErrorTypes.NETWORK_ERROR && !recoveredNetworkError) {
      recoveredNetworkError = true;
      hls.startLoad();
      return;
    }

    if (
      data.type === ErrorTypes.MEDIA_ERROR
      && tryNativeHlsFallback()
    ) {
      // Safari's native HLS stack can support codecs/container details that
      // the MSE/hls.js path rejects. Try native playback once at startup.
      return;
    }

    if (data.type === ErrorTypes.MEDIA_ERROR && !recoveredMediaError) {
      recoveredMediaError = true;
      hls.recoverMediaError();
      return;
    }

    reportHlsFailure(data.details);
  });

  hls.on(Events.MEDIA_ATTACHED, () => {
    if (!usingHlsJs) return;
    recoveredNetworkError = false;
    recoveredMediaError = false;
    if (
      networkPausedForOffline
      || globalThis.navigator?.onLine === false
    ) {
      networkPausedForOffline = true;
      try {
        hls.stopLoad();
      } catch {
        // The online lifecycle hook will begin loading after connectivity returns.
      }
      return;
    }
    hls.loadSource(source.url);
  });
  hls.on(Events.FRAG_LOADED, () => {
    if (!usingHlsJs) return;
    networkPausedForOffline = false;
    recoveredNetworkError = false;
    recoveredMediaError = false;
  });

  // Register every lifecycle handler before attaching the media element.
  // This avoids losing a very fast MEDIA_ATTACHED event in browsers/hls.js
  // versions that can complete attachment synchronously.
  hls.attachMedia(video);

  return {
    get usesHlsJs() {
      return usingHlsJs;
    },
    selectAudioTrack(trackId) {
      if (!usingHlsJs) return false;
      const tracks = hlsAudioTracks(hls);
      const index = trackId
        ? tracks.findIndex((track) => track.id === trackId)
        : -1;
      if (index < 0) return false;
      selectedAudioTrackId = trackId;
      hls.audioTrack = index;
      audioOptions?.onTracksChange?.(tracks, trackId);
      return true;
    },
    selectSubtitleTrack(trackId) {
      if (!usingHlsJs) return false;
      const tracks = hlsSubtitleTracks(hls);
      if (trackId === null) {
        hls.subtitleTrack = -1;
        selectedSubtitleTrackId = null;
        audioOptions?.onSubtitleTracksChange?.(tracks, null);
        return true;
      }
      const index = tracks.findIndex((track) => track.id === trackId);
      if (index < 0) return false;
      selectedSubtitleTrackId = trackId;
      hls.subtitleTrack = index;
      audioOptions?.onSubtitleTracksChange?.(tracks, trackId);
      return true;
    },
    selectPreferredAudioTrack() {
      if (!usingHlsJs) return false;
      selectedAudioTrackId = null;
      notifyAudioTracks();
      return hls.audioTracks.length > 0;
    },
    selectPreferredSubtitleTrack() {
      if (!usingHlsJs) return false;
      selectedSubtitleTrackId = null;
      notifySubtitleTracks();
      return hls.subtitleTracks.length > 0;
    },
    pauseNetwork() {
      if (!usingHlsJs || terminalErrorReported) return false;
      networkPausedForOffline = true;
      try {
        hls.stopLoad();
      } catch {
        return false;
      }
      return true;
    },
    resumeNetwork() {
      if (
        !usingHlsJs
        || terminalErrorReported
        || !networkPausedForOffline
      ) return false;
      networkPausedForOffline = false;
      recoveredNetworkError = false;
      if (manifestLoaded) {
        hls.startLoad();
      } else {
        hls.loadSource(source.url);
      }
      return true;
    },
    destroy() {
      if (usingHlsJs) {
        usingHlsJs = false;
        hls.destroy();
      }
      video.removeAttribute('src');
      video.load();
    },
  };
}

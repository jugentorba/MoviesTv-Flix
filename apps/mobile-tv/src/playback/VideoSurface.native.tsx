import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { StreamSource } from '@moviestv/core';
import { ExpoVideoSurface } from './ExpoVideoSurface.native';
import { VlcVideoSurface } from './VlcVideoSurface.native';
import { NATIVE_FORMAT_PLAYBACK_ERROR } from './playbackError';
import { playbackSourceFingerprint } from './playbackSourceIdentity';

type VideoSurfaceProps = React.ComponentProps<typeof ExpoVideoSurface>;

/*
 * AVPlayer (expo-video) demuxes MP4/MOV/HLS. It cannot open Matroska, WebM,
 * AVI, FLV, WMV or RealMedia, and it rejects TrueHD/DTS audio, so those
 * sources start on the VLC engine instead of failing first.
 */
export function shouldPreferVlc(source: StreamSource): boolean {
  const contentType = source.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const filename = source.filename?.trim().toLowerCase() ?? '';
  const url = source.url.toLowerCase();

  return (
    /^(?:video\/(?:x-matroska|webm|x-msvideo|x-flv|x-ms-wmv)|application\/dash\+xml)$/.test(contentType)
    || /\.(?:mkv|webm|avi|flv|wmv|rm|rmvb|vob|ogv)(?:$|[?#])/i.test(url)
    || /\.(?:mkv|webm|avi|flv|wmv|rm|rmvb|vob|ogv)$/i.test(filename)
    || source.audioCodec === 'truehd'
    || source.audioCodec === 'dts'
  );
}

export function shouldRetryWithVlc(message?: string): boolean {
  return message?.trim() === NATIVE_FORMAT_PLAYBACK_ERROR;
}

export function VideoSurface(props: VideoSurfaceProps) {
  /*
   * A provider can republish an equivalent object while playback is active.
   * Keep recovery for that request, but retire the whole session when its URL,
   * headers or media format changes. The fingerprint keeps credentials out of
   * React keys.
   */
  return (
    <NativePlaybackSession
      key={playbackSourceFingerprint(props.source)}
      {...props}
    />
  );
}

function NativePlaybackSession(props: VideoSurfaceProps) {
  const [useVlc, setUseVlc] = useState(
    () => shouldPreferVlc(props.source),
  );
  const activeRef = useRef(true);
  const expoFailedRef = useRef(false);

  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
  }, []);

  const handleExpoPlaybackError = useCallback((message?: string) => {
    if (!activeRef.current || expoFailedRef.current) return;
    expoFailedRef.current = true;
    if (!useVlc && shouldRetryWithVlc(message)) {
      setUseVlc(true);
      return;
    }
    props.onPlaybackError?.(message);
  }, [props.onPlaybackError, useVlc]);

  if (useVlc) {
    return <VlcVideoSurface {...props} />;
  }

  return (
    <ExpoVideoSurface
      {...props}
      onPlaybackError={handleExpoPlaybackError}
    />
  );
}

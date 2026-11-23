import React from 'react';
import type { StreamSource } from '@moviestv/core';
import { LiveTvVideoSurface } from './LiveTvVideoSurface';

export function LiveTvPlayer({
  source,
  preferredAudioLanguages = [],
  onPress,
  onPlaybackError,
}: {
  source: StreamSource;
  preferredAudioLanguages?: readonly string[];
  onPress?(): void;
  onPlaybackError?(message?: string): void;
}) {
  return (
    <LiveTvVideoSurface
      source={source}
      preferredAudioLanguages={preferredAudioLanguages}
      testID="live-tv-player"
      onPress={onPress}
      onPlaybackError={onPlaybackError}
    />
  );
}

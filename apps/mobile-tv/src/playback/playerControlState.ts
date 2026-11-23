export const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const;

export type VideoFitMode = 'contain' | 'cover';

export function nextPlaybackRate(current: number): number {
  const index = PLAYBACK_RATES.findIndex((rate) => rate === current);
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length] ?? 1;
}

export function toggleVideoFitMode(current: VideoFitMode): VideoFitMode {
  return current === 'contain' ? 'cover' : 'contain';
}

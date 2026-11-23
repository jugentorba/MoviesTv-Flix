import type { PlaybackProgress } from '../../core/src';

export interface Timestamped<T> {
  value: T;
  updatedAt: string;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function chooseLatest<T>(local: Timestamped<T>, remote: Timestamped<T>): Timestamped<T> {
  return timestamp(remote.updatedAt) > timestamp(local.updatedAt) ? remote : local;
}

export function mergeProgress(
  local: Timestamped<PlaybackProgress>,
  remote: Timestamped<PlaybackProgress>,
  restarted: boolean,
): Timestamped<PlaybackProgress> {
  if (restarted) return chooseLatest(local, remote);
  return remote.value.positionMs > local.value.positionMs ? remote : local;
}

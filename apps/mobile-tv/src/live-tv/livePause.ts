/**
 * Whether a live channel can actually be paused.
 *
 * A plain live HLS stream has no window behind the live edge: `duration` comes
 * back as `Infinity` (or not at all) and pausing would either do nothing or
 * silently jump you back to live. Streams that expose a finite duration — a DVR
 * window, a VOD-style playlist served as "live", a local file — can be paused
 * and resumed where you left off.
 *
 * This is deliberately conservative: when the engine cannot tell us, the control
 * is not offered, because a pause button that does nothing is worse than none.
 */
export type LivePauseMode = 'pausable' | 'unavailable';

export function livePauseMode(durationSeconds: number | null | undefined): LivePauseMode {
  if (typeof durationSeconds !== 'number') return 'unavailable';
  if (!Number.isFinite(durationSeconds)) return 'unavailable';
  if (durationSeconds <= 0) return 'unavailable';
  return 'pausable';
}

/**
 * Position inside a DVR window, clamped to the stream.
 * Returns null when the channel cannot seek, so callers never invent a position.
 */
export function liveSeekTarget(
  requestedSeconds: number,
  durationSeconds: number | null | undefined,
): number | null {
  if (livePauseMode(durationSeconds) === 'unavailable') return null;
  const duration = durationSeconds as number;
  if (!Number.isFinite(requestedSeconds)) return null;
  return Math.max(0, Math.min(duration, requestedSeconds));
}

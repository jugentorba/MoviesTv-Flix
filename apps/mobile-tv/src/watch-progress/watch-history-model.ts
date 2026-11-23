import {
  dedupeWatchProgressRecords,
  type WatchProgressRecord,
} from '@moviestv/sync';

/** A history list is a reading surface, not an archive: bound it. */
export const MAX_WATCH_HISTORY_ROWS = 500;

function timestamp(value: string | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * Rows for the watch history screen: newest first, one row per media.
 *
 * Unlike Continue Watching this keeps completed and barely-started records —
 * the whole point of a history list is that it is complete.
 */
export function watchHistoryRecords(
  records: readonly WatchProgressRecord[],
): WatchProgressRecord[] {
  if (!Array.isArray(records) || !records.length) return [];
  return dedupeWatchProgressRecords(records)
    .sort((left, right) => (
      timestamp(right.updatedAt) - timestamp(left.updatedAt)
      || left.mediaId.localeCompare(right.mediaId)
    ))
    .slice(0, MAX_WATCH_HISTORY_ROWS);
}

/** Played fraction, clamped to 0…1, for the row's progress bar. */
export function watchProgressFraction(record: WatchProgressRecord): number {
  if (record.completed) return 1;
  const duration = record.durationSeconds;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const fraction = record.positionSeconds / duration;
  if (!Number.isFinite(fraction)) return 0;
  return Math.min(1, Math.max(0, fraction));
}

/** `S1E2` for an episode record, otherwise `undefined`. */
export function watchEpisodeCode(
  record: WatchProgressRecord,
): string | undefined {
  if (
    record.kind !== 'episode'
    || record.seasonNumber === undefined
    || record.episodeNumber === undefined
  ) return undefined;
  return `S${record.seasonNumber}E${record.episodeNumber}`;
}

/** Whole minutes watched, or `undefined` when nothing is known yet. */
export function watchPositionMinutes(
  record: WatchProgressRecord,
): number | undefined {
  if (!Number.isFinite(record.positionSeconds) || record.positionSeconds < 60) {
    return undefined;
  }
  return Math.floor(record.positionSeconds / 60);
}

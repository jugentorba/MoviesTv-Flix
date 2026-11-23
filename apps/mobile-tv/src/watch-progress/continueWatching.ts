import type { CatalogMediaItem } from '@moviestv/catalog';
import type { WatchProgressRecord } from '@moviestv/sync';

/**
 * The Continue Watching row, built from local progress instead of a provider.
 *
 * Catalog providers do not know what this person was watching, so the row is
 * synthesised: one card per title (an episode collapses into its series), newest
 * first, with the progress ratio needed to draw a bar on the poster.
 *
 * Filtering rules that matter:
 * - below 2% is a mis-tap, not "continue"
 * - above 95% is finished; offering it again is noise
 * - a title with no duration cannot be rendered as a bar, so it is skipped
 */
export interface ContinueWatchingEntry {
  item: CatalogMediaItem;
  /** 0–1, already clamped. */
  progress: number;
}

const MIN_PROGRESS = 0.02;
const MAX_PROGRESS = 0.95;
const PROVIDER_ID = 'continue-watching';

export function buildContinueWatching(
  records: readonly WatchProgressRecord[],
  limit = 20,
): ContinueWatchingEntry[] {
  const byKey = new Map<string, ContinueWatchingEntry & { updatedAt: number }>();

  for (const record of records) {
    if (!record.durationSeconds || record.durationSeconds <= 0) continue;
    if (record.completed) continue;
    const ratio = record.positionSeconds / record.durationSeconds;
    if (!Number.isFinite(ratio) || ratio < MIN_PROGRESS || ratio > MAX_PROGRESS) continue;

    const id = (record.seriesId ?? record.mediaId)?.trim();
    const title = record.title?.trim();
    if (!id || !title) continue;

    const updatedAt = Date.parse(record.updatedAt);
    const entry: ContinueWatchingEntry & { updatedAt: number } = {
      item: {
        id,
        title,
        kind: record.kind === 'episode' ? 'series' : 'movie',
        providerId: PROVIDER_ID,
        externalIds: record.externalIds ?? {},
        ...(record.posterUrl ? { posterUrl: record.posterUrl } : {}),
        ...(record.year ? { year: record.year } : {}),
      } as CatalogMediaItem,
      progress: Math.min(MAX_PROGRESS, Math.max(MIN_PROGRESS, ratio)),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    };

    // An episode and its series collapse to one card; the newest progress wins.
    const existing = byKey.get(id);
    if (!existing || existing.updatedAt < entry.updatedAt) byKey.set(id, entry);
  }

  return [...byKey.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, Math.max(1, limit))
    .map(({ updatedAt: _updatedAt, ...entry }) => entry);
}

export function progressByMediaId(
  entries: readonly ContinueWatchingEntry[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const entry of entries) {
    if (map[entry.item.id] === undefined) map[entry.item.id] = entry.progress;
  }
  return map;
}

/**
 * Titles the person has finished, keyed the same way the cards are.
 *
 * "Finished" is the same 95% line Continue Watching uses, so a title never sits
 * in both states at once.
 */
export function watchedByMediaId(
  records: readonly WatchProgressRecord[],
): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const record of records) {
    const id = (record.seriesId ?? record.mediaId)?.trim();
    if (!id) continue;
    const ratio = record.durationSeconds > 0
      ? record.positionSeconds / record.durationSeconds
      : 0;
    if (record.completed || ratio >= 0.95) map[id] = true;
  }
  return map;
}

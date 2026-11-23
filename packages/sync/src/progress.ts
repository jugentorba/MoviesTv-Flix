export interface PlaybackProgressRecord {
  mediaId: string;
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  updatedAt: string;
  resetAt?: string;
  /** Compatibility marker used by older persisted records. */
  restartRequested?: boolean;
}

export interface WatchMediaSnapshot {
  mediaId: string;
  kind: 'movie' | 'episode';
  title: string;
  posterUrl?: string;
  year?: number;
  externalIds?: {
    imdb?: string;
    tmdb?: string;
  };
  seriesId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface WatchProgressRecord extends PlaybackProgressRecord, WatchMediaSnapshot {}

function sameExternalIdentity(
  left: WatchMediaSnapshot,
  right: WatchMediaSnapshot,
): boolean {
  const leftImdb = left.externalIds?.imdb?.trim().toLowerCase();
  const rightImdb = right.externalIds?.imdb?.trim().toLowerCase();
  const leftTmdb = left.externalIds?.tmdb?.trim();
  const rightTmdb = right.externalIds?.tmdb?.trim();

  if (leftImdb && rightImdb && leftImdb !== rightImdb) return false;
  if (leftTmdb && rightTmdb && leftTmdb !== rightTmdb) return false;

  return Boolean(
    (leftImdb && rightImdb && leftImdb === rightImdb)
    || (leftTmdb && rightTmdb && leftTmdb === rightTmdb),
  );
}

export function sameWatchProgressMedia(
  left: WatchMediaSnapshot,
  right: WatchMediaSnapshot,
): boolean {
  if (left.kind !== right.kind) return false;

  const leftMediaId = left.mediaId.trim();
  const rightMediaId = right.mediaId.trim();
  const sameMediaId = Boolean(leftMediaId) && leftMediaId === rightMediaId;
  const sameExternalId = sameExternalIdentity(left, right);

  if (left.kind === 'episode') {
    const leftSeriesId = left.seriesId?.trim();
    const rightSeriesId = right.seriesId?.trim();
    const sameSeriesId = Boolean(
      leftSeriesId
      && rightSeriesId
      && leftSeriesId === rightSeriesId,
    );
    if (!sameMediaId && !sameExternalId && !sameSeriesId) return false;
    return left.seasonNumber === right.seasonNumber
      && left.episodeNumber === right.episodeNumber;
  }

  return sameMediaId || sameExternalId;
}

export function findWatchProgressRecord(
  records: readonly WatchProgressRecord[],
  media: WatchMediaSnapshot,
): WatchProgressRecord | undefined {
  const candidates = records.filter(
    (record) => sameWatchProgressMedia(record, media),
  );

  return candidates.sort(
    (left, right) => compareProgressRecency(right, left),
  )[0];
}

function timestamp(value: string | undefined): number {
  if (value === undefined) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function progressTieKey(record: WatchProgressRecord): string {
  return [
    record.mediaId.trim(),
    record.kind,
    record.title.trim(),
    record.posterUrl?.trim() ?? '',
    record.year === undefined ? '' : String(record.year),
    record.externalIds?.imdb?.trim().toLowerCase() ?? '',
    record.externalIds?.tmdb?.trim() ?? '',
    record.seriesId?.trim() ?? '',
    record.seasonNumber === undefined ? '' : String(record.seasonNumber),
    record.episodeNumber === undefined ? '' : String(record.episodeNumber),
    String(record.positionSeconds),
    String(record.durationSeconds),
    record.completed ? '1' : '0',
    record.resetAt ?? '',
    record.restartRequested ? '1' : '0',
  ].join('\u0000');
}

function compareProgressRecency(
  left: WatchProgressRecord,
  right: WatchProgressRecord,
): number {
  const timeDifference = timestamp(left.updatedAt) - timestamp(right.updatedAt);
  if (timeDifference !== 0) return timeDifference;

  const leftKey = progressTieKey(left);
  const rightKey = progressTieKey(right);
  if (leftKey === rightKey) return 0;
  return leftKey < rightKey ? -1 : 1;
}

function validResetEpoch(record: PlaybackProgressRecord): number | undefined {
  const epoch = timestamp(record.resetAt);
  return Number.isFinite(epoch) ? epoch : undefined;
}

function latestRecord(
  local: WatchProgressRecord,
  remote: WatchProgressRecord,
): WatchProgressRecord {
  return compareProgressRecency(remote, local) >= 0 ? remote : local;
}

function normalizeCompletion(record: WatchProgressRecord): WatchProgressRecord {
  return { ...record, completed: isPlaybackCompleted(record) };
}

export function isPlaybackCompleted(record: PlaybackProgressRecord): boolean {
  if (record.completed) return true;

  return (
    Number.isFinite(record.durationSeconds) &&
    record.durationSeconds > 0 &&
    Number.isFinite(record.positionSeconds) &&
    record.positionSeconds / record.durationSeconds >= 0.9
  );
}

export function isPlaybackResumable(record: PlaybackProgressRecord): boolean {
  if (isPlaybackCompleted(record) || !Number.isFinite(record.positionSeconds) || record.positionSeconds < 15) {
    return false;
  }

  return (
    !Number.isFinite(record.durationSeconds) ||
    record.durationSeconds <= 0 ||
    record.durationSeconds - record.positionSeconds >= 30
  );
}

export function continueWatchingRecords(records: readonly WatchProgressRecord[]): WatchProgressRecord[] {
  return dedupeWatchProgressRecords(records)
    .filter(isPlaybackResumable)
    .sort((left, right) => compareProgressRecency(right, left));
}

export function createProgressRecord(
  snapshot: WatchMediaSnapshot,
  positionSeconds: number,
  durationSeconds: number,
  updatedAt: string,
  resetAt?: string,
): WatchProgressRecord {
  const safePosition = Number.isFinite(positionSeconds) ? Math.max(0, positionSeconds) : 0;
  const safeDuration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  const record: WatchProgressRecord = {
    ...snapshot,
    positionSeconds: safePosition,
    durationSeconds: safeDuration,
    completed: false,
    updatedAt,
    ...(resetAt === undefined ? {} : { resetAt }),
  };

  return { ...record, completed: isPlaybackCompleted(record) };
}

export function resolvePlaybackProgress(
  local: WatchProgressRecord,
  remote: WatchProgressRecord,
): WatchProgressRecord {
  const localReset = validResetEpoch(local);
  const remoteReset = validResetEpoch(remote);

  if (localReset !== undefined || remoteReset !== undefined) {
    if (localReset === undefined) return normalizeCompletion(remote);
    if (remoteReset === undefined) return normalizeCompletion(local);
    if (localReset !== remoteReset) {
      return normalizeCompletion(remoteReset > localReset ? remote : local);
    }
  } else if (local.restartRequested !== remote.restartRequested) {
    return normalizeCompletion(remote.restartRequested ? remote : local);
  }

  const latest = latestRecord(local, remote);
  const positionSeconds = Math.max(
    Number.isFinite(local.positionSeconds) ? Math.max(0, local.positionSeconds) : 0,
    Number.isFinite(remote.positionSeconds) ? Math.max(0, remote.positionSeconds) : 0,
  );
  const completed = isPlaybackCompleted(local) || isPlaybackCompleted(remote);

  return {
    ...latest,
    positionSeconds,
    completed,
  };
}

export function dedupeWatchProgressRecords(
  records: readonly WatchProgressRecord[],
): WatchProgressRecord[] {
  const groups: WatchProgressRecord[][] = [];

  for (const record of records) {
    const matchingIndexes: number[] = [];
    groups.forEach((group, index) => {
      if (group.some((candidate) => (
        sameWatchProgressMedia(candidate, record)
      ))) {
        matchingIndexes.push(index);
      }
    });

    if (!matchingIndexes.length) {
      groups.push([record]);
      continue;
    }

    const mergedGroup = [record];
    for (let index = matchingIndexes.length - 1; index >= 0; index -= 1) {
      const groupIndex = matchingIndexes[index]!;
      mergedGroup.push(...groups[groupIndex]!);
      groups.splice(groupIndex, 1);
    }
    groups.push(mergedGroup);
  }

  return groups.map((group) => {
    let merged = group[0]!;
    for (let index = 1; index < group.length; index += 1) {
      merged = resolvePlaybackProgress(merged, group[index]!);
    }

    const imdb = merged.externalIds?.imdb
      ?? group.find((record) => record.externalIds?.imdb)
        ?.externalIds?.imdb;
    const tmdb = merged.externalIds?.tmdb
      ?? group.find((record) => record.externalIds?.tmdb)
        ?.externalIds?.tmdb;
    const seriesId = merged.seriesId
      ?? group.find((record) => record.seriesId)?.seriesId;

    return {
      ...merged,
      ...((imdb || tmdb) ? {
        externalIds: {
          ...(imdb ? { imdb } : {}),
          ...(tmdb ? { tmdb } : {}),
        },
      } : {}),
      ...(seriesId ? { seriesId } : {}),
    };
  }).sort(
    (left, right) => compareProgressRecency(right, left),
  );
}

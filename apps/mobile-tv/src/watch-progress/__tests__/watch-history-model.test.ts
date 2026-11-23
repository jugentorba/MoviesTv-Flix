import type { WatchProgressRecord } from '@moviestv/sync';
import {
  MAX_WATCH_HISTORY_ROWS,
  watchEpisodeCode,
  watchHistoryRecords,
  watchPositionMinutes,
  watchProgressFraction,
} from '../watch-history-model';

function record(
  overrides: Partial<WatchProgressRecord> = {},
): WatchProgressRecord {
  return {
    mediaId: 'movie',
    kind: 'movie',
    title: 'Movie',
    positionSeconds: 600,
    durationSeconds: 1_200,
    completed: false,
    updatedAt: '2026-11-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('watchHistoryRecords', () => {
  test('puts the newest record first', () => {
    const rows = watchHistoryRecords([
      record({ mediaId: 'old', updatedAt: '2026-11-01T00:00:00.000Z' }),
      record({ mediaId: 'new', updatedAt: '2026-11-14T00:00:00.000Z' }),
    ]);

    expect(rows.map((row) => row.mediaId)).toEqual(['new', 'old']);
  });

  test('keeps completed and barely-started records', () => {
    const rows = watchHistoryRecords([
      record({ mediaId: 'finished', completed: true, positionSeconds: 1_200 }),
      record({ mediaId: 'barely', positionSeconds: 5 }),
    ]);

    expect(rows.map((row) => row.mediaId)).toEqual(['barely', 'finished']);
  });

  test('keeps one row per media, preferring the newest', () => {
    const rows = watchHistoryRecords([
      record({ positionSeconds: 100, updatedAt: '2026-11-01T00:00:00.000Z' }),
      record({ positionSeconds: 900, updatedAt: '2026-11-13T00:00:00.000Z' }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.positionSeconds).toBe(900);
  });

  test('orders ties by media id so the list is stable', () => {
    const rows = watchHistoryRecords([
      record({ mediaId: 'b' }),
      record({ mediaId: 'a' }),
    ]);

    expect(rows.map((row) => row.mediaId)).toEqual(['a', 'b']);
  });

  test('handles an invalid timestamp without dropping the row', () => {
    const rows = watchHistoryRecords([
      record({ mediaId: 'broken', updatedAt: 'not-a-date' }),
      record({ mediaId: 'valid', updatedAt: '2026-11-14T00:00:00.000Z' }),
    ]);

    expect(rows.map((row) => row.mediaId)).toEqual(['valid', 'broken']);
  });

  test('bounds the list', () => {
    const many: WatchProgressRecord[] = [];
    for (let index = 0; index < MAX_WATCH_HISTORY_ROWS + 10; index += 1) {
      many.push(record({
        mediaId: `media-${index}`,
        updatedAt: new Date(
          Date.UTC(2026, 0, 1) + index * 60_000,
        ).toISOString(),
      }));
    }

    expect(watchHistoryRecords(many)).toHaveLength(MAX_WATCH_HISTORY_ROWS);
  });

  test('returns an empty list for empty or invalid input', () => {
    expect(watchHistoryRecords([])).toEqual([]);
    expect(watchHistoryRecords(undefined as unknown as WatchProgressRecord[]))
      .toEqual([]);
  });
});

describe('watchProgressFraction', () => {
  test('is the played fraction, clamped to 0…1', () => {
    expect(watchProgressFraction(record())).toBe(0.5);
    expect(watchProgressFraction(record({ positionSeconds: 0 }))).toBe(0);
    expect(watchProgressFraction(record({ positionSeconds: 9_999 }))).toBe(1);
  });

  test('is 1 for a completed record and 0 without a duration', () => {
    expect(watchProgressFraction(record({ completed: true, positionSeconds: 0 })))
      .toBe(1);
    expect(watchProgressFraction(record({ durationSeconds: 0 }))).toBe(0);
    expect(watchProgressFraction(record({ durationSeconds: Number.NaN }))).toBe(0);
    expect(watchProgressFraction(record({ positionSeconds: Number.NaN }))).toBe(0);
  });
});

describe('watchEpisodeCode', () => {
  test('formats an episode record', () => {
    expect(watchEpisodeCode(record({
      kind: 'episode',
      seasonNumber: 2,
      episodeNumber: 7,
    }))).toBe('S2E7');
  });

  test('is undefined for a movie or a record without numbering', () => {
    expect(watchEpisodeCode(record())).toBeUndefined();
    expect(watchEpisodeCode(record({ kind: 'episode' }))).toBeUndefined();
    expect(watchEpisodeCode(record({
      kind: 'episode',
      seasonNumber: 1,
    }))).toBeUndefined();
  });
});

describe('watchPositionMinutes', () => {
  test('floors whole minutes and hides a trivial position', () => {
    expect(watchPositionMinutes(record({ positionSeconds: 605 }))).toBe(10);
    expect(watchPositionMinutes(record({ positionSeconds: 59 }))).toBeUndefined();
    expect(watchPositionMinutes(record({ positionSeconds: Number.NaN })))
      .toBeUndefined();
  });
});

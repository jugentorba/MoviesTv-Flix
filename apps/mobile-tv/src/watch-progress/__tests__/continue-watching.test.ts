import type { WatchProgressRecord } from '@moviestv/sync';
import { buildContinueWatching, progressByMediaId, watchedByMediaId } from '../continueWatching';

function record(overrides: Partial<WatchProgressRecord>): WatchProgressRecord {
  return {
    mediaId: 'movie-1',
    kind: 'movie',
    title: 'A Film',
    positionSeconds: 600,
    durationSeconds: 6000,
    completed: false,
    updatedAt: '2026-11-20T12:00:00.000Z',
    ...overrides,
  };
}

test('a normal part-watched film appears with its ratio', () => {
  const entries = buildContinueWatching([record({})]);
  expect(entries).toHaveLength(1);
  expect(entries[0].item.title).toBe('A Film');
  expect(entries[0].progress).toBeCloseTo(0.1);
});

test('barely started and nearly finished entries are dropped', () => {
  expect(buildContinueWatching([record({ positionSeconds: 30 })])).toHaveLength(0);
  expect(buildContinueWatching([record({ positionSeconds: 5900 })])).toHaveLength(0);
  expect(buildContinueWatching([record({ completed: true })])).toHaveLength(0);
  // No duration means no bar to draw.
  expect(buildContinueWatching([record({ durationSeconds: 0 })])).toHaveLength(0);
});

test('an episode collapses into its series, newest progress winning', () => {
  const entries = buildContinueWatching([
    record({
      mediaId: 'ep-1',
      kind: 'episode',
      title: 'Show',
      seriesId: 'show-1',
      positionSeconds: 300,
      updatedAt: '2026-11-19T12:00:00.000Z',
    }),
    record({
      mediaId: 'ep-2',
      kind: 'episode',
      title: 'Show',
      seriesId: 'show-1',
      positionSeconds: 900,
      updatedAt: '2026-11-21T12:00:00.000Z',
    }),
  ]);

  expect(entries).toHaveLength(1);
  expect(entries[0].item.id).toBe('show-1');
  expect(entries[0].item.kind).toBe('series');
  expect(entries[0].progress).toBeCloseTo(0.15);
});

test('rows are newest first and respect the limit', () => {
  const entries = buildContinueWatching([
    record({ mediaId: 'a', title: 'A', updatedAt: '2026-11-18T12:00:00.000Z' }),
    record({ mediaId: 'b', title: 'B', updatedAt: '2026-11-21T12:00:00.000Z' }),
    record({ mediaId: 'c', title: 'C', updatedAt: '2026-11-19T12:00:00.000Z' }),
  ], 2);

  expect(entries.map((entry) => entry.item.id)).toEqual(['b', 'c']);
});

test('the progress map is keyed by the card id', () => {
  const entries = buildContinueWatching([record({})]);
  expect(progressByMediaId(entries)['movie-1']).toBeCloseTo(0.1);
  expect(progressByMediaId([])).toEqual({});
});

test('finished titles are marked watched, and do not also sit in continue watching', () => {
  const watched = watchedByMediaId([
    record({ mediaId: 'done', completed: true }),
    record({ mediaId: 'nearly', positionSeconds: 5900 }),
    record({ mediaId: 'inprog', positionSeconds: 600 }),
  ]);

  expect(watched).toEqual({ done: true, nearly: true });

  const entries = buildContinueWatching([
    record({ mediaId: 'done', completed: true }),
    record({ mediaId: 'nearly', positionSeconds: 5900 }),
  ]);
  expect(entries).toHaveLength(0);
});

test('an episode marks its series watched', () => {
  expect(watchedByMediaId([
    record({ mediaId: 'ep-9', kind: 'episode', seriesId: 'show-1', completed: true }),
  ])).toEqual({ 'show-1': true });
});

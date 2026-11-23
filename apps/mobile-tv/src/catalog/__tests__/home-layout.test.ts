import {
  applyHomeLayout,
  EMPTY_HOME_LAYOUT,
  mergeOrder,
  moveRow,
  normalizeHomeLayout,
  toggleRow,
} from '../homeLayout';

const rows = ['popular', 'trending', 'continue', 'new'];
const row = (id: string) => ({ section: { id } });

test('saved rows keep their order and new ones append in provider order', () => {
  expect(mergeOrder(['trending', 'popular'], rows))
    .toEqual(['trending', 'popular', 'continue', 'new']);
  // An id the provider no longer returns is dropped, not kept as a ghost row.
  expect(mergeOrder(['gone', 'new'], rows)).toEqual(['new', 'popular', 'trending', 'continue']);
});

test('moving a row swaps it with its neighbour and stops at the edges', () => {
  const layout = { order: [...rows], hidden: [] };
  expect(moveRow(layout, rows, 'trending', 'up').order.slice(0, 2))
    .toEqual(['trending', 'popular']);
  expect(moveRow(layout, rows, 'popular', 'up').order).toEqual(rows);
  expect(moveRow(layout, rows, 'new', 'down').order).toEqual(rows);
});

test('moving without a saved order seeds from the provider order', () => {
  const moved = moveRow(EMPTY_HOME_LAYOUT, rows, 'continue', 'up');
  expect(moved.order).toEqual(['popular', 'continue', 'trending', 'new']);
});

test('hiding and showing a row toggles without touching the order', () => {
  const hidden = toggleRow(EMPTY_HOME_LAYOUT, 'trending');
  expect(hidden.hidden).toEqual(['trending']);
  expect(toggleRow(hidden, 'trending').hidden).toEqual([]);
});

test('applying the layout filters hidden rows and reorders the rest', () => {
  const layout = { order: ['new', 'popular', 'trending', 'continue'], hidden: ['continue'] };
  expect(applyHomeLayout(layout, rows.map(row)).map((entry) => entry.section.id))
    .toEqual(['new', 'popular', 'trending']);
});

test('an unreadable stored layout is ignored', () => {
  expect(normalizeHomeLayout(null)).toEqual(EMPTY_HOME_LAYOUT);
  expect(normalizeHomeLayout({ order: 'nope' })).toEqual(EMPTY_HOME_LAYOUT);
  expect(normalizeHomeLayout({ order: ['a', 'a', 3, '  '], hidden: ['b'] }))
    .toEqual({ order: ['a'], hidden: ['b'] });
});

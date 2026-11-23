import { safeInsetEdge } from '../safeAreaLayout';

test('keeps the existing edge when the device inset is smaller', () => {
  expect(safeInsetEdge(18, 0, 8)).toBe(18);
  expect(safeInsetEdge(22, 6, 8)).toBe(22);
});

test('moves controls clear of larger device safe areas', () => {
  expect(safeInsetEdge(18, 34, 8)).toBe(42);
  expect(safeInsetEdge(16, 47, 8)).toBe(55);
});

test('ignores invalid negative or non-finite inset values', () => {
  expect(safeInsetEdge(18, -20, 8)).toBe(18);
  expect(safeInsetEdge(18, Number.NaN, 8)).toBe(18);
  expect(safeInsetEdge(18, Number.POSITIVE_INFINITY, 8)).toBe(18);
});

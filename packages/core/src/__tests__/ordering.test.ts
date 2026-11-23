import { stableTextCompare } from '../ordering';

test('stable text comparison is independent of locale-sensitive methods', () => {
  const localeCompare = jest.spyOn(
    String.prototype,
    'localeCompare',
  ).mockImplementation(() => 99);

  try {
    expect(stableTextCompare('a', 'b')).toBe(-1);
    expect(stableTextCompare('b', 'a')).toBe(1);
    expect(stableTextCompare('é', 'é')).toBe(0);
    expect(localeCompare).not.toHaveBeenCalled();
  } finally {
    localeCompare.mockRestore();
  }
});

test('stable text comparison provides deterministic Unicode ordering', () => {
  const values = ['z', 'ä', 'a', 'é', 'e'];
  expect(values.slice().sort(stableTextCompare)).toEqual(
    values.slice().sort((left, right) => (
      left < right ? -1 : left > right ? 1 : 0
    )),
  );
});

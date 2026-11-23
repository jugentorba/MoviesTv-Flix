import { act, renderHook } from '@testing-library/react-native';
import { useHoldSpeed } from '../useHoldSpeed';

function renderHold(initialRate: number) {
  const setRate = jest.fn();
  const view = renderHook(
    ({ rate }: { rate: number }) => useHoldSpeed(rate, setRate),
    { initialProps: { rate: initialRate } },
  );
  return { setRate, ...view };
}

test('holding plays at 2× and releasing returns to the previous speed', () => {
  const { result, setRate } = renderHold(1);

  expect(result.current.active).toBe(false);

  act(() => result.current.begin());
  expect(setRate).toHaveBeenLastCalledWith(2);
  expect(result.current.active).toBe(true);

  act(() => result.current.end());
  expect(setRate).toHaveBeenLastCalledWith(1);
  expect(result.current.active).toBe(false);
});

test('a user-chosen 1.5× survives a hold instead of snapping to 1×', () => {
  const { result, setRate } = renderHold(1.5);

  act(() => result.current.begin());
  act(() => result.current.end());

  expect(setRate).toHaveBeenLastCalledWith(1.5);
});

test('ending without a hold does not change the speed', () => {
  // onPressOut fires after a plain tap as well; it must be harmless.
  const { result, setRate, rerender } = renderHold(1);
  rerender({ rate: 1 });

  act(() => result.current.end());

  expect(setRate).toHaveBeenCalledWith(1);
});

import { act, renderHook } from '@testing-library/react-native';
import {
  beginImmersiveSurface,
  resetImmersiveSurfacesForTests,
  useImmersiveSurfaceActive,
} from '../immersiveSurface';

afterEach(() => {
  resetImmersiveSurfacesForTests();
});

test('reports no immersive surface until one opens', () => {
  const { result } = renderHook(() => useImmersiveSurfaceActive());
  expect(result.current).toBe(false);
});

test('reports an immersive surface while the offline player is open', () => {
  const { result } = renderHook(() => useImmersiveSurfaceActive());

  let release: () => void = () => {};
  act(() => {
    release = beginImmersiveSurface();
  });
  expect(result.current).toBe(true);

  act(() => release());
  expect(result.current).toBe(false);
});

test('releasing twice cannot unbalance the count', () => {
  const { result } = renderHook(() => useImmersiveSurfaceActive());

  let release: () => void = () => {};
  act(() => {
    release = beginImmersiveSurface();
  });
  act(() => {
    release();
    release();
  });
  expect(result.current).toBe(false);

  // A stale release from a previous surface must not hide a newer one either.
  let next: () => void = () => {};
  act(() => {
    release();
    next = beginImmersiveSurface();
  });
  expect(result.current).toBe(true);
  act(() => next());
});

test('two overlapping surfaces keep the claim until both close', () => {
  const { result } = renderHook(() => useImmersiveSurfaceActive());

  let first: () => void = () => {};
  let second: () => void = () => {};
  act(() => {
    first = beginImmersiveSurface();
    second = beginImmersiveSurface();
  });

  act(() => first());
  expect(result.current).toBe(true);

  act(() => second());
  expect(result.current).toBe(false);
});

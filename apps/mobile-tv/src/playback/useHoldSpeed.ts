import { useCallback, useRef, useState } from 'react';

export interface HoldSpeed {
  /** True while the finger is down, so the surface can show `2×`. */
  active: boolean;
  begin(): void;
  end(): void;
}

/**
 * Press-and-hold on the picture plays at 2× until release.
 *
 * The speed before the hold is captured, not assumed: if the user had already
 * chosen 1.5×, releasing must return there rather than to 1×.
 */
export function useHoldSpeed(
  currentRate: number,
  setRate: (rate: number) => void,
): HoldSpeed {
  const beforeRef = useRef(currentRate);
  const [active, setActive] = useState(false);

  const begin = useCallback(() => {
    beforeRef.current = currentRate;
    setRate(2);
    setActive(true);
  }, [currentRate, setRate]);

  const end = useCallback(() => {
    setRate(beforeRef.current);
    setActive(false);
  }, [setRate]);

  return { active, begin, end };
}

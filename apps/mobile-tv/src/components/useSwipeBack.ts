import { useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';

/** How far from the left edge a swipe must begin to count. */
export const SWIPE_BACK_EDGE = 32;
/** Horizontal travel that completes the gesture. */
export const SWIPE_BACK_DISTANCE = 90;

/**
 * Should this movement become a back gesture?
 *
 * Starting at the very edge is what stops the gesture from stealing horizontal
 * lists and carousels in the middle of the screen; the vertical bound keeps a
 * slightly diagonal scroll from triggering navigation.
 */
export function shouldCaptureSwipe(
  x0: number,
  dx: number,
  dy: number,
): boolean {
  return x0 <= SWIPE_BACK_EDGE && dx > 12 && Math.abs(dy) < 36;
}

export function shouldCompleteSwipe(dx: number): boolean {
  return dx >= SWIPE_BACK_DISTANCE;
}

/**
 * iOS-style edge swipe: drag right from the left edge to go back.
 *
 * The app draws its own screens instead of using a native stack, so the system
 * gesture is not available. Spreading these handlers on a screen's root view
 * gives the same habit on iPhone and Android without a navigation rewrite.
 */
export function useSwipeBack(
  onBack: () => void,
  enabled = true,
): Record<string, unknown> {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  return useMemo(() => {
    if (!enabled) return {};
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => shouldCaptureSwipe(
        gesture.x0,
        gesture.dx,
        gesture.dy,
      ),
      onPanResponderTerminationRequest: () => true,
      onPanResponderRelease: (_event, gesture) => {
        if (shouldCompleteSwipe(gesture.dx)) onBackRef.current();
      },
    }).panHandlers as Record<string, unknown>;
  }, [enabled]);
}

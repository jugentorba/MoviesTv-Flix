import { useContext } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

export interface VideoFrameInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NONE: VideoFrameInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Insets are reported by the OS for whatever physically blocks the screen: a
 * notch, the Dynamic Island, an Android punch-hole, rounded corners or the
 * gesture bar. On a notched iPhone held in landscape the island reports as a
 * ~59 pt side inset, which is exactly the strip a full-bleed video would lose.
 *
 * A malformed (NaN/negative/infinite) value must never be allowed to collapse
 * the frame, so every edge is clamped; 240 pt is far above any real cutout.
 */
function clampEdge(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(Math.round(value), 240);
}

/**
 * Padding that keeps the *picture* inside the part of the display that is
 * actually visible. The player chrome already insets itself; this is the video
 * layer's equivalent, so a 2.39:1 film is never half-hidden behind the island.
 */
export function useSafeVideoFrame(): VideoFrameInsets {
  const insets = useContext(SafeAreaInsetsContext);
  if (!insets) return NONE;
  return {
    top: clampEdge(insets.top),
    right: clampEdge(insets.right),
    bottom: clampEdge(insets.bottom),
    left: clampEdge(insets.left),
  };
}

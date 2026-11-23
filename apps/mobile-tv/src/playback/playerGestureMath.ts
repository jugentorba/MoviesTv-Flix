/**
 * The arithmetic behind the two player sliders, kept out of the gestures so it
 * can be tested without a finger.
 *
 * Layout follows VLC and MX Player: the left half adjusts brightness, the right
 * half adjusts volume, and the drag is vertical — up is more.
 */
export type GestureAxis = 'brightness' | 'volume';

/** A touch that starts in the middle column belongs to neither slider. */
export function axisFromTouch(x: number, width: number): GestureAxis | null {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) return null;
  const ratio = x / width;
  if (ratio < 0.5) return 'brightness';
  return 'volume';
}

/**
 * A vertical drag changes the value by a fraction of the full range.
 * The full height of the surface maps to 100%, so a short flick is a small
 * adjustment instead of jumping from 10% to 90%.
 */
export function valueFromDrag(
  startValue: number,
  dy: number,
  height: number,
): number {
  if (!Number.isFinite(startValue)) return 0;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 1;
  const delta = (-dy / safeHeight);
  return Math.max(0, Math.min(1, startValue + delta));
}

/** Should this movement become a slider drag rather than a tap or a scroll? */
export function isSliderDrag(dx: number, dy: number): boolean {
  return Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 1.2;
}

/** Engine volume: expo-video takes 0–1, VLC takes 0–200 (above 100 boosts). */
export function toEngineVolume(ratio: number, engine: 'expo' | 'vlc'): number {
  const safe = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return engine === 'vlc' ? safe * 100 : safe;
}

export function percentLabel(ratio: number): string {
  const safe = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return `${Math.round(safe * 100)}%`;
}

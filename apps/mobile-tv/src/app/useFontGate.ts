import { useEffect, useState } from 'react';

/**
 * How long the app may hide behind the loading surface while fonts register.
 *
 * The gate exists so the first frame is already in the design font, but it must
 * never be a blank screen. `expo-font` on web resolves through a font observer
 * that can stay pending forever: under WKWebView the `@font-face` rules load and
 * `document.fonts.status` reports "loaded", yet the observer only rejects when
 * its own 12 s timeout fires — measured in the macOS bundle at 12,356 ms to
 * first paint. Two seconds is enough for the CSS to land on every engine we
 * ship, after which the app renders and the faces swap in when they arrive.
 */
export const FONT_GATE_GRACE_MS = 2_000;

/**
 * Opens the font gate when the fonts are ready, when they failed, or when the
 * grace period expired. Late fonts still apply: registering a face updates the
 * text without a re-render, so a slow file costs typography, never the screen.
 */
export function useFontGate(loaded: boolean, error: Error | null): boolean {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (loaded || error) return undefined;
    const timer = setTimeout(() => setExpired(true), FONT_GATE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [error, loaded]);

  if (loaded || error) return true;
  return expired;
}

import type { StreamSource } from '@moviestv/core';

/**
 * Bridge to the macOS wrapper's native player.
 *
 * The DMG is a WKWebView, so it inherits WebKit's lack of a Matroska demuxer.
 * The wrapper injects `window.__MOVIESTV_NATIVE__` at document start; when it is
 * present, an unplayable source is handed to libVLC instead of failing.
 *
 * The signed URL and provider headers are passed to the native side in one
 * message and never written to the page, a log line or the DOM.
 */
export interface NativePlaybackRequest {
  url: string;
  headers?: Record<string, string>;
  title?: string;
  /** Video area in CSS pixels, so the native view can cover exactly that spot. */
  rect?: { x: number; y: number; width: number; height: number };
  /** Resume position in seconds. */
  startAt?: number;
}

interface NativeBridge {
  play(request: NativePlaybackRequest): void;
  stop?(): void;
}

function bridge(): NativeBridge | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { __MOVIESTV_NATIVE__?: NativeBridge }).__MOVIESTV_NATIVE__;
  if (!candidate || typeof candidate.play !== 'function') return null;
  return candidate;
}

export function nativePlayerAvailable(): boolean {
  return bridge() !== null;
}

function rectOf(video: { getBoundingClientRect?(): DOMRect } | null | undefined) {
  if (!video || typeof video.getBoundingClientRect !== 'function') return undefined;
  const rect = video.getBoundingClientRect();
  if (!rect || !Number.isFinite(rect.width) || rect.width <= 0) return undefined;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * Hand a source to the native player. Returns false when no wrapper is present,
 * so the caller can fall through to the remux fallback or the error message.
 */
export function requestNativePlayback(
  source: StreamSource,
  options: { video?: HTMLVideoElement | null; startAt?: number } = {},
): boolean {
  const api = bridge();
  if (!api) return false;
  const request: NativePlaybackRequest = {
    url: source.url,
    ...(source.headers && Object.keys(source.headers).length ? { headers: source.headers } : {}),
    ...(source.name ? { title: source.name } : {}),
    ...(options.startAt && options.startAt > 0 ? { startAt: Math.floor(options.startAt) } : {}),
  };
  const rect = rectOf(options.video ?? null);
  if (rect) request.rect = rect;
  try {
    api.play(request);
    return true;
  } catch {
    return false;
  }
}

export function stopNativePlayback(): void {
  const api = bridge();
  try {
    api?.stop?.();
  } catch {
    // The wrapper may already have closed the player.
  }
}

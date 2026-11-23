import type { StreamSource } from '@moviestv/core';
import { describeSourceFacts } from './sourceFacts';

/**
 * Browser-compatible fallback for sources the engine cannot play.
 *
 * WebKit has no Matroska demuxer, so every MKV is unplayable there; Chromium
 * cannot decode AC-3/E-AC-3 audio. A remux service (see `services/remux`) turns
 * such a source into HLS with the video bitstream copied, so this module only
 * has to hand it the URL and the provider headers and treat the result as HLS.
 *
 * Security notes:
 * - the signed URL and provider headers travel in the POST body, never in a
 *   query string, so they cannot land in access logs or a Referer header;
 * - nothing here logs the URL, the headers or the response body;
 * - the returned source carries no headers: the service holds them server-side.
 */
/**
 * Base URL of the remux service, or null when the fallback is not configured.
 * Read per call so the value follows the environment of the running build and
 * tests can exercise both states without reloading modules.
 */
export function remuxBaseUrl(): string | null {
  const raw = (process.env.EXPO_PUBLIC_REMUX_URL ?? '').trim();
  if (!raw) return null;
  const trimmed = raw.replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

export function remuxFallbackAvailable(): boolean {
  return remuxBaseUrl() !== null;
}

export interface RemuxSession {
  id: string;
  playlist: string;
  audio: 'copy' | 'transcode-aac' | string;
}

/** Marker so a remuxed source is never sent through the fallback again. */
const remuxedSources = new WeakSet<StreamSource>();

export function isRemuxedSource(source: StreamSource): boolean {
  return remuxedSources.has(source);
}

function withQuery(base: string, path: string): string {
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

/**
 * Ask the service to remux a source and describe it as an HLS source.
 *
 * Returns null when the fallback is unavailable or the service refuses; the
 * caller then shows the actionable error instead of stalling.
 */
export async function requestRemuxSource(
  source: StreamSource,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<StreamSource | null> {
  const base = remuxBaseUrl();
  if (!base || isRemuxedSource(source)) return null;
  if (typeof fetcher !== 'function') return null;

  let response: Response;
  try {
    response = await fetcher(`${base}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Signed URL and provider headers stay in the body, out of every log line.
      body: JSON.stringify({ url: source.url, headers: source.headers ?? {} }),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let body: Partial<RemuxSession>;
  try {
    body = await response.json() as Partial<RemuxSession>;
  } catch {
    return null;
  }
  if (typeof body.playlist !== 'string' || !body.playlist.startsWith('/')) return null;

  const remuxed: StreamSource = {
    id: `${source.id}#remux`,
    url: withQuery(base, body.playlist),
    contentType: 'application/vnd.apple.mpegurl',
    providerId: source.providerId,
    sourceId: source.sourceId,
    name: source.name,
    filename: source.filename,
    quality: source.quality,
    language: source.language,
    codec: source.codec,
    webReady: true,
  };
  remuxedSources.add(remuxed);
  return remuxed;
}

/** Why a source was rejected, which decides the wording of the error. */
export type UnplayableReason = 'container' | 'video-codec' | 'audio-codec';

/**
 * The error shown when nothing can play a source.
 *
 * It names what the source actually is, says which part this browser cannot
 * handle, and gives the moves a user has: pick another source, or use the app
 * that ships a native player.
 */
export function unplayableSourceMessage(
  source: StreamSource,
  options: {
    reason?: UnplayableReason;
    nativePlayerAvailable?: boolean;
    remuxConfigured?: boolean;
  } = {},
): string {
  const facts = describeSourceFacts(source);
  const what = facts ? `This source is ${facts}` : 'This source';
  const reason = options.reason ?? 'container';
  const cause = reason === 'video-codec'
    ? 'and this browser cannot decode its video codec'
    : reason === 'audio-codec'
      ? 'and this browser cannot decode its audio codec'
      : 'and this browser cannot open that container';
  const hints = ['Choose another source'];
  if (options.nativePlayerAvailable) {
    hints.push('or play it in the native player');
  } else if (options.remuxConfigured === false) {
    hints.push('or use the macOS app, which plays it natively');
  }
  return `${what} ${cause}. ${hints.join(' ')}.`;
}

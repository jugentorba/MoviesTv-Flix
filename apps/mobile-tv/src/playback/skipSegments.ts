/**
 * IntroDB (introdb.app) — a free, key-less segment database for intros, recaps,
 * outros and post-credits scenes.
 *
 *   GET https://api.introdb.app/segments?imdb_id=tt0944947&season=1&episode=1
 *   { "intro": { "start_sec": 2.5, "end_sec": 58 }, ... }
 *
 * Everything here is bounded and optional: a slow or broken provider must never
 * delay playback, and a malformed answer must never seek the film somewhere odd.
 */
export type SkipSegmentKind = 'recap' | 'intro' | 'outro' | 'credits';

export interface SkipSegment {
  kind: SkipSegmentKind;
  start: number;
  end: number;
}

export interface SkipSegments {
  segments: SkipSegment[];
}

export const SKIP_SEGMENTS_ENDPOINT = 'https://api.introdb.app/segments';
const MAX_RESPONSE_BYTES = 8 * 1024;
const MAX_SEGMENT_SECONDS = 6 * 60 * 60;
const REQUEST_TIMEOUT_MS = 2_500;

const KIND_KEYS: ReadonlyArray<readonly [string, SkipSegmentKind]> = [
  ['recap', 'recap'],
  ['intro', 'intro'],
  ['outro', 'outro'],
  ['credits', 'credits'],
  ['post_credit', 'credits'],
  ['postCredits', 'credits'],
];

function positiveSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_SEGMENT_SECONDS) return null;
  return value;
}

/** Reads only the four shapes the player can act on, and drops everything else. */
export function parseSkipSegments(payload: unknown): SkipSegments {
  if (!payload || typeof payload !== 'object') return { segments: [] };
  const record = payload as Record<string, unknown>;
  const segments: SkipSegment[] = [];

  for (const [key, kind] of KIND_KEYS) {
    const entry = record[key];
    if (!entry || typeof entry !== 'object') continue;
    const range = entry as { start_sec?: unknown; end_sec?: unknown };
    const start = positiveSeconds(range.start_sec);
    const end = positiveSeconds(range.end_sec);
    // A zero-length or backwards range would make the pill flicker or seek past
    // the scene, so it is ignored rather than clamped.
    if (start === null || end === null || end <= start + 1) continue;
    if (segments.some((segment) => segment.kind === kind)) continue;
    segments.push({ kind, start, end });
  }

  return { segments: segments.sort((left, right) => left.start - right.start) };
}

/**
 * The segment the playhead is currently inside, or null.
 *
 * The final second is excluded so the pill disappears just before the scene
 * ends instead of jumping past the cut.
 */
export function activeSkipSegment(
  segments: readonly SkipSegment[],
  positionSeconds: number,
): SkipSegment | null {
  if (!Number.isFinite(positionSeconds)) return null;
  for (const segment of segments) {
    if (positionSeconds >= segment.start && positionSeconds < segment.end - 1) {
      return segment;
    }
  }
  return null;
}

export function skipSegmentsUrl({
  imdbId,
  season,
  episode,
}: {
  imdbId: string;
  season?: number;
  episode?: number;
}): string | null {
  const id = imdbId.trim();
  if (!/^tt\d{5,12}$/.test(id)) return null;
  const params = new URLSearchParams({ imdb_id: id });
  if (typeof season === 'number' && season > 0) params.set('season', String(Math.floor(season)));
  if (typeof episode === 'number' && episode > 0) params.set('episode', String(Math.floor(episode)));
  return `${SKIP_SEGMENTS_ENDPOINT}?${params.toString()}`;
}

/**
 * Fetches the segments for one title. Never throws: playback must not depend on
 * a community database being reachable.
 */
export async function fetchSkipSegments(
  target: { imdbId: string; season?: number; episode?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<SkipSegments> {
  const url = skipSegmentsUrl(target);
  if (!url) return { segments: [] };

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    : null;

  try {
    const response = await fetchImpl(url, {
      signal: controller?.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return { segments: [] };
    const text = await response.text();
    // Bounded before parsing: this is a third-party endpoint.
    if (text.length > MAX_RESPONSE_BYTES) return { segments: [] };
    return parseSkipSegments(JSON.parse(text));
  } catch {
    return { segments: [] };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

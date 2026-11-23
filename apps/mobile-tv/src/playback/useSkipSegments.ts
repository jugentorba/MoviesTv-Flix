import { useCallback, useEffect, useRef, useState } from 'react';
import {
  activeSkipSegment,
  fetchSkipSegments,
  type SkipSegment,
} from './skipSegments';

export interface SkipOffer {
  segment: SkipSegment | null;
  skip(): void;
}

/**
 * Loads IntroDB segments for the current title and reports the one the playhead
 * is inside.
 *
 * The fetch happens once per title and never blocks playback: if the database is
 * slow or down the film simply plays, which is the correct trade for a
 * convenience feature.
 */
export function useSkipSegments({
  imdbId,
  season,
  episode,
  position,
  onSeek,
  enabled = true,
}: {
  imdbId?: string;
  season?: number;
  episode?: number;
  position: number;
  onSeek(seconds: number): void;
  /** Turning the feature off skips the network call entirely. */
  enabled?: boolean;
}): SkipOffer {
  const [segments, setSegments] = useState<readonly SkipSegment[]>([]);
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;

  useEffect(() => {
    let active = true;
    setSegments([]);
    if (!imdbId || !enabled) return undefined;

    void fetchSkipSegments({ imdbId, season, episode }).then((result) => {
      if (active) setSegments(result.segments);
    });

    return () => { active = false; };
  }, [enabled, episode, imdbId, season]);

  const segment = enabled ? activeSkipSegment(segments, position) : null;

  const skip = useCallback(() => {
    if (!segment) return;
    onSeekRef.current(segment.end);
  }, [segment]);

  return { segment, skip };
}

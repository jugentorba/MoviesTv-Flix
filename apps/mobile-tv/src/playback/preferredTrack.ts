import { normalizeLanguageTag } from '@moviestv/core';

function baseLanguage(value: string): string {
  return value.split('-')[0]?.toLowerCase() ?? value.toLowerCase();
}

export function preferredLanguageTrackIndex(
  tracks: readonly { language?: string | null }[],
  preferredLanguages: readonly string[],
): number {
  for (const preferredLanguage of preferredLanguages) {
    const rawPreferred = preferredLanguage.trim();
    if (!rawPreferred) continue;
    const preferred = normalizeLanguageTag(rawPreferred) ?? rawPreferred.toLowerCase();
    const exact = tracks.findIndex((track) => {
      const rawCandidate = track.language?.trim();
      if (!rawCandidate) return false;
      const candidate = normalizeLanguageTag(rawCandidate) ?? rawCandidate.toLowerCase();
      return candidate === preferred;
    });
    if (exact >= 0) return exact;

    const preferredBase = baseLanguage(preferred);
    const base = tracks.findIndex((track) => {
      const rawCandidate = track.language?.trim();
      if (!rawCandidate) return false;
      const candidate = normalizeLanguageTag(rawCandidate) ?? rawCandidate.toLowerCase();
      return baseLanguage(candidate) === preferredBase;
    });
    if (base >= 0) return base;
  }

  return tracks.findIndex((track) => Boolean(track.language?.trim()));
}

import type { CatalogMediaItem } from './types';

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function identityKeys(item: CatalogMediaItem): string[] {
  const keys: string[] = [];
  if (item.externalIds.tmdb) keys.push(`tmdb:${item.kind}:${item.externalIds.tmdb}`);
  if (item.externalIds.imdb) keys.push(`imdb:${item.kind}:${item.externalIds.imdb}`);
  const fallbackYear = item.year ?? item.releaseYear;
  if (fallbackYear !== undefined) keys.push(`fallback:${item.kind}:${normalizeTitle(item.title)}:${fallbackYear}`);
  return keys;
}

function hasConflictingExternalIds(
  left: CatalogMediaItem,
  right: CatalogMediaItem,
): boolean {
  return Boolean(
    (
      left.externalIds.tmdb
      && right.externalIds.tmdb
      && left.externalIds.tmdb !== right.externalIds.tmdb
    )
    || (
      left.externalIds.imdb
      && right.externalIds.imdb
      && left.externalIds.imdb !== right.externalIds.imdb
    )
  );
}

function mergeMissing(primary: CatalogMediaItem, secondary: CatalogMediaItem): CatalogMediaItem {
  return {
    ...secondary,
    ...primary,
    originalTitle: primary.originalTitle ?? secondary.originalTitle,
    overview: primary.overview ?? secondary.overview,
    year: primary.year ?? secondary.year,
    releaseYear: primary.releaseYear ?? secondary.releaseYear,
    posterUrl: primary.posterUrl ?? secondary.posterUrl,
    backdropUrl: primary.backdropUrl ?? secondary.backdropUrl,
    rating: primary.rating ?? secondary.rating,
    genres: primary.genres?.length ? primary.genres : secondary.genres,
    externalIds: {
      ...secondary.externalIds,
      ...primary.externalIds,
    },
  };
}

export function dedupeCatalogItems(groupsByPriority: CatalogMediaItem[][]): CatalogMediaItem[] {
  const result: Array<CatalogMediaItem | null> = [];
  const keyToIndex = new Map<string, number>();
  const ambiguousFallbackKeys = new Set<string>();

  for (const group of groupsByPriority) {
    for (const item of group) {
      const keys = identityKeys(item);
      const fallbackKeys = keys.filter((key) => key.startsWith('fallback:'));
      const matchingIndexes = [...new Set(
        keys.flatMap((key) => {
          if (ambiguousFallbackKeys.has(key)) return [];
          const index = keyToIndex.get(key);
          return index === undefined ? [] : [index];
        }),
      )].filter((index) => {
        const candidate = result[index];
        return candidate !== null
          && !hasConflictingExternalIds(candidate, item);
      });

      if (!matchingIndexes.length) {
        for (const key of fallbackKeys) {
          const existingIndex = keyToIndex.get(key);
          const existing = existingIndex === undefined ? null : result[existingIndex];
          if (existing && hasConflictingExternalIds(existing, item)) {
            ambiguousFallbackKeys.add(key);
            keyToIndex.delete(key);
          }
        }

        const index = result.length;
        result.push(item);
        for (const key of keys) {
          if (!ambiguousFallbackKeys.has(key)) keyToIndex.set(key, index);
        }
        continue;
      }

      const primaryIndex = Math.min(...matchingIndexes);
      let merged = result[primaryIndex]!;
      for (const index of matchingIndexes) {
        if (index === primaryIndex) continue;
        const duplicate = result[index];
        if (!duplicate) continue;
        merged = mergeMissing(merged, duplicate);
        result[index] = null;
        for (const [key, mappedIndex] of keyToIndex) {
          if (mappedIndex === index) keyToIndex.set(key, primaryIndex);
        }
      }
      merged = mergeMissing(merged, item);
      result[primaryIndex] = merged;
      for (const key of identityKeys(merged)) {
        if (!ambiguousFallbackKeys.has(key)) keyToIndex.set(key, primaryIndex);
      }
    }
  }

  return result.filter(
    (item): item is CatalogMediaItem => item !== null,
  );
}

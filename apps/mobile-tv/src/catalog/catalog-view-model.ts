import type { CatalogMediaItem, CatalogSection } from '@moviestv/catalog';

export type CatalogDestination = 'home' | 'movies' | 'series';

export interface CatalogRow {
  section: CatalogSection;
  items: CatalogMediaItem[];
  nextCursor?: string;
}

export type CatalogViewState = 'loading' | 'content' | 'empty' | 'error';

/**
 * Providers that declare genres publish one synthetic section per genre
 * (`...:genre:Action`). They are browse targets, not home rows: left in the row
 * list they fill the home screen with "Popular · Action" duplicates.
 */
export function genreOfSection(section: CatalogSection): string | null {
  const id = section.id ?? '';
  const marker = ':genre:';
  const index = id.indexOf(marker);
  if (index < 0) return null;
  const raw = id.slice(index + marker.length);
  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

export function isGenreSection(section: CatalogSection): boolean {
  return genreOfSection(section) !== null;
}

export function filterCatalogSections(
  route: CatalogDestination,
  sections: CatalogSection[],
): CatalogSection[] {
  const prefix = `${route}:`;
  const seen = new Set<string>();
  return sections.filter((section) => {
    const id = section.id?.trim();
    if (!id || !id.startsWith(prefix) || seen.has(id)) return false;
    // Genres get their own strip; they are not rows.
    if (isGenreSection(section)) return false;
    seen.add(id);
    return true;
  }).slice(0, 100);
}

export function getCatalogViewState(input: {
  loading: boolean;
  error: string | null;
  rows: Array<{ items: unknown[] }>;
}): CatalogViewState {
  const hasContent = input.rows.some((row) => Array.isArray(row.items) && row.items.length > 0);
  if (hasContent) return 'content';
  if (input.loading) return 'loading';
  if (input.error) return 'error';
  return 'empty';
}

/** Genre sections for one tab, de-duplicated by genre name in provider order. */
export function genreSectionsFor(
  route: CatalogDestination,
  sections: readonly CatalogSection[],
): Array<{ section: CatalogSection; genre: string }> {
  const seen = new Set<string>();
  const result: Array<{ section: CatalogSection; genre: string }> = [];
  for (const section of sections) {
    const id = section.id?.trim();
    if (!id || !id.startsWith(`${route}:`)) continue;
    const genre = genreOfSection(section);
    if (!genre) continue;
    if (seen.has(genre)) continue;
    seen.add(genre);
    result.push({ section, genre });
  }
  return result;
}

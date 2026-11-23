import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Recently searched terms.
 *
 * Typing the same title over and over is the most common search interaction, and
 * the provider round-trip is the slow part. Device-local: a search you ran is
 * your business, not something to sync between profiles.
 */
const STORAGE_KEY = 'moviestv:recent-searches:v1';
const MAX_ENTRIES = 8;

function normalize(term: string): string {
  return term.trim().replace(/\s+/g, ' ').slice(0, 120);
}

export async function readRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === 'string')
      .map(normalize)
      .filter((value) => value.length > 0)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export async function rememberSearch(term: string): Promise<string[]> {
  const value = normalize(term);
  if (!value) return readRecentSearches();
  const existing = await readRecentSearches();
  // Move an existing term to the front instead of duplicating it.
  const next = [value, ...existing.filter((entry) => entry.toLowerCase() !== value.toLowerCase())]
    .slice(0, MAX_ENTRIES);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best effort.
  }
  return next;
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best effort.
  }
}

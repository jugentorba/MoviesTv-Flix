export const MAX_SEARCH_QUERY_LENGTH = 200;

export function normalizeSearchQuery(query: string): string | null {
  const normalized = query.trim().replace(/\s+/g, ' ');
  if (
    normalized.length < 2
    || normalized.length > MAX_SEARCH_QUERY_LENGTH
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

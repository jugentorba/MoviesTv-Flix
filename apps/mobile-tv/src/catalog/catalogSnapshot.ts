import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CatalogMediaItem } from '@moviestv/catalog';
import type { CatalogRow } from './catalog-view-model';

/**
 * The last catalog the user saw, so a cold start shows content instead of a
 * spinner while the providers answer.
 *
 * Identity scoping is part of the key, not an afterthought: guest data and a
 * signed-in profile must never read each other's rows. The scope is built by
 * the caller from the same values the other identity-scoped stores use.
 */
const PREFIX = 'moviestv:catalog-snapshot:v1';

export function catalogSnapshotKey(scope: string, route: string): string {
  const safeScope = scope.trim() || 'guest';
  const safeRoute = route.trim() || 'home';
  return `${PREFIX}:${safeScope}:${safeRoute}`;
}

/** Only what a card draws; a snapshot must not carry provider payloads. */
function slimItem(item: CatalogMediaItem): CatalogMediaItem | null {
  const id = item.id?.trim();
  const title = item.title?.trim();
  if (!id || !title || !item.providerId) return null;
  return {
    id,
    title,
    kind: item.kind,
    providerId: item.providerId,
    externalIds: item.externalIds ?? {},
    ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
    ...(item.year ? { year: item.year } : {}),
  } as CatalogMediaItem;
}

export function toSnapshotRows(rows: readonly CatalogRow[]): CatalogRow[] {
  return rows
    .map((row) => ({
      section: { id: row.section.id, title: row.section.title, kinds: row.section.kinds },
      items: row.items
        .map((item) => slimItem(item))
        .filter((item): item is CatalogMediaItem => item !== null),
      ...(row.nextCursor ? { nextCursor: row.nextCursor } : {}),
    }))
    .filter((row) => row.section.title?.trim() && row.items.length > 0);
}

function isSnapshotRow(value: unknown): value is CatalogRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<CatalogRow>;
  return Boolean(
    row.section
    && typeof row.section.id === 'string'
    && typeof row.section.title === 'string'
    && Array.isArray(row.items),
  );
}

export async function readCatalogSnapshot(
  scope: string,
  route: string,
): Promise<CatalogRow[] | null> {
  try {
    const raw = await AsyncStorage.getItem(catalogSnapshotKey(scope, route));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const rows = parsed.filter(isSnapshotRow);
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}

export async function writeCatalogSnapshot(
  scope: string,
  route: string,
  rows: readonly CatalogRow[],
): Promise<void> {
  const snapshot = toSnapshotRows(rows);
  if (!snapshot.length) return;
  try {
    await AsyncStorage.setItem(
      catalogSnapshotKey(scope, route),
      JSON.stringify(snapshot),
    );
  } catch {
    // Best effort: a missing snapshot only costs a spinner.
  }
}

export async function clearCatalogSnapshots(scope: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const owned = keys.filter((key) => key.startsWith(`${PREFIX}:${scope.trim() || 'guest'}:`));
    if (owned.length) await AsyncStorage.multiRemove(owned);
  } catch {
    // Best effort.
  }
}

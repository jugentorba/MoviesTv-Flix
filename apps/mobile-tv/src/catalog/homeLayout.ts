import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Which catalog rows a person wants on their home screen, and in what order.
 *
 * Stored per identity and device: two profiles on one TV expect different rows,
 * and a phone with a small screen may hide rows the TV keeps. The key uses the
 * same `userId:profileId` scope as the catalog snapshot and progress stores, so
 * guest data can never leak into a signed-in profile.
 */
export interface HomeLayout {
  order: string[];
  hidden: string[];
}

export const EMPTY_HOME_LAYOUT: HomeLayout = { order: [], hidden: [] };

const PREFIX = 'moviestv:home-layout:v1';

export function homeLayoutKey(scope: string): string {
  return `${PREFIX}:${scope.trim() || 'guest'}`;
}

/** Drops anything that is not a plausible row id, so storage cannot grow oddly. */
export function normalizeHomeLayout(value: unknown): HomeLayout {
  if (!value || typeof value !== 'object') return EMPTY_HOME_LAYOUT;
  const record = value as { order?: unknown; hidden?: unknown };
  const clean = (input: unknown): string[] => {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    for (const entry of input) {
      if (typeof entry !== 'string') continue;
      const id = entry.trim().slice(0, 120);
      if (!id || seen.has(id)) continue;
      seen.add(id);
    }
    return [...seen];
  };
  return { order: clean(record.order), hidden: clean(record.hidden) };
}

export async function readHomeLayout(scope: string): Promise<HomeLayout> {
  try {
    const raw = await AsyncStorage.getItem(homeLayoutKey(scope));
    if (!raw) return EMPTY_HOME_LAYOUT;
    return normalizeHomeLayout(JSON.parse(raw));
  } catch {
    return EMPTY_HOME_LAYOUT;
  }
}

export async function writeHomeLayout(scope: string, layout: HomeLayout): Promise<void> {
  try {
    await AsyncStorage.setItem(homeLayoutKey(scope), JSON.stringify(normalizeHomeLayout(layout)));
  } catch {
    // Best effort: a failed write only costs the next reload's arrangement.
  }
}

/** Moves a row one place earlier or later, seeding from the current order first. */
export function moveRow(
  layout: HomeLayout,
  rowIds: readonly string[],
  id: string,
  direction: 'up' | 'down',
): HomeLayout {
  const order = mergeOrder(layout.order, rowIds);
  const index = order.indexOf(id);
  if (index < 0) return layout;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= order.length) return layout;
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return { ...layout, order: next };
}

export function toggleRow(layout: HomeLayout, id: string): HomeLayout {
  const hidden = layout.hidden.includes(id)
    ? layout.hidden.filter((entry) => entry !== id)
    : [...layout.hidden, id];
  return { ...layout, hidden };
}

/** Known ids keep their saved order; new ids keep the provider's order at the end. */
export function mergeOrder(
  saved: readonly string[],
  rowIds: readonly string[],
): string[] {
  const known = new Set(rowIds);
  const ordered = saved.filter((id) => known.has(id));
  const rest = rowIds.filter((id) => !ordered.includes(id));
  return [...ordered, ...rest];
}

/** Applies the layout to the rows the provider returned. */
export function applyHomeLayout<T extends { section: { id: string } }>(
  layout: HomeLayout,
  rows: readonly T[],
): T[] {
  const byId = new Map(rows.map((row) => [row.section.id, row]));
  const ordered = mergeOrder(layout.order, rows.map((row) => row.section.id))
    .map((id) => byId.get(id))
    .filter((row): row is T => Boolean(row));
  return ordered.filter((row) => !layout.hidden.includes(row.section.id));
}

import {
  MAX_MY_LIST_ITEMS,
  sameMyListMedia,
  type MyListMediaItem,
} from '@moviestv/core';
import type { CatalogMediaItem } from '@moviestv/catalog';

/** The identity a catalog card contributes to My List. */
export function myListTargetFromCatalog(item: CatalogMediaItem): MyListMediaItem | null {
  const mediaId = item.id?.trim();
  const title = item.title?.trim();
  if (!mediaId || !title) return null;
  return {
    mediaId,
    kind: item.kind === 'series' ? 'series' : 'movie',
    title,
    providerId: item.providerId,
    externalIds: item.externalIds ?? {},
    ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}),
    ...(item.year ? { year: item.year } : {}),
  };
}

export function isInMyList(
  items: readonly MyListMediaItem[],
  target: MyListMediaItem,
): boolean {
  return items.some((item) => sameMyListMedia(item, target));
}

/**
 * Adds the item, or removes it when it is already saved.
 *
 * The cap matches the details screen: the oldest entry gives way instead of the
 * action failing, because a full list should not look like a broken button.
 */
export function toggleMyList(
  items: readonly MyListMediaItem[],
  target: MyListMediaItem,
): MyListMediaItem[] {
  if (isInMyList(items, target)) {
    return items.filter((item) => !sameMyListMedia(item, target));
  }
  return [
    ...items
      .filter((item) => !sameMyListMedia(item, target))
      .slice(-(MAX_MY_LIST_ITEMS - 1)),
    target,
  ];
}

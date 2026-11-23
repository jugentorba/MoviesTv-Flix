import { isInMyList, myListTargetFromCatalog, toggleMyList } from '../myListActions';
import { MAX_MY_LIST_ITEMS, type MyListMediaItem } from '@moviestv/core';
import type { CatalogMediaItem } from '@moviestv/catalog';

const item = {
  id: ' tt1234567 ',
  title: ' Modern Family ',
  kind: 'series',
  providerId: 'com.stremio.cinemeta',
  externalIds: { imdb: 'tt1234567' },
  posterUrl: 'https://images.example/poster.jpg',
  year: 2009,
} as unknown as CatalogMediaItem;

const saved = (mediaId: string): MyListMediaItem => ({
  mediaId,
  kind: 'movie',
  title: `Title ${mediaId}`,
  providerId: 'com.stremio.cinemeta',
  externalIds: { imdb: mediaId },
});

test('a catalog card becomes a My List entry with trimmed identity', () => {
  const target = myListTargetFromCatalog(item);

  expect(target).toEqual({
    mediaId: 'tt1234567',
    kind: 'series',
    title: 'Modern Family',
    providerId: 'com.stremio.cinemeta',
    externalIds: { imdb: 'tt1234567' },
    posterUrl: 'https://images.example/poster.jpg',
    year: 2009,
  });
});

test('a card without an id or title is not saveable', () => {
  expect(myListTargetFromCatalog({ ...item, id: '  ' } as CatalogMediaItem)).toBeNull();
  expect(myListTargetFromCatalog({ ...item, title: '' } as CatalogMediaItem)).toBeNull();
});

test('the toggle adds, then removes the same media', () => {
  const target = myListTargetFromCatalog(item)!;

  const added = toggleMyList([], target);
  expect(added).toHaveLength(1);
  expect(isInMyList(added, target)).toBe(true);

  const removed = toggleMyList(added, target);
  expect(removed).toHaveLength(0);
});

test('a full list drops the oldest entry instead of refusing the save', () => {
  const full = Array.from({ length: MAX_MY_LIST_ITEMS }, (_, index) => saved(`old-${index}`));
  const target = saved('new');

  const next = toggleMyList(full, target);

  expect(next).toHaveLength(MAX_MY_LIST_ITEMS);
  expect(next[0].mediaId).toBe('old-1');
  expect(next[next.length - 1].mediaId).toBe('new');
});

test('identity is the media, not the title, so a renamed entry still toggles off', () => {
  const target = saved('tt1');
  const existing = { ...target, title: 'Old title' };

  // Same imdb id, different title text: it is the same media, so the second
  // press removes it rather than adding a duplicate.
  const next = toggleMyList([existing], { ...target, title: 'New title' });

  expect(next).toHaveLength(0);
});

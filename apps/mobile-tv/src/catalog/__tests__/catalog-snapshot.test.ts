import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  catalogSnapshotKey,
  clearCatalogSnapshots,
  readCatalogSnapshot,
  toSnapshotRows,
  writeCatalogSnapshot,
} from '../catalogSnapshot';
import type { CatalogRow } from '../catalog-view-model';

const row = (id: string, items: Array<Record<string, unknown>>): CatalogRow => ({
  section: { id, title: `Section ${id}`, kinds: ['movie', 'series'] },
  items: items as unknown as CatalogRow['items'],
  nextCursor: 'cursor-1',
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

test('the storage key separates users, profiles and routes', () => {
  expect(catalogSnapshotKey('u1:main', 'home'))
    .toBe('moviestv:catalog-snapshot:v1:u1:main:home');
  expect(catalogSnapshotKey('guest:main', 'home'))
    .not.toBe(catalogSnapshotKey('u1:main', 'home'));
  expect(catalogSnapshotKey('u1:main', 'movies'))
    .not.toBe(catalogSnapshotKey('u1:main', 'home'));
});

test('a written snapshot comes back with the card fields only', async () => {
  await writeCatalogSnapshot('u1:main', 'home', [
    row('popular', [{
      id: ' tt1 ',
      title: ' Film ',
      kind: 'movie',
      providerId: 'com.stremio.cinemeta',
      externalIds: { imdb: 'tt1' },
      posterUrl: 'https://img/p.jpg',
      year: 2020,
      // Provider payload that must not be persisted:
      description: 'long text',
      streams: [{ url: 'https://secret' }],
    }]),
  ]);

  const snapshot = await readCatalogSnapshot('u1:main', 'home');
  expect(snapshot).toHaveLength(1);
  const item = snapshot![0].items[0];
  expect(item.id).toBe('tt1');
  expect(item.title).toBe('Film');
  expect((item as unknown as Record<string, unknown>).description).toBeUndefined();
  expect((item as unknown as Record<string, unknown>).streams).toBeUndefined();
});

test('an empty result is not written, so a failure cannot erase a good snapshot', async () => {
  await writeCatalogSnapshot('u1:main', 'home', [
    row('popular', [{ id: 'tt1', title: 'Film', kind: 'movie', providerId: 'p', externalIds: {} }]),
  ]);
  await writeCatalogSnapshot('u1:main', 'home', []);

  const snapshot = await readCatalogSnapshot('u1:main', 'home');
  expect(snapshot).toHaveLength(1);
});

test('a corrupt snapshot is ignored instead of crashing the home screen', async () => {
  await AsyncStorage.setItem(catalogSnapshotKey('u1:main', 'home'), '{"nope":true}');
  expect(await readCatalogSnapshot('u1:main', 'home')).toBeNull();

  await AsyncStorage.setItem(catalogSnapshotKey('u1:main', 'home'), 'not json');
  expect(await readCatalogSnapshot('u1:main', 'home')).toBeNull();
});

test('rows without a title or items are dropped', () => {
  const rows = toSnapshotRows([
    row('popular', [{ id: 'tt1', title: 'Film', kind: 'movie', providerId: 'p', externalIds: {} }]),
    { ...row('empty', []), nextCursor: undefined },
  ]);
  expect(rows.map((entry) => entry.section.id)).toEqual(['popular']);
});

test('clearing a scope removes only that scope', async () => {
  await writeCatalogSnapshot('u1:main', 'home', [
    row('popular', [{ id: 'tt1', title: 'Film', kind: 'movie', providerId: 'p', externalIds: {} }]),
  ]);
  await writeCatalogSnapshot('guest:main', 'home', [
    row('popular', [{ id: 'tt2', title: 'Other', kind: 'movie', providerId: 'p', externalIds: {} }]),
  ]);

  await clearCatalogSnapshots('u1:main');

  expect(await readCatalogSnapshot('u1:main', 'home')).toBeNull();
  expect(await readCatalogSnapshot('guest:main', 'home')).not.toBeNull();
});

import { MemoryStore } from '../MemoryStore';
import { AsyncStorageStore } from '../AsyncStorageStore';

test('stores and removes typed values', async () => {
  const store = new MemoryStore();
  await store.set('prefs', { audioLanguage: 'en' });
  expect(await store.get('prefs')).toEqual({ audioLanguage: 'en' });
  await store.remove('prefs');
  expect(await store.get('prefs')).toBeNull();
});

test('returns independent copies of stored objects', async () => {
  const store = new MemoryStore();
  const original = { languages: ['en'] };
  await store.set('prefs', original);
  original.languages.push('fr');
  expect(await store.get('prefs')).toEqual({ languages: ['en'] });
});

test('removes corrupted JSON instead of blocking startup', async () => {
  const values = new Map([['prefs', '{broken']]);
  const removed: string[] = [];
  const store = new AsyncStorageStore({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      removed.push(key);
      values.delete(key);
    },
  });

  expect(await store.get('prefs')).toBeNull();
  expect(removed).toEqual(['prefs']);
});


test('removes oversized AsyncStorage JSON before parsing it', async () => {
  const values = new Map([
    ['prefs', 'x'.repeat(16_777_217)],
  ]);
  const removed: string[] = [];
  const store = new AsyncStorageStore({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      removed.push(key);
      values.delete(key);
    },
  });

  await expect(store.get('prefs')).resolves.toBeNull();
  expect(removed).toEqual(['prefs']);
});

test('rejects oversized AsyncStorage writes without persisting them', async () => {
  const values = new Map<string, string>();
  const store = new AsyncStorageStore({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  });

  await expect(
    store.set('prefs', { payload: 'x'.repeat(16_777_217) }),
  ).rejects.toThrow('Stored value is too large');
  expect(values.has('prefs')).toBe(false);
});

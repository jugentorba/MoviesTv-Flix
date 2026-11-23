import type { SecureStoreAdapter } from '../../addons/SecureAddonSecretStore';
import {
  MAX_M3U_PLAYLISTS,
  M3uPlaylistStore,
} from '../M3uPlaylistStore';

function memoryStore(seed: Record<string, string> = {}): SecureStoreAdapter & {
  values: Map<string, string>;
  writes: string[];
} {
  const values = new Map(Object.entries(seed));
  const writes: string[] = [];
  return {
    values,
    writes,
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      writes.push(key);
      values.set(key, value);
    },
    deleteItemAsync: async (key) => { values.delete(key); },
  };
}

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `extra${index}`;
}

describe('M3uPlaylistStore', () => {
  test('adds a playlist and lists it back', async () => {
    const secure = memoryStore();
    const store = new M3uPlaylistStore(secure, ids('p1'));

    const result = await store.add({
      name: '  My   Playlist ',
      url: 'http://iptv.example/get.php?user=u&pass=p',
    });

    expect(result).toEqual({
      ok: true,
      record: {
        id: 'p1',
        name: 'My Playlist',
        url: 'http://iptv.example/get.php?user=u&pass=p',
        priority: 0,
        enabled: true,
      },
    });
    expect(await store.list()).toEqual([result.ok ? result.record : null].filter(Boolean));
  });

  test('keeps the playlist URL out of the index key', async () => {
    const secure = memoryStore();
    const store = new M3uPlaylistStore(secure, ids('p1'));

    await store.add({ name: 'Secret', url: 'http://iptv.example/user/pass/list.m3u' });

    expect(secure.values.get('moviestv.m3u.local.playlists')).toBe('["p1"]');
  });

  test('rejects an empty name, an unusable URL and authority credentials', async () => {
    const store = new M3uPlaylistStore(memoryStore(), ids('p1', 'p2', 'p3'));

    expect(await store.add({ name: '   ', url: 'http://iptv.example/list.m3u' }))
      .toEqual({ ok: false, reason: 'invalid-name' });
    expect(await store.add({ name: 'Ok', url: 'file:///etc/passwd' }))
      .toEqual({ ok: false, reason: 'invalid-url' });
    expect(await store.add({ name: 'Ok', url: 'https://user:pass@iptv.example/list.m3u' }))
      .toEqual({ ok: false, reason: 'invalid-url' });
  });

  test('keeps path credentials, which IPTV providers use', async () => {
    const store = new M3uPlaylistStore(memoryStore(), ids('p1'));

    const result = await store.add({
      name: 'Xtream',
      url: 'http://host.example:8080/get.php?username=u&password=p',
    });

    expect(result.ok).toBe(true);
  });

  test('truncates a long name', async () => {
    const store = new M3uPlaylistStore(memoryStore(), ids('p1'));

    const result = await store.add({
      name: 'N'.repeat(400),
      url: 'http://iptv.example/list.m3u',
    });

    expect(result.ok && result.record.name).toHaveLength(120);
  });

  test('refuses to add beyond the playlist cap', async () => {
    const secure = memoryStore();
    let next = 0;
    const store = new M3uPlaylistStore(secure, () => `p${next++}`);
    for (let index = 0; index < MAX_M3U_PLAYLISTS; index += 1) {
      expect((await store.add({
        name: `Playlist ${index}`,
        url: `http://iptv.example/${index}.m3u`,
      })).ok).toBe(true);
    }

    expect(await store.add({ name: 'Extra', url: 'http://iptv.example/x.m3u' }))
      .toEqual({ ok: false, reason: 'too-many' });
  });

  test('toggles and removes a playlist', async () => {
    const secure = memoryStore();
    const store = new M3uPlaylistStore(secure, ids('p1'));
    await store.add({ name: 'One', url: 'http://iptv.example/one.m3u' });

    expect(await store.setEnabled('p1', false)).toBe(true);
    expect((await store.list())[0]?.enabled).toBe(false);

    expect(await store.remove('p1')).toBe(true);
    expect(await store.list()).toEqual([]);
    expect(await store.remove('p1')).toBe(false);
    expect(await store.setEnabled('p1', true)).toBe(false);
  });

  test('skips a corrupt record without losing the healthy ones', async () => {
    const secure = memoryStore({
      'moviestv.m3u.local.playlists': JSON.stringify(['good', 'broken', 'missing']),
      'moviestv.m3u.local.playlist.good': JSON.stringify({
        id: 'good',
        name: 'Good',
        url: 'https://iptv.example/good.m3u',
        priority: 5,
        enabled: true,
      }),
      'moviestv.m3u.local.playlist.broken': '{not json',
    });
    const store = new M3uPlaylistStore(secure);

    expect((await store.list()).map((record) => record.id)).toEqual(['good']);
  });

  test('ignores a corrupt or non-array index', async () => {
    for (const raw of ['{', '"p1"', 'null', '["../etc"]']) {
      const store = new M3uPlaylistStore(memoryStore({
        'moviestv.m3u.local.playlists': raw,
      }));
      expect(await store.list()).toEqual([]);
    }
  });

  test('keeps a previously stored record readable', async () => {
    const secure = memoryStore({
      'moviestv.m3u.local.playlists': JSON.stringify(['p1']),
      'moviestv.m3u.local.playlist.p1': JSON.stringify({
        id: 'p1',
        name: 'Existing',
        url: 'https://iptv.example/existing.m3u',
        priority: 10,
      }),
    });

    const [record] = await new M3uPlaylistStore(secure).list();

    expect(record).toEqual({
      id: 'p1',
      name: 'Existing',
      url: 'https://iptv.example/existing.m3u',
      priority: 10,
      enabled: true,
    });
  });

  test('retries when the generated id collides', async () => {
    const store = new M3uPlaylistStore(memoryStore(), ids('p1', 'p1', 'p2'));

    const first = await store.add({ name: 'One', url: 'http://iptv.example/one.m3u' });
    const second = await store.add({ name: 'Two', url: 'http://iptv.example/two.m3u' });

    expect(first.ok && first.record.id).toBe('p1');
    expect(second.ok && second.record.id).toBe('p2');
  });

  test('survives a secure store that throws', async () => {
    const failing: SecureStoreAdapter = {
      getItemAsync: async () => { throw new Error('keychain locked'); },
      setItemAsync: async () => { throw new Error('keychain locked'); },
      deleteItemAsync: async () => { throw new Error('keychain locked'); },
    };
    const store = new M3uPlaylistStore(failing);

    expect(await store.list()).toEqual([]);
    await expect(store.add({
      name: 'One',
      url: 'http://iptv.example/one.m3u',
    })).rejects.toThrow('keychain locked');
  });
});

describe('M3uPlaylistStore change notification', () => {
  test('notifies subscribers after add, toggle and remove only', async () => {
    const store = new M3uPlaylistStore(memoryStore(), ids('p1'));
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    await store.add({ name: 'One', url: 'http://iptv.example/one.m3u' });
    expect(listener).toHaveBeenCalledTimes(1);

    await store.setEnabled('p1', false);
    expect(listener).toHaveBeenCalledTimes(2);

    await store.remove('p1');
    expect(listener).toHaveBeenCalledTimes(3);

    // A rejected add changes nothing, so it must not notify.
    await store.add({ name: '', url: 'http://iptv.example/two.m3u' });
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    await store.add({ name: 'Two', url: 'http://iptv.example/two.m3u' });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  test('keeps writing when a subscriber throws', async () => {
    const store = new M3uPlaylistStore(memoryStore(), ids('p1'));
    store.subscribe(() => { throw new Error('subscriber failed'); });

    expect((await store.add({
      name: 'One',
      url: 'http://iptv.example/one.m3u',
    })).ok).toBe(true);
  });
});

describe('M3uPlaylistStore identity scoping', () => {
  test('keeps guest and signed-in playlists in separate lanes', async () => {
    const secure = memoryStore();
    const guest = new M3uPlaylistStore(secure, ids('guest-1'), 'guest');
    const member = new M3uPlaylistStore(secure, ids('user-1'), 'user-123');

    await guest.add({ name: 'Guest', url: 'http://iptv.example/guest.m3u' });
    await member.add({ name: 'Member', url: 'http://iptv.example/member.m3u' });

    expect((await guest.list()).map((record) => record.name)).toEqual(['Guest']);
    expect((await member.list()).map((record) => record.name)).toEqual(['Member']);
  });

  test('falls back to the default scope for an unsafe scope string', async () => {
    const secure = memoryStore();
    const store = new M3uPlaylistStore(secure, ids('p1'), '../../etc');

    await store.add({ name: 'One', url: 'http://iptv.example/one.m3u' });

    expect([...secure.values.keys()].some((key) => key.includes('..'))).toBe(false);
    expect((await store.list()).map((record) => record.name)).toEqual(['One']);
  });
});

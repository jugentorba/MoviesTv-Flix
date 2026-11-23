import type { GuideSnapshot } from '@moviestv/live-tv';
import {
  LiveTvGuideRepository,
  liveTvGuideFallbackStorageKeysForUser,
  liveTvGuideStorageKeysForUser,
} from '../LiveTvGuideRepository';

class MemoryStorage {
  readonly values = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.values.delete(key);
  }
}

class MemorySecureStorage {
  readonly values = new Map<string, string>();
  async getItemAsync(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async setItemAsync(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async deleteItemAsync(key: string): Promise<void> {
    this.values.delete(key);
  }
}

const CONFIG_KEY = '@moviestv/live-tv/guide/config/v1';
const CACHE_KEY = '@moviestv/live-tv/guide/cache/v1';
const SECURE_KEY = 'moviestv.live-tv.guide.url.v1';

function snapshot(sourceRevision = 1): GuideSnapshot {
  return {
    sourceRevision,
    fetchedAtMs: Date.UTC(2026, 8, 14, 18, 0, 0),
    channels: [{
      id: 'fr2.xmltv',
      displayNames: ['France 2'],
      countryCode: 'FR',
    }],
    programmes: [{
      channelId: 'fr2.xmltv',
      title: 'Journal',
      startAtMs: Date.UTC(2026, 8, 14, 18, 0, 0),
      endAtMs: Date.UTC(2026, 8, 14, 18, 45, 0),
    }],
  };
}

describe('LiveTvGuideRepository', () => {
  test('stores a plain HTTPS guide URL as non-secret device config', async () => {
    const storage = new MemoryStorage();
    const secure = new MemorySecureStorage();
    const repository = new LiveTvGuideRepository(storage, secure);

    const saved = await repository.saveValidatedUrl('https://guide.example/epg.xml');

    expect(saved).toEqual({
      configured: true,
      sourceRevision: 1,
      secure: false,
      publicUrl: 'https://guide.example/epg.xml',
    });
    expect(await repository.resolveUrl()).toBe('https://guide.example/epg.xml');
    expect(secure.values.has(SECURE_KEY)).toBe(false);
    expect(storage.values.get(CONFIG_KEY)).toContain('https://guide.example/epg.xml');
  });

  test('stores query-bearing guide URLs only in secure storage', async () => {
    const storage = new MemoryStorage();
    const secure = new MemorySecureStorage();
    const repository = new LiveTvGuideRepository(storage, secure);
    const secretUrl = 'https://guide.example/epg.xml?token=secret-value';

    const saved = await repository.saveValidatedUrl(secretUrl);

    expect(saved).toEqual({
      configured: true,
      sourceRevision: 1,
      secure: true,
    });
    expect(await repository.resolveUrl()).toBe(secretUrl);
    expect(secure.values.get(SECURE_KEY)).toBe(secretUrl);
    expect(storage.values.get(CONFIG_KEY)).not.toContain(secretUrl);
    expect(storage.values.get(CONFIG_KEY)).not.toContain('secret-value');
  });

  test('stores credentialized guide path segments only in secure storage', async () => {
    const storage = new MemoryStorage();
    const secure = new MemorySecureStorage();
    const repository = new LiveTvGuideRepository(storage, secure);
    const privateUrl =
      'https://guide.example/token=fixture-value/epg.xml';

    const saved = await repository.saveValidatedUrl(privateUrl);

    expect(saved).toEqual({
      configured: true,
      sourceRevision: 1,
      secure: true,
    });
    expect(await repository.resolveUrl()).toBe(privateUrl);
    expect(secure.values.get(SECURE_KEY)).toBe(privateUrl);
    expect(storage.values.get(CONFIG_KEY)).not.toContain(privateUrl);
    expect(storage.values.get(CONFIG_KEY)).not.toContain('fixture-value');
  });

  test('stores opaque token-like guide path segments only in secure storage', async () => {
    const storage = new MemoryStorage();
    const secure = new MemorySecureStorage();
    const repository = new LiveTvGuideRepository(storage, secure);
    const privateUrls = [
      'https://guide.example/a94f2c8e7d1b4a6c9e0f123456789abc/epg.xml',
      'https://guide.example/AbCdEfGhIjKlMnOpQrStUvWx12345678/epg.xml',
      'https://guide.example/550e8400-e29b-41d4-a716-446655440000/epg.xml',
    ];

    for (const privateUrl of privateUrls) {
      const saved = await repository.saveValidatedUrl(privateUrl);

      expect(saved).toEqual(expect.objectContaining({
        configured: true,
        secure: true,
      }));
      expect(await repository.resolveUrl()).toBe(privateUrl);
      expect(secure.values.get(SECURE_KEY)).toBe(privateUrl);
      expect(storage.values.get(CONFIG_KEY)).not.toContain(privateUrl);
    }
  });

  test('drops legacy plain config when its path now looks credentialized', async () => {
    const storage = new MemoryStorage();
    const secure = new MemorySecureStorage();
    const repository = new LiveTvGuideRepository(storage, secure);
    const privateUrl =
      'https://guide.example/a94f2c8e7d1b4a6c9e0f123456789abc/epg.xml';

    storage.values.set(
      CONFIG_KEY,
      JSON.stringify({
        configured: true,
        sourceRevision: 1,
        secure: false,
        publicUrl: privateUrl,
      }),
    );

    await expect(repository.loadConfig()).resolves.toEqual({
      configured: false,
      sourceRevision: 0,
      secure: false,
    });
    expect(storage.values.has(CONFIG_KEY)).toBe(false);
    expect(secure.values.size).toBe(0);
  });

  test('strips URL fragments before persistence', async () => {
    const storage = new MemoryStorage();
    const repository = new LiveTvGuideRepository(
      storage,
      new MemorySecureStorage(),
    );

    const saved = await repository.saveValidatedUrl(
      'https://guide.example/epg.xml#private-fragment',
    );

    expect(saved).toMatchObject({
      secure: false,
      publicUrl: 'https://guide.example/epg.xml',
    });
    expect(storage.values.get(CONFIG_KEY)).not.toContain('private-fragment');
  });

  test('rejects non-HTTPS URLs and embedded credentials', async () => {
    const repository = new LiveTvGuideRepository(
      new MemoryStorage(),
      new MemorySecureStorage(),
    );

    await expect(
      repository.saveValidatedUrl('http://guide.example/epg.xml'),
    ).rejects.toThrow('Guide URL must be HTTPS without embedded credentials');

    await expect(
      repository.saveValidatedUrl('https://user:pass@guide.example/epg.xml'),
    ).rejects.toThrow('Guide URL must be HTTPS without embedded credentials');
  });

  test('rejects oversized guide URLs before local or secure persistence', async () => {
    const storage = new MemoryStorage();
    const secure = new MemorySecureStorage();
    const repository = new LiveTvGuideRepository(storage, secure);
    const oversized = `https://guide.example/epg.xml?token=${'x'.repeat(5_000)}`;

    await expect(
      repository.saveValidatedUrl(oversized),
    ).rejects.toThrow('Guide URL');

    expect(storage.values.size).toBe(0);
    expect(secure.values.size).toBe(0);
  });

  test('rejects unsafe persisted source revision integers', async () => {
    const storage = new MemoryStorage();
    const repository = new LiveTvGuideRepository(
      storage,
      new MemorySecureStorage(),
    );
    storage.values.set(
      CONFIG_KEY,
      JSON.stringify({
        configured: true,
        sourceRevision: Number.MAX_SAFE_INTEGER + 1,
        secure: false,
        publicUrl: 'https://guide.example/epg.xml',
      }),
    );

    await expect(repository.loadConfig()).resolves.toEqual({
      configured: false,
      sourceRevision: 0,
      secure: false,
    });
    expect(storage.values.has(CONFIG_KEY)).toBe(false);
  });

  test('does not persist guide caches above the repository size ceiling', async () => {
    const storage = new MemoryStorage();
    const repository = new LiveTvGuideRepository(
      storage,
      new MemorySecureStorage(),
    );
    const base = snapshot(1).programmes[0]!;
    const huge: GuideSnapshot = {
      ...snapshot(1),
      programmes: Array.from(
        { length: 3_000 },
        (_, index) => ({
          ...base,
          title: `Programme ${index}`,
          description: 'x'.repeat(4_000),
          startAtMs: base.startAtMs + index,
          endAtMs: base.endAtMs + index,
        }),
      ),
    };

    await expect(repository.saveCache(huge))
      .rejects.toThrow('too large');
    expect(storage.values.has(CACHE_KEY)).toBe(false);
  });

  test('increments revision only when source changes and clears old cache', async () => {
    const storage = new MemoryStorage();
    const repository = new LiveTvGuideRepository(
      storage,
      new MemorySecureStorage(),
    );

    const first = await repository.saveValidatedUrl('https://guide.example/epg.xml');
    await repository.saveCache(snapshot(first.sourceRevision));

    const same = await repository.saveValidatedUrl('https://guide.example/epg.xml');
    expect(same.sourceRevision).toBe(first.sourceRevision);
    expect(await repository.loadCache(first.sourceRevision)).not.toBeNull();

    const changed = await repository.saveValidatedUrl(
      'https://guide.example/second.xml',
    );
    expect(changed.sourceRevision).toBe(first.sourceRevision + 1);
    expect(await repository.loadCache(changed.sourceRevision)).toBeNull();
  });

  test('requires cache revision to match active guide source', async () => {
    const storage = new MemoryStorage();
    const repository = new LiveTvGuideRepository(
      storage,
      new MemorySecureStorage(),
    );
    await repository.saveValidatedUrl('https://guide.example/epg.xml');

    await repository.saveCache(snapshot(1));

    expect(await repository.loadCache(1)).toEqual(snapshot(1));
    expect(await repository.loadCache(2)).toBeNull();
    expect(storage.values.get(CACHE_KEY) ?? '').not.toContain('guide.example');
  });

  test('drops oversized persisted guide config before JSON parsing', async () => {
    const storage = new MemoryStorage();
    const repository = new LiveTvGuideRepository(
      storage,
      new MemorySecureStorage(),
    );
    storage.values.set(
      CONFIG_KEY,
      'x'.repeat(16_385),
    );

    await expect(repository.loadConfig()).resolves.toEqual({
      configured: false,
      sourceRevision: 0,
      secure: false,
    });
    expect(storage.values.has(CONFIG_KEY)).toBe(false);
  });

  test('clears malformed cache instead of returning it', async () => {
    const storage = new MemoryStorage();
    const repository = new LiveTvGuideRepository(
      storage,
      new MemorySecureStorage(),
    );
    storage.values.set(
      CACHE_KEY,
      JSON.stringify({ sourceRevision: 1, channels: 'bad', programmes: [] }),
    );

    expect(await repository.loadCache(1)).toBeNull();
    expect(storage.values.has(CACHE_KEY)).toBe(false);
  });

  test('clears persisted guide entries with oversized fields', async () => {
    const storage = new MemoryStorage();
    const repository = new LiveTvGuideRepository(
      storage,
      new MemorySecureStorage(),
    );

    for (const unsafe of [
      {
        ...snapshot(1),
        channels: [{
          id: 'x'.repeat(513),
          displayNames: ['Channel'],
        }],
      },
      {
        ...snapshot(1),
        channels: [{
          id: 'fr2.xmltv',
          displayNames: ['N'.repeat(501)],
        }],
      },
      {
        ...snapshot(1),
        programmes: [{
          ...snapshot(1).programmes[0]!,
          title: 'T'.repeat(501),
        }],
      },
      {
        ...snapshot(1),
        programmes: [{
          ...snapshot(1).programmes[0]!,
          description: 'D'.repeat(4_001),
        }],
      },
    ]) {
      storage.values.set(CACHE_KEY, JSON.stringify(unsafe));
      await expect(repository.loadCache(1)).resolves.toBeNull();
      expect(storage.values.has(CACHE_KEY)).toBe(false);
    }
  });

  test('drops an oversized persisted guide cache before JSON parsing', async () => {
    const storage = new MemoryStorage();
    const repository = new LiveTvGuideRepository(
      storage,
      new MemorySecureStorage(),
    );
    storage.values.set(
      CACHE_KEY,
      'x'.repeat(10_485_761),
    );

    await expect(repository.loadCache(1)).resolves.toBeNull();
    expect(storage.values.has(CACHE_KEY)).toBe(false);
  });

  test('remove clears config, secret and cached schedule data', async () => {
    const storage = new MemoryStorage();
    const secure = new MemorySecureStorage();
    const repository = new LiveTvGuideRepository(storage, secure);
    await repository.saveValidatedUrl(
      'https://guide.example/epg.xml?token=secret',
    );
    await repository.saveCache(snapshot(1));

    await repository.removeConfig();

    expect(await repository.loadConfig()).toEqual({
      configured: false,
      sourceRevision: 0,
      secure: false,
    });
    expect(await repository.resolveUrl()).toBeNull();
    expect(storage.values.has(CONFIG_KEY)).toBe(false);
    expect(storage.values.has(CACHE_KEY)).toBe(false);
    expect(secure.values.has(SECURE_KEY)).toBe(false);
  });

  test('uses Expo SecureStore-safe keys for scoped private guide URLs', () => {
    const guestKey = liveTvGuideStorageKeysForUser(null).secureUrl;
    const accountKey = liveTvGuideStorageKeysForUser(
      'account@example.com',
    ).secureUrl;

    expect(guestKey).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(accountKey).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(guestKey).not.toBe(accountKey);
    expect(accountKey).not.toContain(':');
  });

  test('migrates the previous scoped private guide URL key', async () => {
    const storage = new MemoryStorage();
    const secure = new MemorySecureStorage();
    const accountKeys = liveTvGuideStorageKeysForUser('a');
    const previousSecureKey =
      'moviestv.live-tv.guide.url.v1:user:a';

    storage.values.set(
      accountKeys.config,
      JSON.stringify({
        configured: true,
        sourceRevision: 1,
        secure: true,
      }),
    );
    secure.values.set(
      previousSecureKey,
      'https://guide.example/epg.xml?token=old-scoped',
    );

    const repository = new LiveTvGuideRepository(
      storage,
      secure,
      accountKeys,
      liveTvGuideFallbackStorageKeysForUser('a'),
    );

    await expect(repository.resolveUrl()).resolves.toBe(
      'https://guide.example/epg.xml?token=old-scoped',
    );
    expect(secure.values.has(previousSecureKey)).toBe(false);
    expect(secure.values.get(accountKeys.secureUrl)).toContain(
      'old-scoped',
    );
  });

  test('migrates legacy guide config, cache and secure URL into guest scope', async () => {
    const storage = new MemoryStorage();
    const secure = new MemorySecureStorage();
    const guestKeys = liveTvGuideStorageKeysForUser(null);
    storage.values.set(
      CONFIG_KEY,
      JSON.stringify({
        configured: true,
        sourceRevision: 1,
        secure: true,
      }),
    );
    storage.values.set(CACHE_KEY, JSON.stringify(snapshot(1)));
    secure.values.set(
      SECURE_KEY,
      'https://guide.example/epg.xml?token=legacy-secret',
    );

    const repository = new LiveTvGuideRepository(
      storage,
      secure,
      guestKeys,
      liveTvGuideFallbackStorageKeysForUser(null),
    );

    await expect(repository.loadConfig()).resolves.toEqual({
      configured: true,
      sourceRevision: 1,
      secure: true,
    });
    await expect(repository.resolveUrl()).resolves.toBe(
      'https://guide.example/epg.xml?token=legacy-secret',
    );
    await expect(repository.loadCache(1)).resolves.toEqual(snapshot(1));

    expect(storage.values.has(CONFIG_KEY)).toBe(false);
    expect(storage.values.has(CACHE_KEY)).toBe(false);
    expect(secure.values.has(SECURE_KEY)).toBe(false);
    expect(storage.values.get(guestKeys.config)).toBeTruthy();
    expect(storage.values.get(guestKeys.cache)).toBeTruthy();
    expect(secure.values.get(guestKeys.secureUrl)).toBe(
      'https://guide.example/epg.xml?token=legacy-secret',
    );
  });

  test('promotes guest guide data to one account without exposing it to another', async () => {
    const storage = new MemoryStorage();
    const secure = new MemorySecureStorage();
    const guestKeys = liveTvGuideStorageKeysForUser(null);
    storage.values.set(
      guestKeys.config,
      JSON.stringify({
        configured: true,
        sourceRevision: 1,
        secure: true,
      }),
    );
    storage.values.set(guestKeys.cache, JSON.stringify(snapshot(1)));
    secure.values.set(
      guestKeys.secureUrl,
      'https://guide.example/epg.xml?token=guest-secret',
    );

    const accountAKeys = liveTvGuideStorageKeysForUser('a');
    const accountA = new LiveTvGuideRepository(
      storage,
      secure,
      accountAKeys,
      liveTvGuideFallbackStorageKeysForUser('a'),
    );

    await expect(accountA.loadConfig()).resolves.toEqual({
      configured: true,
      sourceRevision: 1,
      secure: true,
    });
    await expect(accountA.resolveUrl()).resolves.toBe(
      'https://guide.example/epg.xml?token=guest-secret',
    );
    await expect(accountA.loadCache(1)).resolves.toEqual(snapshot(1));

    expect(storage.values.has(guestKeys.config)).toBe(false);
    expect(storage.values.has(guestKeys.cache)).toBe(false);
    expect(secure.values.has(guestKeys.secureUrl)).toBe(false);
    expect(storage.values.has(accountAKeys.config)).toBe(true);
    expect(storage.values.has(accountAKeys.cache)).toBe(true);
    expect(secure.values.get(accountAKeys.secureUrl)).toContain(
      'guest-secret',
    );

    const accountB = new LiveTvGuideRepository(
      storage,
      secure,
      liveTvGuideStorageKeysForUser('b'),
      liveTvGuideFallbackStorageKeysForUser('b'),
    );

    await expect(accountB.loadConfig()).resolves.toEqual({
      configured: false,
      sourceRevision: 0,
      secure: false,
    });
    await expect(accountB.resolveUrl()).resolves.toBeNull();
  });

  test('removing one account guide leaves another account guide untouched', async () => {
    const storage = new MemoryStorage();
    const secure = new MemorySecureStorage();

    const accountA = new LiveTvGuideRepository(
      storage,
      secure,
      liveTvGuideStorageKeysForUser('a'),
      [],
    );
    const accountB = new LiveTvGuideRepository(
      storage,
      secure,
      liveTvGuideStorageKeysForUser('b'),
      [],
    );

    await accountA.saveValidatedUrl(
      'https://guide-a.example/epg.xml?token=secret-a',
    );
    await accountA.saveCache(snapshot(1));
    await accountB.saveValidatedUrl(
      'https://guide-b.example/epg.xml?token=secret-b',
    );
    await accountB.saveCache(snapshot(1));

    await accountA.removeConfig();

    await expect(accountA.loadConfig()).resolves.toEqual({
      configured: false,
      sourceRevision: 0,
      secure: false,
    });
    await expect(accountA.resolveUrl()).resolves.toBeNull();
    await expect(accountA.loadCache(1)).resolves.toBeNull();

    await expect(accountB.loadConfig()).resolves.toEqual({
      configured: true,
      sourceRevision: 1,
      secure: true,
    });
    await expect(accountB.resolveUrl()).resolves.toBe(
      'https://guide-b.example/epg.xml?token=secret-b',
    );
    await expect(accountB.loadCache(1)).resolves.toEqual(snapshot(1));
  });


  test('locks leftover legacy guide data to the first account that claims migration', async () => {
    const storage = new MemoryStorage();
    const secure = new MemorySecureStorage();

    storage.values.set(
      CONFIG_KEY,
      JSON.stringify({
        configured: true,
        sourceRevision: 1,
        secure: true,
      }),
    );
    storage.values.set(CACHE_KEY, JSON.stringify(snapshot(1)));
    secure.values.set(
      SECURE_KEY,
      'https://guide.example/epg.xml?token=legacy-owner-secret',
    );

    const accountA = new LiveTvGuideRepository(
      storage,
      secure,
      liveTvGuideStorageKeysForUser('a'),
      liveTvGuideFallbackStorageKeysForUser('a'),
    );

    await expect(accountA.loadConfig()).resolves.toEqual({
      configured: true,
      sourceRevision: 1,
      secure: true,
    });

    const accountB = new LiveTvGuideRepository(
      storage,
      secure,
      liveTvGuideStorageKeysForUser('b'),
      liveTvGuideFallbackStorageKeysForUser('b'),
    );

    await expect(accountB.loadCache(1)).resolves.toBeNull();
    await expect(accountB.loadConfig()).resolves.toEqual({
      configured: false,
      sourceRevision: 0,
      secure: false,
    });

    await expect(accountA.resolveUrl()).resolves.toBe(
      'https://guide.example/epg.xml?token=legacy-owner-secret',
    );
    await expect(accountA.loadCache(1)).resolves.toEqual(snapshot(1));
  });

});

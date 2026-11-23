import {
  SecureAddonSecretStore,
  addonSecretScopeForUser,
  type SecureStoreAdapter,
} from '../SecureAddonSecretStore';

class MemorySecureStore implements SecureStoreAdapter {
  readonly values = new Map<string, string>();
  readonly deleted: string[] = [];

  async getItemAsync(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async deleteItemAsync(key: string): Promise<void> {
    this.deleted.push(key);
    this.values.delete(key);
  }
}

describe('SecureAddonSecretStore', () => {
  it('namespaces provider secrets away from ordinary application storage', async () => {
    const storage = new MemorySecureStore();
    const secrets = new SecureAddonSecretStore(storage);

    await secrets.set('provider-a', 'apiKey', 'super-secret');

    expect(storage.values.get('moviestv.addon.provider-a.apiKey')).toBe('super-secret');
    await expect(secrets.get('provider-a', 'apiKey')).resolves.toBe('super-secret');
  });

  it('deletes a single provider secret by its namespaced key', async () => {
    const storage = new MemorySecureStore();
    const secrets = new SecureAddonSecretStore(storage);
    await secrets.set('provider-a', 'apiKey', 'super-secret');

    await secrets.delete('provider-a', 'apiKey');

    expect(storage.deleted).toEqual(['moviestv.addon.provider-a.apiKey']);
    await expect(secrets.get('provider-a', 'apiKey')).resolves.toBeNull();
  });

  it('deletes every known secret field when a provider is removed', async () => {
    const storage = new MemorySecureStore();
    const secrets = new SecureAddonSecretStore(storage);
    await secrets.set('provider-a', 'apiKey', 'secret-a');
    await secrets.set('provider-a', 'token', 'secret-b');

    await secrets.deleteProvider('provider-a', ['apiKey', 'token']);

    expect(storage.deleted).toEqual([
      'moviestv.addon.provider-a.apiKey',
      'moviestv.addon.provider-a.token',
    ]);
    expect(storage.values.size).toBe(0);
  });

  it('rolls back a partial multi-field provider value deletion', async () => {
    class FailingSecondDeleteStore extends MemorySecureStore {
      private deleteCount = 0;

      override async deleteItemAsync(key: string): Promise<void> {
        this.deleteCount += 1;
        if (this.deleteCount === 2) {
          throw new Error('fixture delete failed');
        }
        await super.deleteItemAsync(key);
      }
    }

    const storage = new FailingSecondDeleteStore();
    const secrets = new SecureAddonSecretStore(storage);
    await secrets.set('provider-a', 'fieldA', 'fixture-a');
    await secrets.set('provider-a', 'fieldB', 'fixture-b');

    await expect(
      secrets.deleteProvider('provider-a', ['fieldA', 'fieldB']),
    ).rejects.toThrow('fixture delete failed');

    await expect(secrets.get('provider-a', 'fieldA'))
      .resolves.toBe('fixture-a');
    await expect(secrets.get('provider-a', 'fieldB'))
      .resolves.toBe('fixture-b');
  });

  it('rejects invalid provider ids, field keys, and oversized secret values', async () => {
    const storage = new MemorySecureStore();
    const secrets = new SecureAddonSecretStore(storage);

    await expect(
      secrets.set('x'.repeat(513), 'apiKey', 'secret'),
    ).rejects.toThrow('Provider secret id is invalid');
    await expect(
      secrets.set('provider-a', 'x'.repeat(129), 'secret'),
    ).rejects.toThrow('Provider secret field is invalid');
    await expect(
      secrets.set('provider-a', 'apiKey', 'x'.repeat(16_385)),
    ).rejects.toThrow('Provider secret value is invalid');
    await expect(
      secrets.get('provider-a\u0000bad', 'apiKey'),
    ).rejects.toThrow('Provider secret id is invalid');

    expect(storage.values.size).toBe(0);
  });

  it('rejects invalid account scopes instead of falling back to guest secrets', () => {
    expect(() => addonSecretScopeForUser('   '))
      .toThrow('Provider secret user id is invalid');
    expect(() => addonSecretScopeForUser('x'.repeat(513)))
      .toThrow('Provider secret user id is invalid');
    expect(() => addonSecretScopeForUser('bad\u0000user'))
      .toThrow('Provider secret user id is invalid');

    expect(addonSecretScopeForUser(null)).toBe('guest');
    expect(addonSecretScopeForUser(' user-1 ')).toBe('user:user-1');
  });

  it('drops corrupt or oversized legacy secrets instead of migrating them', async () => {
    const storage = new MemorySecureStore();
    storage.values.set(
      'moviestv.addon.provider-a.apiKey',
      'x'.repeat(16_385),
    );
    const secrets = new SecureAddonSecretStore(
      storage,
      addonSecretScopeForUser(null),
      [],
      true,
    );

    await expect(secrets.get('provider-a', 'apiKey'))
      .resolves.toBeNull();

    expect(
      storage.values.has('moviestv.addon.provider-a.apiKey'),
    ).toBe(false);
    expect(
      [...storage.values.values()].some(
        (value) => value.length > 16_384,
      ),
    ).toBe(false);
  });

  it('migrates a legacy secret into guest scope on first read', async () => {
    const storage = new MemorySecureStore();
    storage.values.set('moviestv.addon.provider-a.apiKey', 'legacy-secret');
    const secrets = new SecureAddonSecretStore(
      storage,
      addonSecretScopeForUser(null),
      [],
      true,
    );

    await expect(secrets.get('provider-a', 'apiKey'))
      .resolves.toBe('legacy-secret');
    const migratedKeys = [...storage.values.entries()]
      .filter(([, value]) => value === 'legacy-secret')
      .map(([key]) => key);
    expect(migratedKeys).toHaveLength(1);
    expect(migratedKeys[0]).toContain('moviestv.addon.scope2.');
    expect(migratedKeys[0]).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(storage.values.has('moviestv.addon.provider-a.apiKey')).toBe(false);
  });

  it('uses collision-resistant Expo SecureStore-safe scoped keys', async () => {
    const storage = new MemorySecureStore();
    const secrets = new SecureAddonSecretStore(
      storage,
      addonSecretScopeForUser('account@example.com'),
      [],
      true,
    );

    await secrets.set('provider.a', 'token', 'secret-one');
    await secrets.set('provider', 'a.token', 'secret-two');

    await expect(secrets.get('provider.a', 'token'))
      .resolves.toBe('secret-one');
    await expect(secrets.get('provider', 'a.token'))
      .resolves.toBe('secret-two');

    const secretKeys = [...storage.values.entries()]
      .filter(([, value]) => value.startsWith('secret-'))
      .map(([key]) => key);
    expect(secretKeys).toHaveLength(2);
    expect(new Set(secretKeys).size).toBe(2);
    for (const key of secretKeys) {
      expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(key).toContain('moviestv.addon.scope2.');
    }
  });

  it('migrates the previous scoped key format without keeping the old key', async () => {
    const storage = new MemorySecureStore();
    const oldKey = 'moviestv.addon.scope.guest.provider-a.apiKey';
    storage.values.set(oldKey, 'old-scoped-secret');
    const secrets = new SecureAddonSecretStore(
      storage,
      addonSecretScopeForUser(null),
      [],
      true,
    );

    await expect(secrets.get('provider-a', 'apiKey'))
      .resolves.toBe('old-scoped-secret');

    expect(storage.values.has(oldKey)).toBe(false);
    expect([...storage.values.entries()].some(
      ([key, value]) => (
        key.includes('moviestv.addon.scope2.')
        && value === 'old-scoped-secret'
      ),
    )).toBe(true);
  });

  it('promotes guest secrets to one account without exposing them to another', async () => {
    const storage = new MemorySecureStore();
    const guest = new SecureAddonSecretStore(
      storage,
      addonSecretScopeForUser(null),
      [],
      true,
    );
    await guest.set('provider-a', 'apiKey', 'guest-secret');

    const accountA = new SecureAddonSecretStore(
      storage,
      addonSecretScopeForUser('a'),
      [addonSecretScopeForUser(null)],
      true,
    );
    await expect(accountA.get('provider-a', 'apiKey'))
      .resolves.toBe('guest-secret');

    const accountB = new SecureAddonSecretStore(
      storage,
      addonSecretScopeForUser('b'),
      [addonSecretScopeForUser(null)],
      true,
    );
    await expect(accountB.get('provider-a', 'apiKey')).resolves.toBeNull();
  });


  it('locks remaining legacy secrets to the first signed-in account that claims them', async () => {
    const storage = new MemorySecureStore();
    storage.values.set(
      'moviestv.addon.provider-a.apiKey',
      'legacy-a',
    );
    storage.values.set(
      'moviestv.addon.provider-b.apiKey',
      'legacy-b',
    );

    const accountA = new SecureAddonSecretStore(
      storage,
      addonSecretScopeForUser('a'),
      [addonSecretScopeForUser(null)],
      true,
    );
    await expect(accountA.get('provider-a', 'apiKey'))
      .resolves.toBe('legacy-a');

    expect(
      storage.values.get('moviestv.addon.legacy-owner'),
    ).toBe(addonSecretScopeForUser('a'));

    const accountB = new SecureAddonSecretStore(
      storage,
      addonSecretScopeForUser('b'),
      [addonSecretScopeForUser(null)],
      true,
    );
    await expect(accountB.get('provider-b', 'apiKey'))
      .resolves.toBeNull();

    await expect(accountA.get('provider-b', 'apiKey'))
      .resolves.toBe('legacy-b');
  });

  it('guest mode cannot reclaim legacy secrets after an account owns migration', async () => {
    const storage = new MemorySecureStore();
    storage.values.set(
      'moviestv.addon.provider-a.apiKey',
      'legacy-secret',
    );

    const accountA = new SecureAddonSecretStore(
      storage,
      addonSecretScopeForUser('a'),
      [addonSecretScopeForUser(null)],
      true,
    );
    await accountA.get('provider-a', 'missing');

    const guest = new SecureAddonSecretStore(
      storage,
      addonSecretScopeForUser(null),
      [],
      true,
    );
    await expect(guest.get('provider-a', 'apiKey'))
      .resolves.toBeNull();
    await expect(accountA.get('provider-a', 'apiKey'))
      .resolves.toBe('legacy-secret');
  });

});

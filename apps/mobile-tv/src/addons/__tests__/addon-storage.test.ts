import type { AddonStateRecord } from '@moviestv/addons';
import { MemoryStore } from '@moviestv/storage';
import {
  AsyncStorageAddonRepository,
  addonFallbackStorageKeysForUser,
  addonStorageKeyForUser,
} from '../AsyncStorageAddonRepository';

function record(addonId: string, priority: number): AddonStateRecord {
  const now = '2026-09-15T11:30:00.000Z';
  return {
    installed: {
      addonId,
      sourceType: 'stremio-manifest',
      manifestUrl: `https://example.com/${addonId}/manifest.json`,
      enabled: true,
      priority,
      installedAt: now,
      updatedAt: now,
      setupIncomplete: false,
    },
    safeConfig: { region: 'fr' },
  };
}

describe('AsyncStorageAddonRepository', () => {
  it('round-trips installed provider metadata without requiring native storage', async () => {
    const store = new MemoryStore();
    const repository = new AsyncStorageAddonRepository(store);
    const input = record('provider-a', 100);

    await repository.save(input);

    await expect(repository.list()).resolves.toEqual([input]);
  });

  it('upserts by addon id instead of duplicating an installed provider', async () => {
    const store = new MemoryStore();
    const repository = new AsyncStorageAddonRepository(store);
    const first = record('provider-a', 100);
    const updated = {
      ...first,
      installed: { ...first.installed, enabled: false, updatedAt: '2026-09-15T11:31:00.000Z' },
    };

    await repository.save(first);
    await repository.save(updated);

    await expect(repository.list()).resolves.toEqual([updated]);
  });

  it('removes one provider without changing the others', async () => {
    const store = new MemoryStore();
    const repository = new AsyncStorageAddonRepository(store);
    await repository.save(record('provider-a', 100));
    await repository.save(record('provider-b', 50));

    await repository.remove('provider-a');

    await expect(repository.list()).resolves.toEqual([record('provider-b', 50)]);
  });

  it('reorders providers by assigning descending priorities in the requested order', async () => {
    const store = new MemoryStore();
    const repository = new AsyncStorageAddonRepository(store);
    await repository.save(record('provider-a', 100));
    await repository.save(record('provider-b', 50));

    await repository.reorder(['provider-b', 'provider-a']);

    const result = await repository.list();
    expect(result.map((item) => item.installed.addonId)).toEqual(['provider-b', 'provider-a']);
    expect(result[0]?.installed.priority).toBeGreaterThan(result[1]?.installed.priority ?? 0);
  });

  it('can stamp a provider reorder with one synchronization timestamp', async () => {
    const store = new MemoryStore();
    const repository = new AsyncStorageAddonRepository(store);
    await repository.save(record('provider-a', 100));
    await repository.save(record('provider-b', 50));

    await repository.reorder(
      ['provider-b', 'provider-a'],
      '2026-09-22T10:00:00.001Z',
    );

    const result = await repository.list();
    expect(result.map((item) => item.installed.updatedAt)).toEqual([
      '2026-09-22T10:00:00.001Z',
      '2026-09-22T10:00:00.001Z',
    ]);
  });

  it('scrubs legacy credential-bearing safe config and descriptor artwork', async () => {
    const store = new MemoryStore();
    const repository = new AsyncStorageAddonRepository(store);
    const unsafe = record('provider-a', 100) as any;
    unsafe.safeConfig = {
      region: 'fr',
      endpoint:
        'https://api.example/config?token=LOCAL-SECRET',
      pathEndpoint:
        'https://api.example/token=fixture-value/config',
      note: 'secret=LOCAL-PLAIN',
      localEndpoint: 'http://127.0.0.1:7000/api',
      scriptEndpoint: 'javascript:alert(1)',
    };
    unsafe.descriptor = {
      id: 'provider-a',
      name: 'Provider A',
      version: '1.0.0',
      sourceType: 'stremio-manifest',
      capabilities: ['stream'],
      requiresConfiguration: false,
      configurable: true,
      configurationFields: [
        {
          key: 'region',
          label: 'Region',
          type: 'text',
          required: false,
          secret: false,
        },
        {
          key: 'endpoint',
          label: 'Endpoint',
          type: 'url',
          required: false,
          secret: false,
        },
        {
          key: 'pathEndpoint',
          label: 'Path endpoint',
          type: 'url',
          required: false,
          secret: false,
        },
        {
          key: 'note',
          label: 'Note',
          type: 'text',
          required: false,
          secret: false,
        },
        {
          key: 'localEndpoint',
          label: 'Local endpoint',
          type: 'url',
          required: false,
          secret: false,
        },
        {
          key: 'scriptEndpoint',
          label: 'Script endpoint',
          type: 'url',
          required: false,
          secret: false,
        },
      ],
      supportedMediaKinds: ['movie'],
      logoUrl:
        'https://images.example/key=fixture-value/logo.png',
    };

    await store.set('moviestv.addons', [unsafe]);

    const [restored] = await repository.list();

    expect(restored?.safeConfig).toEqual({
      region: 'fr',
      localEndpoint: 'http://127.0.0.1:7000/api',
    });
    expect(restored?.descriptor?.logoUrl).toBeUndefined();
    expect(JSON.stringify(restored)).not.toContain('LOCAL-SECRET');
    expect(JSON.stringify(restored)).not.toContain('LOCAL-PLAIN');
    expect(JSON.stringify(restored)).not.toContain('fixture-value');
  });

  it('scrubs every duplicate config declaration when one copy is secret', async () => {
    const store = new MemoryStore();
    const repository = new AsyncStorageAddonRepository(store);
    const unsafe = record('provider-a', 100) as any;
    unsafe.descriptor = {
      id: 'provider-a',
      name: 'Provider A',
      version: '1.0.0',
      sourceType: 'stremio-manifest',
      capabilities: ['stream'],
      requiresConfiguration: true,
      configurable: true,
      configurationFields: [
        {
          key: 'credential',
          label: 'Credential',
          type: 'secret',
          required: true,
          secret: true,
          defaultValue: 'MUST-NOT-SURVIVE',
        },
        {
          key: 'credential',
          label: 'Duplicate',
          type: 'text',
          required: false,
          secret: false,
          defaultValue: 'ALSO-MUST-NOT-SURVIVE',
          options: [{
            value: 'LEAK',
            label: 'Leak',
          }],
        },
      ],
      supportedMediaKinds: ['movie'],
    };
    unsafe.safeConfig = {
      credential: 'LEGACY-PLAINTEXT',
    };

    await store.set('moviestv.addons', [unsafe]);
    const [restored] = await repository.list();

    expect(restored?.safeConfig).toEqual({});
    expect(
      restored?.descriptor?.configurationFields,
    ).toEqual([
      expect.objectContaining({
        key: 'credential',
        type: 'secret',
        secret: true,
      }),
      expect.objectContaining({
        key: 'credential',
        type: 'secret',
        secret: true,
      }),
    ]);
    for (const field of restored?.descriptor?.configurationFields ?? []) {
      expect(field.defaultValue).toBeUndefined();
      expect(field.options).toBeUndefined();
    }
    expect(JSON.stringify(restored)).not.toContain('MUST-NOT-SURVIVE');
    expect(JSON.stringify(restored)).not.toContain('LEGACY-PLAINTEXT');
  });

  it('migrates legacy provider metadata into the guest scope once', async () => {
    const store = new MemoryStore();
    const legacy = record('provider-a', 100);
    await store.set('moviestv.addons', [legacy]);
    const repository = new AsyncStorageAddonRepository(
      store,
      addonStorageKeyForUser(null),
      addonFallbackStorageKeysForUser(null),
    );

    await expect(repository.list()).resolves.toEqual([legacy]);
    expect(await store.get('moviestv.addons')).toBeNull();
    expect(await store.get(addonStorageKeyForUser(null))).toEqual([legacy]);
  });

  it('promotes guest provider metadata to the next account and clears guest scope', async () => {
    const store = new MemoryStore();
    const guestRecord = record('provider-a', 100);
    await store.set(addonStorageKeyForUser(null), [guestRecord]);

    const accountA = new AsyncStorageAddonRepository(
      store,
      addonStorageKeyForUser('a'),
      addonFallbackStorageKeysForUser('a'),
    );
    await expect(accountA.list()).resolves.toEqual([guestRecord]);
    expect(await store.get(addonStorageKeyForUser(null))).toBeNull();

    const accountB = new AsyncStorageAddonRepository(
      store,
      addonStorageKeyForUser('b'),
      addonFallbackStorageKeysForUser('b'),
    );
    await expect(accountB.list()).resolves.toEqual([]);
  });


  it('persists pending provider uploads across repository recreation', async () => {
    const store = new MemoryStore();
    const first = new AsyncStorageAddonRepository(
      store,
      addonStorageKeyForUser('a'),
      [],
    );

    await first.save(record('provider-a', 100));
    await first.markPendingUpsert('provider-a');

    const recreated = new AsyncStorageAddonRepository(
      store,
      addonStorageKeyForUser('a'),
      [],
    );

    expect(await recreated.pendingUpsertIds()).toEqual(['provider-a']);
    await recreated.clearPendingUpsert('provider-a');
    expect(await recreated.pendingUpsertIds()).toEqual([]);
  });

  it('persists pending provider removals across repository recreation', async () => {
    const store = new MemoryStore();
    const first = new AsyncStorageAddonRepository(
      store,
      addonStorageKeyForUser('a'),
      [],
    );

    await first.markPendingRemoval(
      'provider-a',
      '2026-09-20T14:00:00.000Z',
    );

    const recreated = new AsyncStorageAddonRepository(
      store,
      addonStorageKeyForUser('a'),
      [],
    );

    expect(await recreated.pendingRemovalIds()).toEqual(['provider-a']);
    expect(await recreated.pendingRemovals()).toEqual([{
      addonId: 'provider-a',
      removedAt: '2026-09-20T14:00:00.000Z',
    }]);
    await recreated.clearPendingRemoval('provider-a');
    expect(await recreated.pendingRemovalIds()).toEqual([]);
  });

  it('migrates legacy id-only pending removals conservatively', async () => {
    const store = new MemoryStore();
    const storageKey = addonStorageKeyForUser('a');
    await store.set(`${storageKey}:sync-outbox`, {
      upsertIds: [],
      removalIds: ['provider-a'],
    });

    const repository = new AsyncStorageAddonRepository(
      store,
      storageKey,
      [],
    );

    expect(await repository.pendingRemovals()).toEqual([{
      addonId: 'provider-a',
      removedAt: '1970-01-01T00:00:00.000Z',
    }]);
  });

  it('marks migrated guest providers for cloud upload after sign-in', async () => {
    const store = new MemoryStore();
    const guestRecord = record('provider-a', 100);
    await store.set(addonStorageKeyForUser(null), [guestRecord]);

    const account = new AsyncStorageAddonRepository(
      store,
      addonStorageKeyForUser('a'),
      addonFallbackStorageKeysForUser('a'),
    );

    await expect(account.list()).resolves.toEqual([guestRecord]);
    expect(await account.pendingUpsertIds()).toEqual(['provider-a']);
  });

});


test('drops corrupted persisted providers without crashing repository startup', async () => {
  const store = new MemoryStore();
  const valid = record('provider-a', 100);
  await store.set('moviestv.addons', [
    null,
    { installed: null },
    {
      installed: {
        addonId: 'broken',
        sourceType: 'stremio-manifest',
        enabled: true,
        priority: 'high',
      },
      safeConfig: {},
    },
    valid,
  ] as any);

  const repository = new AsyncStorageAddonRepository(store);

  await expect(repository.list()).resolves.toEqual([valid]);
  expect(await store.get('moviestv.addons')).toEqual([valid]);
});

test('scrubs plaintext sensitive config and unsafe manifest URLs on load', async () => {
  const store = new MemoryStore();
  const unsafe = record('provider-a', 100);
  unsafe.installed.manifestUrl =
    'https://provider.example/token=LOCAL-SECRET/manifest.json';
  unsafe.safeConfig = {
    region: 'fr',
    accessToken: 'LOCAL-SECRET',
    password: 'LOCAL-PASSWORD',
  };

  await store.set('moviestv.addons', [unsafe]);
  const repository = new AsyncStorageAddonRepository(store);

  const [loaded] = await repository.list();

  expect(loaded?.safeConfig).toEqual({ region: 'fr' });
  expect(loaded?.installed.manifestUrl).toBeUndefined();
  expect(JSON.stringify(await store.get('moviestv.addons')))
    .not.toContain('LOCAL-SECRET');
  expect(JSON.stringify(await store.get('moviestv.addons')))
    .not.toContain('LOCAL-PASSWORD');
});

test('keeps only the newest duplicate persisted provider record', async () => {
  const store = new MemoryStore();
  const older = record('provider-a', 900);
  const newer = {
    ...record('provider-a', 100),
    installed: {
      ...record('provider-a', 100).installed,
      updatedAt: '2026-09-15T12:30:00.000Z',
    },
  };

  await store.set('moviestv.addons', [older, newer]);
  const repository = new AsyncStorageAddonRepository(store);

  const result = await repository.list();

  expect(result).toHaveLength(1);
  expect(result[0]?.installed.updatedAt)
    .toBe('2026-09-15T12:30:00.000Z');
  expect(result[0]?.installed.priority).toBe(100);
});


test('scrubs sensitive provider metadata before save writes AsyncStorage', async () => {
  const store = new MemoryStore();
  const storageKey = addonStorageKeyForUser(null);
  const repository = new AsyncStorageAddonRepository(
    store,
    storageKey,
    [],
  );
  const unsafe = record('provider-a', 100);
  unsafe.installed.manifestUrl =
    'https://provider.example/0123456789abcdef0123456789abcdef/manifest.json';
  unsafe.safeConfig = {
    region: 'fr',
    accessToken: 'LOCAL-SECRET',
  };

  await repository.save(unsafe);

  const persisted = await store.get(storageKey);
  expect(JSON.stringify(persisted)).not.toContain('LOCAL-SECRET');
  expect(JSON.stringify(persisted))
    .not.toContain('0123456789abcdef0123456789abcdef');
  await expect(repository.list()).resolves.toEqual([
    expect.objectContaining({
      safeConfig: { region: 'fr' },
      installed: expect.not.objectContaining({
        manifestUrl: expect.any(String),
      }),
    }),
  ]);
});


test('self-heals legacy descriptors with mislabeled secret defaults', async () => {
  const store = new MemoryStore();
  const legacy = record('provider-a', 100);
  legacy.descriptor = {
    id: 'provider-a',
    name: 'Provider A',
    version: '1.0.0',
    sourceType: 'stremio-manifest',
    capabilities: ['stream'],
    requiresConfiguration: true,
    configurable: true,
    configurationFields: [{
      key: 'accessToken',
      label: 'Access token',
      type: 'text',
      required: true,
      secret: false,
      defaultValue: 'LOCAL-SECRET',
    }],
    supportedMediaKinds: ['movie'],
    manifestUrl: 'https://example.com/provider-a/manifest.json',
    stream: {
      types: ['movie'],
      idPrefixes: ['tt'],
    },
  };

  await store.set('moviestv.addons', [legacy]);
  const repository = new AsyncStorageAddonRepository(store);

  const [loaded] = await repository.list();

  expect(loaded?.descriptor?.configurationFields).toEqual([
    expect.objectContaining({
      key: 'accessToken',
      type: 'secret',
      secret: true,
      required: true,
    }),
  ]);
  expect(loaded?.descriptor?.configurationFields[0])
    .not.toHaveProperty('defaultValue');
  expect(JSON.stringify(await store.get('moviestv.addons')))
    .not.toContain('LOCAL-SECRET');
});


test('drops legacy descriptors with oversized config defaults', async () => {
  const store = new MemoryStore();
  const legacy = record('provider-a', 100);
  legacy.descriptor = {
    id: 'provider-a',
    name: 'Provider A',
    version: '1.0.0',
    sourceType: 'stremio-manifest',
    capabilities: ['stream'],
    requiresConfiguration: false,
    configurable: true,
    configurationFields: [{
      key: 'region',
      label: 'Region',
      type: 'text',
      required: false,
      secret: false,
      defaultValue: 'x'.repeat(2_049),
    }],
    supportedMediaKinds: ['movie'],
    manifestUrl: 'https://example.com/provider-a/manifest.json',
    stream: {
      types: ['movie'],
      idPrefixes: ['tt'],
    },
  };

  await store.set('moviestv.addons', [legacy]);
  const repository = new AsyncStorageAddonRepository(store);

  const [loaded] = await repository.list();

  expect(loaded?.descriptor).toBeUndefined();
  expect(JSON.stringify(await store.get('moviestv.addons')))
    .not.toContain('x'.repeat(2_049));
});


test('drops persisted Live TV descriptors with malformed required extras', async () => {
  const store = new MemoryStore();
  const legacy = record('provider-a', 100);
  legacy.descriptor = {
    id: 'provider-a',
    name: 'Provider A',
    version: '1.0.0',
    sourceType: 'stremio-manifest',
    capabilities: ['live-tv'],
    requiresConfiguration: false,
    configurable: false,
    configurationFields: [],
    supportedMediaKinds: [],
    manifestUrl: 'https://example.com/provider-a/manifest.json',
    liveTv: {
      catalogs: [{
        type: 'tv',
        id: 'search',
        name: 'Search',
        requiredExtras: 'search' as any,
      }],
      streamTypes: ['tv'],
    },
  } as any;

  await store.set('moviestv.addons', [legacy]);
  const repository = new AsyncStorageAddonRepository(store);

  const [loaded] = await repository.list();

  expect(loaded?.descriptor).toBeUndefined();
});

import type { AddonDescriptor, AddonStateRecord, SafeAddonSyncRecord } from '@moviestv/addons';
import { AddonStateCoordinator } from '../AddonStateCoordinator';

const descriptor: AddonDescriptor = {
  id: 'org.example.one',
  name: 'Example',
  version: '1.0.0',
  sourceType: 'stremio-manifest',
  capabilities: ['stream'],
  requiresConfiguration: false,
  configurationFields: [
    {
      key: 'region',
      label: 'Region',
      type: 'text',
      required: false,
      secret: false,
    },
  ],
  supportedMediaKinds: ['movie'],
  manifestUrl: 'https://example.com/manifest.json',
};

function record(updatedAt: string, overrides: Partial<AddonStateRecord['installed']> = {}): AddonStateRecord {
  return {
    installed: {
      addonId: 'org.example.one',
      manifestUrl: 'https://example.com/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: false,
      priority: 10,
      installedAt: '2026-09-15T11:00:00.000Z',
      updatedAt,
      setupIncomplete: false,
      ...overrides,
    },
    safeConfig: { region: 'fr' },
    descriptor,
  };
}

function repository(
  initial: AddonStateRecord[],
  initialPendingUpserts: string[] = [],
  initialPendingRemovals: Array<
    string | { addonId: string; removedAt: string }
  > = [],
) {
  let records = [...initial];
  const pendingUpserts = new Set(initialPendingUpserts);
  const pendingRemovals = new Map(
    initialPendingRemovals.map((value) => (
      typeof value === 'string'
        ? [
          value,
          {
            addonId: value,
            removedAt: '1970-01-01T00:00:00.000Z',
          },
        ] as const
        : [value.addonId, value] as const
    )),
  );

  return {
    async list() { return [...records]; },
    async save(next: AddonStateRecord) {
      records = records.filter(
        (item) => item.installed.addonId !== next.installed.addonId,
      );
      records.push(next);
    },
    async remove(addonId: string) {
      records = records.filter(
        (item) => item.installed.addonId !== addonId,
      );
    },
    async pendingUpsertIds() {
      return [...pendingUpserts];
    },
    async pendingRemovalIds() {
      return [...pendingRemovals.keys()];
    },
    async pendingRemovals() {
      return [...pendingRemovals.values()];
    },
    async markPendingUpsert(addonId: string) {
      pendingRemovals.delete(addonId);
      pendingUpserts.add(addonId);
    },
    async clearPendingUpsert(addonId: string) {
      pendingUpserts.delete(addonId);
    },
    async markPendingRemoval(
      addonId: string,
      removedAt = '2026-09-20T14:00:00.000Z',
    ) {
      pendingUpserts.delete(addonId);
      pendingRemovals.set(addonId, {
        addonId,
        removedAt,
      });
    },
    async clearPendingRemoval(addonId: string) {
      pendingRemovals.delete(addonId);
    },
  };
}

function secrets(values: Record<string, string> = {}) {
  return {
    async get(providerId: string, fieldKey: string) {
      return values[`${providerId}:${fieldKey}`] ?? null;
    },
  };
}

describe('AddonStateCoordinator', () => {
  it('uses local provider state without touching cloud state when no user is signed in', async () => {
    const local = record('2026-09-15T11:10:00.000Z');
    const repo = repository([local]);
    const cloud = { list: jest.fn(), upsert: jest.fn(), remove: jest.fn() };
    const coordinator = new AddonStateCoordinator(repo, secrets(), cloud);

    await expect(coordinator.load(null)).resolves.toEqual({
      records: [local],
      syncStatus: 'local',
      error: null,
    });
    expect(cloud.list).not.toHaveBeenCalled();
  });

  it('reconciles newer safe cloud metadata and persists the reconciled record locally', async () => {
    const local = record('2026-09-15T11:10:00.000Z');
    const repo = repository([local]);
    const remote: SafeAddonSyncRecord = {
      addonId: 'org.example.one',
      manifestUrl: 'https://example.com/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 50,
      safeConfig: { region: 'al' },
      setupIncomplete: false,
      updatedAt: '2026-09-15T11:20:00.000Z',
    };
    const cloud = {
      list: jest.fn(async () => [remote]),
      upsert: jest.fn(),
      remove: jest.fn(),
    };
    const coordinator = new AddonStateCoordinator(repo, secrets(), cloud);

    const result = await coordinator.load('user-1');

    expect(result.syncStatus).toBe('synced');
    expect(result.error).toBeNull();
    expect(result.records[0]).toEqual(expect.objectContaining({
      descriptor,
      safeConfig: { region: 'al' },
      installed: expect.objectContaining({ enabled: true, priority: 50 }),
    }));
    await expect(repo.list()).resolves.toEqual(result.records);
  });

  it('keeps a required-secret provider disabled when this device has no local secret', async () => {
    const secretDescriptor: AddonDescriptor = {
      ...descriptor,
      requiresConfiguration: true,
      configurationFields: [
        { key: 'token', label: 'Token', type: 'secret', required: true, secret: true },
      ],
    };
    const local = { ...record('2026-09-15T11:10:00.000Z'), descriptor: secretDescriptor };
    const repo = repository([local]);
    const remote: SafeAddonSyncRecord = {
      addonId: 'org.example.one',
      manifestUrl: 'https://example.com/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 50,
      safeConfig: {},
      setupIncomplete: false,
      updatedAt: '2026-09-15T11:20:00.000Z',
    };
    const coordinator = new AddonStateCoordinator(repo, secrets(), {
      list: async () => [remote], upsert: jest.fn(), remove: jest.fn(),
    });

    const result = await coordinator.load('user-1');

    expect(result.records[0]?.installed).toEqual(expect.objectContaining({
      enabled: false,
      setupIncomplete: true,
    }));
  });

  it('falls back to local provider state when cloud synchronization fails', async () => {
    const local = record('2026-09-15T11:10:00.000Z');
    const repo = repository([local]);
    const coordinator = new AddonStateCoordinator(repo, secrets(), {
      list: async () => { throw new Error('network unavailable'); },
      upsert: jest.fn(),
      remove: jest.fn(),
    });

    await expect(coordinator.load('user-1')).resolves.toEqual({
      records: [local],
      syncStatus: 'error',
      error: 'network unavailable',
    });
  });

  it('redacts sensitive cloud synchronization errors from snapshots', async () => {
    const local = record('2026-09-15T11:10:00.000Z');
    const repo = repository([local]);
    const coordinator = new AddonStateCoordinator(repo, secrets(), {
      list: async () => {
        throw new Error(
          'Failed https://sync.example/providers?token=LOCAL-SECRET',
        );
      },
      upsert: jest.fn(),
      remove: jest.fn(),
    });

    const result = await coordinator.load('user-1');

    expect(result.records).toEqual([local]);
    expect(result.syncStatus).toBe('error');
    expect(result.error).toBe('Could not synchronize providers.');
    expect(result.error).not.toContain('SECRET');
  });

  it('pushes only the safe synchronization contract to cloud storage', async () => {
    const local = record('2026-09-15T11:10:00.000Z');
    const upsert = jest.fn(async (_userId: string, _record: SafeAddonSyncRecord) => undefined);
    const coordinator = new AddonStateCoordinator(repository([local]), secrets(), {
      list: jest.fn(), upsert, remove: jest.fn(),
    });

    await coordinator.push('user-1', local);

    expect(upsert).toHaveBeenCalledWith('user-1', {
      addonId: 'org.example.one',
      manifestUrl: 'https://example.com/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: false,
      priority: 10,
      safeConfig: { region: 'fr' },
      setupIncomplete: false,
      updatedAt: '2026-09-15T11:10:00.000Z',
      identity: {
        name: 'Example',
        capabilities: ['stream'],
        supportedMediaKinds: ['movie'],
        configurable: false,
      },
    });
    expect(JSON.stringify(upsert.mock.calls[0]?.[1])).not.toContain('descriptor');
  });

  it('uploads a local-only provider during signed-in load', async () => {
    const local = record('2026-09-15T11:10:00.000Z');
    const upsert = jest.fn(async () => undefined);
    const coordinator = new AddonStateCoordinator(
      repository([local], ['org.example.one']),
      secrets(),
      {
        list: async () => [],
        upsert,
        remove: jest.fn(),
      },
    );

    const result = await coordinator.load('user-1');

    expect(result.syncStatus).toBe('synced');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        addonId: 'org.example.one',
        safeConfig: { region: 'fr' },
        updatedAt: '2026-09-15T11:10:00.000Z',
      }),
    );
    expect(JSON.stringify(upsert.mock.calls[0])).not.toMatch(
      /descriptor|secret/i,
    );
  });





  it('keeps promoted providers pending when cloud sync fails and retries later', async () => {
    const local = record('2026-09-15T11:10:00.000Z');
    const repo = repository([local], ['org.example.one']);
    let fail = true;
    const upsert = jest.fn(async () => {
      if (fail) throw new Error('temporary cloud failure');
    });
    const coordinator = new AddonStateCoordinator(
      repo,
      secrets(),
      {
        list: async () => [],
        upsert,
        remove: jest.fn(),
      },
    );

    const first = await coordinator.load('user-1');
    expect(first.syncStatus).toBe('error');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(await repo.pendingUpsertIds()).toEqual(['org.example.one']);

    fail = false;
    const second = await coordinator.load('user-1');
    expect(second.syncStatus).toBe('synced');
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(await repo.pendingUpsertIds()).toEqual([]);
  });

  it('propagates a confirmed remote deletion without recreating the provider', async () => {
    const local = record('2026-09-15T11:10:00.000Z');
    const repo = repository([local]);
    const upsert = jest.fn(async () => undefined);
    const coordinator = new AddonStateCoordinator(
      repo,
      secrets(),
      {
        list: async () => [],
        upsert,
        remove: jest.fn(),
      },
    );

    const result = await coordinator.load('user-1');

    expect(result.records).toEqual([]);
    expect(result.syncStatus).toBe('synced');
    expect(await repo.list()).toEqual([]);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('restores a remotely deleted provider when local secret cleanup fails', async () => {
    const local = record('2026-09-15T11:10:00.000Z');
    const repo = repository([local]);
    const deleteProvider = jest.fn(async () => {
      throw new Error('secret cleanup failed');
    });
    const coordinator = new AddonStateCoordinator(
      repo,
      {
        async get() {
          return null;
        },
        deleteProvider,
      },
      {
        list: async () => [],
        upsert: jest.fn(),
        remove: jest.fn(),
      },
    );

    const result = await coordinator.load('user-1');

    expect(result.syncStatus).toBe('error');
    expect(result.error).toBe('secret cleanup failed');
    expect(deleteProvider).toHaveBeenCalled();
    expect(await repo.list()).toEqual([local]);
  });

  it('uploads newer local safe metadata when the cloud copy is older', async () => {
    const local = record('2026-09-15T11:20:00.000Z', {
      enabled: true,
      priority: 90,
    });
    const remote: SafeAddonSyncRecord = {
      addonId: 'org.example.one',
      manifestUrl: 'https://example.com/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: false,
      priority: 10,
      safeConfig: { region: 'al' },
      setupIncomplete: false,
      updatedAt: '2026-09-15T11:10:00.000Z',
    };
    const upsert = jest.fn(async () => undefined);
    const coordinator = new AddonStateCoordinator(
      repository([local]),
      secrets(),
      {
        list: async () => [remote],
        upsert,
        remove: jest.fn(),
      },
    );

    const result = await coordinator.load('user-1');

    expect(result.records[0]?.installed).toEqual(
      expect.objectContaining({
        enabled: true,
        priority: 90,
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        enabled: true,
        priority: 90,
        safeConfig: { region: 'fr' },
      }),
    );
  });



  it('does not re-upload local provider metadata when cloud timestamp ties', async () => {
    const tiedAt = '2026-09-22T10:00:00.000Z';
    const local = record(tiedAt, {
      enabled: false,
      priority: 10,
    });
    const remote: SafeAddonSyncRecord = {
      addonId: 'org.example.one',
      manifestUrl: 'https://example.com/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 90,
      safeConfig: { region: 'al' },
      setupIncomplete: false,
      updatedAt: tiedAt,
    };
    const upsert = jest.fn(async () => undefined);
    const coordinator = new AddonStateCoordinator(
      repository([local]),
      secrets(),
      {
        list: async () => [remote],
        upsert,
        remove: jest.fn(),
      },
    );

    const result = await coordinator.load('user-1');

    expect(upsert).not.toHaveBeenCalled();
    expect(result.records[0]).toEqual(expect.objectContaining({
      safeConfig: { region: 'al' },
      installed: expect.objectContaining({
        enabled: true,
        priority: 90,
        updatedAt: tiedAt,
      }),
    }));
  });

  it('clears a pending local upsert when a newer remote provider already won', async () => {
    const local = record('2026-09-20T13:55:00.000Z', {
      enabled: false,
      priority: 10,
    });
    const remote: SafeAddonSyncRecord = {
      addonId: 'org.example.one',
      manifestUrl: 'https://example.com/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 90,
      safeConfig: { region: 'al' },
      setupIncomplete: false,
      updatedAt: '2026-09-20T14:05:00.000Z',
    };
    const repo = repository(
      [local],
      ['org.example.one'],
    );
    const upsert = jest.fn(async () => undefined);
    const coordinator = new AddonStateCoordinator(
      repo,
      secrets(),
      {
        list: async () => [remote],
        upsert,
        remove: jest.fn(),
      },
    );

    const result = await coordinator.load('user-1');

    expect(result.records[0]?.installed).toEqual(
      expect.objectContaining({
        enabled: true,
        priority: 90,
        updatedAt: remote.updatedAt,
      }),
    );
    expect(upsert).not.toHaveBeenCalled();
    expect(await repo.pendingUpsertIds()).toEqual([]);
  });

  it('queues a failed direct provider push and retries it on the next load', async () => {
    const local = record('2026-09-15T11:10:00.000Z');
    const repo = repository([local]);
    let fail = true;
    const upsert = jest.fn(async () => {
      if (fail) throw new Error('offline');
    });
    const coordinator = new AddonStateCoordinator(
      repo,
      secrets(),
      {
        list: async () => [],
        upsert,
        remove: jest.fn(),
      },
    );

    await expect(coordinator.push('user-1', local))
      .rejects.toThrow('offline');
    expect(await repo.pendingUpsertIds())
      .toEqual(['org.example.one']);

    fail = false;
    const result = await coordinator.load('user-1');

    expect(result.syncStatus).toBe('synced');
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(await repo.pendingUpsertIds()).toEqual([]);
  });

  it('queues a failed provider removal and retries it before reconciliation', async () => {
    const addonId = 'org.example.one';
    const repo = repository([], [], [addonId]);
    let fail = true;
    const remove = jest.fn(async () => {
      if (fail) throw new Error('offline');
    });
    const remote: SafeAddonSyncRecord = {
      addonId,
      manifestUrl: 'https://example.com/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 10,
      safeConfig: { region: 'fr' },
      setupIncomplete: false,
      updatedAt: '2026-09-15T11:10:00.000Z',
    };
    const coordinator = new AddonStateCoordinator(
      repo,
      secrets(),
      {
        list: async () => [remote],
        upsert: jest.fn(),
        remove,
      },
    );

    const first = await coordinator.load('user-1');
    expect(first.syncStatus).toBe('error');
    expect(await repo.pendingRemovalIds()).toEqual([addonId]);

    fail = false;
    const second = await coordinator.load('user-1');

    expect(second).toEqual({
      records: [],
      syncStatus: 'synced',
      error: null,
    });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(await repo.pendingRemovalIds()).toEqual([]);
  });

  it('does not let an older offline removal delete a newer remote provider update', async () => {
    const addonId = 'org.example.one';
    const removedAt = '2026-09-20T14:00:00.000Z';
    const remote: SafeAddonSyncRecord = {
      addonId,
      manifestUrl: 'https://example.com/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 90,
      safeConfig: { region: 'al' },
      setupIncomplete: false,
      updatedAt: '2026-09-20T14:05:00.000Z',
    };
    const repo = repository([], [], [{
      addonId,
      removedAt,
    }]);
    const list = jest.fn(async () => [remote]);
    const remove = jest.fn(async () => false);
    const coordinator = new AddonStateCoordinator(
      repo,
      secrets(),
      {
        list,
        upsert: jest.fn(),
        remove,
      },
    );

    const result = await coordinator.load('user-1');

    expect(remove).toHaveBeenCalledWith(
      'user-1',
      addonId,
      removedAt,
    );
    expect(list).toHaveBeenCalledTimes(2);
    expect(await repo.pendingRemovalIds()).toEqual([]);
    expect(result.syncStatus).toBe('synced');
    expect(result.records).toEqual([
      expect.objectContaining({
        installed: expect.objectContaining({
          addonId,
          enabled: true,
          priority: 90,
          updatedAt: remote.updatedAt,
        }),
        safeConfig: { region: 'al' },
      }),
    ]);
  });

  it('does not overwrite remote-only provider state with this devices secret gate', async () => {
    const remote: SafeAddonSyncRecord = {
      addonId: 'org.example.remote',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 80,
      safeConfig: {},
      setupIncomplete: false,
      updatedAt: '2026-09-19T18:30:00.000Z',
      identity: {
        name: 'Remote Secret Provider',
        capabilities: ['stream'],
        supportedMediaKinds: ['movie'],
        configurable: true,
      },
    };
    const upsert = jest.fn(async () => undefined);
    const coordinator = new AddonStateCoordinator(
      repository([]),
      secrets(),
      {
        list: async () => [remote],
        upsert,
        remove: jest.fn(),
      },
    );

    const result = await coordinator.load('user-1');

    expect(result.records[0]?.installed).toEqual(
      expect.objectContaining({
        enabled: true,
        setupIncomplete: true,
      }),
    );
    expect(upsert).not.toHaveBeenCalled();

    const second = await coordinator.load('user-1');
    expect(second.records[0]?.installed).toEqual(
      expect.objectContaining({
        enabled: true,
        setupIncomplete: true,
      }),
    );
    expect(upsert).not.toHaveBeenCalled();
  });

});


it('does not cloud-sync manifest URLs for configurable providers', async () => {
  const configurableDescriptor: AddonDescriptor = {
    ...descriptor,
    requiresConfiguration: true,
    configurationFields: [
      { key: 'token', label: 'Token', type: 'secret', required: true, secret: true },
    ],
    manifestUrl: 'https://example.com/configured-secret-path/manifest.json',
  };
  const local: AddonStateRecord = {
    ...record('2026-09-15T11:10:00.000Z', {
      manifestUrl: 'https://example.com/configured-secret-path/manifest.json',
    }),
    descriptor: configurableDescriptor,
  };
  const upsert = jest.fn(async (_userId: string, _record: SafeAddonSyncRecord) => undefined);
  const coordinator = new AddonStateCoordinator(repository([local]), secrets({
    'org.example.one:token': 'LOCAL-ONLY',
  }), {
    list: jest.fn(),
    upsert,
    remove: jest.fn(),
  });

  await coordinator.push('user-1', local);

  const synced = upsert.mock.calls[0]?.[1];
  expect(synced?.manifestUrl).toBeUndefined();
  expect(JSON.stringify(synced)).not.toContain('configured-secret-path');
  expect(JSON.stringify(synced)).not.toContain('LOCAL-ONLY');
});


it('keeps a remote-only configurable provider visible as safe synced identity', async () => {
  const remote: SafeAddonSyncRecord = {
    addonId: 'org.example.remote',
    sourceType: 'stremio-manifest',
    enabled: true,
    priority: 80,
    safeConfig: {},
    setupIncomplete: false,
    updatedAt: '2026-09-19T18:30:00.000Z',
    identity: {
      name: 'Remote Movie Provider',
      capabilities: ['stream', 'subtitle'],
      supportedMediaKinds: ['movie', 'series'],
      configurable: true,
    },
  };
  const coordinator = new AddonStateCoordinator(repository([]), secrets(), {
    list: async () => [remote],
    upsert: jest.fn(),
    remove: jest.fn(),
  });

  const result = await coordinator.load('user-1');

  expect(result.records).toEqual([
    expect.objectContaining({
      descriptor: undefined,
      syncIdentity: remote.identity,
      installed: expect.objectContaining({
        addonId: remote.addonId,
        enabled: true,
        setupIncomplete: true,
      }),
    }),
  ]);
});


test('provider removal tombstone stays newer when the device clock moves backward', async () => {
  const previousUpdatedAt = '2026-09-22T12:00:00.000Z';
  const remove = jest.fn(async () => true);
  const coordinator = new AddonStateCoordinator(
    repository([record(previousUpdatedAt)]),
    secrets(),
    {
      list: async () => [],
      upsert: jest.fn(),
      remove,
    },
    () => '2026-09-22T11:00:00.000Z',
  );

  await coordinator.remove(
    'user-1',
    'org.example.one',
    previousUpdatedAt,
  );

  expect(remove).toHaveBeenCalledWith(
    'user-1',
    'org.example.one',
    '2026-09-22T12:00:00.001Z',
  );
});

import type { AddonStateRecord } from '@moviestv/addons';
import { AddonInstallationService } from '../AddonInstallationService';
import { RUNTIME_MANIFEST_URL_SECRET_KEY } from '../SecureAddonSecretStore';

class MemoryRepository {
  records: AddonStateRecord[];

  constructor(record: AddonStateRecord) {
    this.records = [record];
  }

  async list(): Promise<AddonStateRecord[]> {
    return [...this.records];
  }

  async save(record: AddonStateRecord): Promise<void> {
    this.records = this.records.map((candidate) =>
      candidate.installed.addonId === record.installed.addonId ? record : candidate,
    );
  }

  async remove(): Promise<void> {}
  async reorder(): Promise<void> {}
}

const secrets = {
  get: jest.fn(async () => null),
  set: jest.fn(async () => undefined),
  delete: jest.fn(async () => undefined),
  deleteProvider: jest.fn(async () => undefined),
};

function remoteOnlyRecord(): AddonStateRecord {
  return {
    installed: {
      addonId: 'org.example.synced',
      manifestUrl: 'https://example.com/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: false,
      priority: 700,
      installedAt: '2026-09-15T12:00:00.000Z',
      updatedAt: '2026-09-15T12:05:00.000Z',
      setupIncomplete: true,
    },
    safeConfig: { region: 'fr' },
    descriptor: undefined,
  };
}

const manifest = {
  id: 'org.example.synced',
  name: 'Synced Provider',
  version: '1.0.0',
  resources: [{ name: 'stream', types: ['movie'] }],
  types: ['movie'],
  behaviorHints: { configurationRequired: true },
  config: [{ key: 'token', type: 'password', title: 'Token', required: true }],
};

test('hydrates a synchronized provider descriptor without overwriting synced safe state', async () => {
  const original = remoteOnlyRecord();
  const repository = new MemoryRepository(original);
  const loader = { load: jest.fn(async () => manifest) };
  const service = new AddonInstallationService(repository, secrets, loader);

  const hydrated = await service.hydrate(original);

  expect(loader.load).toHaveBeenCalledWith('https://example.com/manifest.json', 'manual');
  expect(hydrated.descriptor?.name).toBe('Synced Provider');
  expect(hydrated.safeConfig).toEqual({ region: 'fr' });
  expect(hydrated.installed).toEqual(original.installed);
  await expect(repository.list()).resolves.toEqual([hydrated]);
});

test('keeps a legacy public provider enabled after successful hydration', async () => {
  const original: AddonStateRecord = {
    ...remoteOnlyRecord(),
    installed: {
      ...remoteOnlyRecord().installed,
      enabled: true,
      setupIncomplete: true,
    },
  };
  const repository = new MemoryRepository(original);
  const loader = {
    load: jest.fn(async () => ({
      id: 'org.example.synced',
      name: 'Synced Provider',
      version: '1.0.0',
      resources: [{ name: 'stream', types: ['movie'] }],
      types: ['movie'],
    })),
  };
  const service = new AddonInstallationService(repository, secrets, loader);

  const hydrated = await service.hydrate(original);

  expect(hydrated.installed).toEqual(expect.objectContaining({
    enabled: true,
    setupIncomplete: false,
  }));
});

test('disables a legacy configurable provider until local setup is complete', async () => {
  const original: AddonStateRecord = {
    ...remoteOnlyRecord(),
    installed: {
      ...remoteOnlyRecord().installed,
      enabled: true,
      setupIncomplete: true,
    },
  };
  const repository = new MemoryRepository(original);
  const loader = { load: jest.fn(async () => manifest) };
  const service = new AddonInstallationService(repository, secrets, loader);

  const hydrated = await service.hydrate(original);

  expect(hydrated.installed).toEqual(expect.objectContaining({
    enabled: false,
    setupIncomplete: true,
  }));
});

test('completes a revalidated public provider without changing its synced enabled preference', async () => {
  const original: AddonStateRecord = {
    ...remoteOnlyRecord(),
    installed: {
      ...remoteOnlyRecord().installed,
      enabled: true,
      setupIncomplete: true,
    },
    syncIdentity: {
      name: 'Synced Provider',
      capabilities: ['stream'],
      supportedMediaKinds: ['movie'],
      configurable: false,
    },
  };
  const repository = new MemoryRepository(original);
  const loader = {
    load: jest.fn(async () => ({
      id: 'org.example.synced',
      name: 'Synced Provider',
      version: '1.0.0',
      resources: [{ name: 'stream', types: ['movie'] }],
      types: ['movie'],
    })),
  };
  const service = new AddonInstallationService(repository, secrets, loader);

  const hydrated = await service.hydrate(original);

  expect(hydrated.installed.enabled).toBe(true);
  expect(hydrated.installed.setupIncomplete).toBe(false);
  expect(hydrated.descriptor?.configurable).toBe(false);
  await expect(repository.list()).resolves.toEqual([hydrated]);
});

test('rejects hydration when the fetched manifest identity does not match synced metadata', async () => {
  const original = remoteOnlyRecord();
  const repository = new MemoryRepository(original);
  const loader = { load: jest.fn(async () => ({ ...manifest, id: 'org.example.other' })) };
  const service = new AddonInstallationService(repository, secrets, loader);

  await expect(service.hydrate(original)).rejects.toThrow('identity');
  await expect(repository.list()).resolves.toEqual([original]);
});


test('disables a cached configurable provider when its local runtime endpoint is missing', async () => {
  const cached: AddonStateRecord = {
    installed: {
      addonId: 'org.example.synced',
      manifestUrl: 'https://provider.example/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 700,
      installedAt: '2026-09-15T12:00:00.000Z',
      updatedAt: '2026-09-15T12:05:00.000Z',
      setupIncomplete: false,
    },
    safeConfig: {},
    descriptor: {
      id: 'org.example.synced',
      name: 'Synced Provider',
      version: '1.0.0',
      sourceType: 'stremio-manifest',
      capabilities: ['stream'],
      requiresConfiguration: false,
      configurable: true,
      configurationFields: [],
      supportedMediaKinds: ['movie'],
      stream: { types: ['movie'], idPrefixes: ['tt'] },
    },
  };
  const repository = new MemoryRepository(cached);
  const secureStore = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deleteProvider: jest.fn(async () => undefined),
  };
  const loader = { load: jest.fn() };
  const service = new AddonInstallationService(repository, secureStore, loader);

  const hydrated = await service.hydrate(cached);

  expect(hydrated.installed).toEqual(expect.objectContaining({
    enabled: false,
    setupIncomplete: true,
  }));
  expect(hydrated.descriptor?.manifestUrl).toBeUndefined();
  expect(loader.load).not.toHaveBeenCalled();
});

test('treats a secure-store read failure as missing local provider configuration', async () => {
  const cached: AddonStateRecord = {
    ...remoteOnlyRecord(),
    installed: {
      ...remoteOnlyRecord().installed,
      enabled: true,
      setupIncomplete: false,
    },
    descriptor: {
      id: 'org.example.synced',
      name: 'Synced Provider',
      version: '1.0.0',
      sourceType: 'stremio-manifest',
      capabilities: ['stream'],
      requiresConfiguration: false,
      configurable: true,
      configurationFields: [],
      supportedMediaKinds: ['movie'],
      stream: { types: ['movie'], idPrefixes: ['tt'] },
    },
  };
  const repository = new MemoryRepository(cached);
  const secureStore = {
    get: jest.fn(async () => {
      throw new Error('secure store unavailable');
    }),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deleteProvider: jest.fn(async () => undefined),
  };
  const service = new AddonInstallationService(
    repository,
    secureStore,
    { load: jest.fn() },
  );

  const hydrated = await service.hydrate(cached);

  expect(hydrated.installed).toEqual(expect.objectContaining({
    enabled: false,
    setupIncomplete: true,
  }));
  await expect(repository.list()).resolves.toEqual([hydrated]);
});

test('reattaches a secure runtime manifest URL to a cached configurable descriptor after restart', async () => {
  const cached: AddonStateRecord = {
    installed: {
      addonId: 'org.example.synced',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 700,
      installedAt: '2026-09-15T12:00:00.000Z',
      updatedAt: '2026-09-15T12:05:00.000Z',
      setupIncomplete: false,
    },
    safeConfig: {},
    descriptor: {
      id: 'org.example.synced',
      name: 'Synced Provider',
      version: '1.0.0',
      sourceType: 'stremio-manifest',
      capabilities: ['stream'],
      requiresConfiguration: false,
      configurable: true,
      configurationFields: [],
      supportedMediaKinds: ['movie'],
      stream: { types: ['movie'], idPrefixes: ['tt'] },
    },
  };
  const repository = new MemoryRepository(cached);
  const runtimeUrl = 'https://provider.example/debrid=LOCAL/manifest.json';
  const secureStore = {
    get: jest.fn(async (_providerId: string, fieldKey: string) =>
      fieldKey === RUNTIME_MANIFEST_URL_SECRET_KEY ? runtimeUrl : null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deleteProvider: jest.fn(async () => undefined),
  };
  const loader = { load: jest.fn() };
  const service = new AddonInstallationService(repository, secureStore, loader);

  const hydrated = await service.hydrate(cached);

  expect(hydrated.descriptor?.manifestUrl).toBe(runtimeUrl);
  expect(loader.load).not.toHaveBeenCalled();
  expect(JSON.stringify(await repository.list())).not.toContain('debrid=LOCAL');
});


test('disables a cached configurable provider when its local runtime endpoint is missing', async () => {
  const cached: AddonStateRecord = {
    installed: {
      addonId: 'org.example.synced',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 700,
      installedAt: '2026-09-15T12:00:00.000Z',
      updatedAt: '2026-09-15T12:05:00.000Z',
      setupIncomplete: false,
    },
    safeConfig: {},
    descriptor: {
      id: 'org.example.synced',
      name: 'Synced Provider',
      version: '1.0.0',
      sourceType: 'stremio-manifest',
      capabilities: ['stream'],
      requiresConfiguration: false,
      configurable: true,
      configurationFields: [],
      supportedMediaKinds: ['movie'],
      stream: { types: ['movie'], idPrefixes: ['tt'] },
    },
  };
  const repository = new MemoryRepository(cached);
  const secureStore = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deleteProvider: jest.fn(async () => undefined),
  };
  const loader = { load: jest.fn() };
  const service = new AddonInstallationService(repository, secureStore, loader);

  const hydrated = await service.hydrate(cached);

  expect(hydrated.installed).toEqual(expect.objectContaining({
    enabled: false,
    setupIncomplete: true,
  }));
  expect(hydrated.descriptor?.manifestUrl).toBeUndefined();
  expect(loader.load).not.toHaveBeenCalled();
  await expect(repository.list()).resolves.toEqual([hydrated]);
});

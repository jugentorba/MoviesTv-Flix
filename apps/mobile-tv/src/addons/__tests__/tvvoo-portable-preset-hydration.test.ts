import { AddonInstallationService } from '../AddonInstallationService';

const manifestUrl =
  'https://tvvoo.hayd.uk/cfg-fr-al-bk/manifest.json';

const manifest = {
  id: 'org.stremio.vavoo.clean',
  version: '5.1.0',
  name: 'TvVoo | ElfHosted',
  types: ['tv'],
  idPrefixes: ['vavoo', 'vavoo_'],
  catalogs: [
    { type: 'tv', id: 'vavoo_tv_fr', name: 'France' },
    { type: 'tv', id: 'vavoo_tv_al', name: 'Albania' },
    { type: 'tv', id: 'vavoo_tv_bk', name: 'Balkans' },
  ],
  resources: ['catalog', 'meta', 'stream'],
  behaviorHints: {
    configurable: true,
    configurationRequired: false,
    epgProvider: true,
  },
};

test('hydrates a synced TvVoo country preset without requiring a local secret URL', async () => {
  const record = {
    installed: {
      addonId: 'org.stremio.vavoo.clean',
      manifestUrl,
      sourceType: 'stremio-manifest' as const,
      enabled: true,
      priority: 100,
      installedAt: '2026-09-23T17:00:00.000Z',
      updatedAt: '2026-09-23T17:00:00.000Z',
      setupIncomplete: false,
    },
    safeConfig: {},
    descriptor: undefined,
    syncIdentity: {
      name: 'TvVoo | ElfHosted',
      capabilities: ['live-tv' as const],
      supportedMediaKinds: [],
      configurable: true,
    },
  };

  const repository = {
    list: jest.fn(async () => [record]),
    save: jest.fn(async () => undefined),
    remove: jest.fn(async () => undefined),
    reorder: jest.fn(async () => undefined),
  };
  const secrets = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deleteProvider: jest.fn(async () => undefined),
  };
  const loader = {
    load: jest.fn(async (url: string) => {
      expect(url).toBe(manifestUrl);
      return manifest;
    }),
  };

  const service = new AddonInstallationService(
    repository,
    secrets,
    loader,
  );

  const hydrated = await service.hydrate(record);

  expect(loader.load).toHaveBeenCalledTimes(1);
  expect(hydrated.installed.enabled).toBe(true);
  expect(hydrated.installed.setupIncomplete).toBe(false);
  expect(hydrated.descriptor).toEqual(expect.objectContaining({
    id: 'org.stremio.vavoo.clean',
    manifestUrl,
    configurable: true,
    capabilities: expect.arrayContaining(['live-tv']),
  }));
});

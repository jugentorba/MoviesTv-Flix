import type { AddonStateRecord } from '@moviestv/addons';
import { AddonInstallationService } from '../AddonInstallationService';
import { RUNTIME_MANIFEST_URL_SECRET_KEY } from '../SecureAddonSecretStore';

const manifest = {
  id: 'com.nuvio.tmdb.catalogs',
  version: '1.2.0',
  name: 'Nuvio Catalog Addon',
  resources: [
    'catalog',
    {
      name: 'meta',
      types: ['movie', 'series'],
      idPrefixes: ['tt', 'tmdb:'],
    },
  ],
  types: ['movie', 'series'],
  catalogs: [
    {
      type: 'movie',
      id: 'trending-movies',
      name: 'Trending Movies',
      extra: [{ name: 'skip', isRequired: false }],
    },
  ],
  config: [
    {
      key: 'language',
      type: 'text',
      title: 'Language locale',
      default: 'en-US',
      required: true,
    },
    {
      key: 'region',
      type: 'text',
      title: 'Region',
      default: 'US',
      required: true,
    },
  ],
  behaviorHints: {
    configurable: true,
    configurationRequired: false,
  },
};

class MemoryRepository {
  records: AddonStateRecord[] = [];

  async list() {
    return [...this.records];
  }

  async save(record: AddonStateRecord) {
    this.records = [
      ...this.records.filter(
        (candidate) =>
          candidate.installed.addonId !== record.installed.addonId,
      ),
      record,
    ];
  }

  async remove(addonId: string) {
    this.records = this.records.filter(
      (record) => record.installed.addonId !== addonId,
    );
  }

  async reorder() {}
}

class MemorySecrets {
  values = new Map<string, string>();

  async get(providerId: string, fieldKey: string) {
    return this.values.get(`${providerId}:${fieldKey}`) ?? null;
  }

  async set(providerId: string, fieldKey: string, value: string) {
    this.values.set(`${providerId}:${fieldKey}`, value);
  }

  async delete(providerId: string, fieldKey: string) {
    this.values.delete(`${providerId}:${fieldKey}`);
  }

  async deleteProvider(providerId: string, fieldKeys: readonly string[]) {
    fieldKeys.forEach((fieldKey) => {
      this.values.delete(`${providerId}:${fieldKey}`);
    });
  }
}

describe('configured provider installation runtime', () => {
  test('applies explicit Nuvio language and region during the initial install', async () => {
    const repository = new MemoryRepository();
    const secrets = new MemorySecrets();
    const loadedUrls: string[] = [];
    const loader = {
      load: jest.fn(async (url: string) => {
        loadedUrls.push(url);
        return manifest;
      }),
    };
    const service = new AddonInstallationService(
      repository,
      secrets,
      loader,
      () => '2026-09-23T20:00:00.000Z',
    );

    const inspected = await service.inspectManifest(
      'https://catalog.nuvio.tv/manifest.json',
      'manual',
    );
    const installed = await service.install(inspected, {
      language: 'fr-FR',
      region: 'FR',
    });

    const configuredUrl =
      'https://catalog.nuvio.tv/%7B%22language%22%3A%22fr-FR%22%2C%22region%22%3A%22FR%22%7D/manifest.json';

    expect(loadedUrls).toEqual([
      'https://catalog.nuvio.tv/manifest.json',
      configuredUrl,
    ]);
    expect(installed.safeConfig).toEqual({
      language: 'fr-FR',
      region: 'FR',
    });
    expect(installed.descriptor?.manifestUrl).toBe(configuredUrl);
    expect(installed.installed).toEqual(expect.objectContaining({
      enabled: true,
      setupIncomplete: false,
      manifestUrl: 'https://catalog.nuvio.tv/manifest.json',
    }));
    expect(
      secrets.values.get(
        `com.nuvio.tmdb.catalogs:${RUNTIME_MANIFEST_URL_SECRET_KEY}`,
      ),
    ).toBe(configuredUrl);

    const [persisted] = await repository.list();
    expect(persisted?.safeConfig).toEqual({
      language: 'fr-FR',
      region: 'FR',
    });
    expect(persisted?.descriptor?.manifestUrl).toBeUndefined();
  });



  test('does not append standard JSON config to an opaque custom configured URL', async () => {
    const repository = new MemoryRepository();
    const secrets = new MemorySecrets();
    const customManifest = {
      ...manifest,
      id: 'org.example.custom-configured',
      name: 'Custom Configured Provider',
    };
    const customUrl =
      'https://provider.example/A1b2C3d4E5f6/manifest.json';
    const loadedUrls: string[] = [];
    const service = new AddonInstallationService(
      repository,
      secrets,
      {
        load: jest.fn(async (url: string) => {
          loadedUrls.push(url);
          return customManifest;
        }),
      },
    );

    const inspected = await service.inspectManifest(
      customUrl,
      'manual',
    );
    const installed = await service.install(inspected, {
      language: 'fr-FR',
      region: 'FR',
    });

    expect(loadedUrls).toEqual([customUrl]);
    expect(installed.descriptor?.manifestUrl).toBe(customUrl);
    expect(
      secrets.values.get(
        `org.example.custom-configured:${RUNTIME_MANIFEST_URL_SECRET_KEY}`,
      ),
    ).toBe(customUrl);
    expect(JSON.stringify(await repository.list()))
      .not.toContain('A1b2C3d4E5f6');
  });

  test('rolls back runtime and field secrets when configured installation fails', async () => {
    const repository = new MemoryRepository();
    const secrets = new MemorySecrets();
    const secretManifest = {
      ...manifest,
      id: 'org.example.secure-config',
      name: 'Secure Config Provider',
      config: [
        {
          key: 'token',
          type: 'password',
          title: 'Token',
          required: true,
        },
        {
          key: 'region',
          type: 'text',
          title: 'Region',
          default: 'US',
          required: true,
        },
      ],
    };
    const oldRuntime =
      'https://provider.example/old-runtime/manifest.json';
    await secrets.set(
      secretManifest.id,
      RUNTIME_MANIFEST_URL_SECRET_KEY,
      oldRuntime,
    );
    await secrets.set(secretManifest.id, 'token', 'OLD-TOKEN');

    let calls = 0;
    const service = new AddonInstallationService(
      repository,
      secrets,
      {
        load: jest.fn(async () => {
          calls += 1;
          if (calls === 1) return secretManifest;
          throw new Error('configured endpoint rejected');
        }),
      },
    );

    const inspected = await service.inspectManifest(
      'https://provider.example/manifest.json',
      'manual',
    );

    await expect(service.install(inspected, {
      token: 'NEW-TOKEN',
      region: 'FR',
    })).rejects.toThrow(
      'This provider uses a custom configuration page',
    );

    expect(
      secrets.values.get(
        `${secretManifest.id}:${RUNTIME_MANIFEST_URL_SECRET_KEY}`,
      ),
    ).toBe(oldRuntime);
    expect(
      secrets.values.get(`${secretManifest.id}:token`),
    ).toBe('OLD-TOKEN');
    await expect(repository.list()).resolves.toEqual([]);
  });

  test('applies manifest defaults during the initial install too', async () => {
    const repository = new MemoryRepository();
    const secrets = new MemorySecrets();
    const loadedUrls: string[] = [];
    const service = new AddonInstallationService(
      repository,
      secrets,
      {
        load: jest.fn(async (url: string) => {
          loadedUrls.push(url);
          return manifest;
        }),
      },
    );

    const inspected = await service.inspectManifest(
      'https://catalog.nuvio.tv/manifest.json',
      'manual',
    );
    const installed = await service.install(inspected, {});

    expect(loadedUrls[1]).toBe(
      'https://catalog.nuvio.tv/%7B%22language%22%3A%22en-US%22%2C%22region%22%3A%22US%22%7D/manifest.json',
    );
    expect(installed.safeConfig).toEqual({
      language: 'en-US',
      region: 'US',
    });
  });
});

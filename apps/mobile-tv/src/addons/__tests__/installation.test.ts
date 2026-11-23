import type { AddonStateRecord } from '@moviestv/addons';
import { AddonInstallationService } from '../AddonInstallationService';
import { RUNTIME_MANIFEST_URL_SECRET_KEY } from '../SecureAddonSecretStore';
import { ManifestLoader } from '../ManifestLoader';
import { StremioAddonAdapter } from '../StremioAddonAdapter';

function response(
  body: string,
  options: {
    status?: number;
    headers?: Record<string, string>;
    url?: string;
  } = {},
) {
  const headers = new Map(
    Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const status = options.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    ...(options.url ? { url: options.url } : {}),
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    text: async () => body,
  };
}

const manifest = {
  id: 'org.example.public-domain',
  name: 'Public Domain Example',
  version: '1.0.0',
  description: 'Authorized example provider.',
  resources: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }],
  types: ['movie', 'series'],
};

class MemoryRepository {
  records: AddonStateRecord[] = [];

  async list(): Promise<AddonStateRecord[]> {
    return [...this.records];
  }

  async save(record: AddonStateRecord): Promise<void> {
    this.records = this.records.filter(
      (candidate) => candidate.installed.addonId !== record.installed.addonId,
    );
    this.records.push(record);
    this.records.sort((left, right) => right.installed.priority - left.installed.priority);
  }

  async remove(addonId: string): Promise<void> {
    this.records = this.records.filter((record) => record.installed.addonId !== addonId);
  }

  async reorder(
    addonIds: readonly string[],
    updatedAt?: string,
  ): Promise<void> {
    const byId = new Map(
      this.records.map((record) => [
        record.installed.addonId,
        record,
      ]),
    );
    this.records = addonIds.flatMap((addonId, index) => {
      const record = byId.get(addonId);
      if (!record) return [];
      return [{
        ...record,
        installed: {
          ...record.installed,
          priority: (addonIds.length - index) * 100,
          ...(updatedAt ? { updatedAt } : {}),
        },
      }];
    });
  }
}

class MemorySecrets {
  readonly values = new Map<string, string>();

  async get(providerId: string, fieldKey: string): Promise<string | null> {
    return this.values.get(`${providerId}:${fieldKey}`) ?? null;
  }

  async set(providerId: string, fieldKey: string, value: string): Promise<void> {
    this.values.set(`${providerId}:${fieldKey}`, value);
  }

  async delete(providerId: string, fieldKey: string): Promise<void> {
    this.values.delete(`${providerId}:${fieldKey}`);
  }

  async deleteProvider(providerId: string, fieldKeys: readonly string[]): Promise<void> {
    fieldKeys.forEach((fieldKey) => this.values.delete(`${providerId}:${fieldKey}`));
  }
}

describe('ManifestLoader', () => {
  it('normalizes and validates the URL before fetching JSON', async () => {
    const fetcher = jest.fn(async () => response(JSON.stringify(manifest)));
    const loader = new ManifestLoader(fetcher, 50, 1024 * 1024);

    await expect(loader.load('https://example.com/addon', 'manual')).resolves.toEqual(manifest);
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.com/addon/manifest.json',
      expect.objectContaining({ method: 'GET', redirect: 'follow' }),
    );
    await expect(loader.load('file:///tmp/manifest.json', 'manual')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects HTTP errors, oversized responses and invalid JSON', async () => {
    const failing = new ManifestLoader(async () => response('{}', { status: 503 }), 50, 100);
    await expect(failing.load('https://example.com/manifest.json', 'manual')).rejects.toThrow('503');

    const headerTooLarge = new ManifestLoader(
      async () => response('{}', { headers: { 'content-length': '101' } }),
      50,
      100,
    );
    await expect(headerTooLarge.load('https://example.com/manifest.json', 'manual')).rejects.toThrow('large');

    const bodyTooLarge = new ManifestLoader(async () => response('x'.repeat(101)), 50, 100);
    await expect(bodyTooLarge.load('https://example.com/manifest.json', 'manual')).rejects.toThrow('large');

    const malformed = new ManifestLoader(async () => response('{bad-json'), 50, 100);
    await expect(malformed.load('https://example.com/manifest.json', 'manual')).rejects.toThrow('JSON');
  });

  it('rejects HTTPS provider redirects that downgrade transport security', async () => {
    const loader = new ManifestLoader(
      async () => response(
        JSON.stringify(manifest),
        { url: 'http://example.com/manifest.json' },
      ),
      50,
      1024 * 1024,
    );

    await expect(
      loader.load('https://example.com/manifest.json', 'manual'),
    ).rejects.toThrow('redirect is not secure');
  });

  it('times out a provider request without waiting forever', async () => {
    const loader = new ManifestLoader(async () => await new Promise(() => undefined), 5);
    await expect(loader.load('https://example.com/manifest.json', 'manual')).rejects.toThrow('timed out');
  });
});

describe('StremioAddonAdapter', () => {
  const descriptor = {
    id: 'org.example.public-domain',
    name: 'Public Domain Example',
    version: '1.0.0',
    sourceType: 'stremio-manifest' as const,
    capabilities: ['stream' as const],
    requiresConfiguration: false,
    configurationFields: [],
    supportedMediaKinds: ['movie' as const, 'series' as const],
    manifestUrl: 'https://example.com/addon/manifest.json',
    stream: { types: ['movie' as const, 'series' as const], idPrefixes: ['tt'] },
  };

  it('fetches only the protocol-generated movie stream path and normalizes the response', async () => {
    const fetcher = jest.fn(async () => response(JSON.stringify({
      streams: [{ name: '1080p English', url: 'https://cdn.example/movie.mp4' }],
    })));
    const adapter = new StremioAddonAdapter(descriptor, fetcher, 50);

    await expect(adapter.resolve({
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: { imdb: 'tt0137523' },
    })).resolves.toEqual([
      expect.objectContaining({
        url: 'https://cdn.example/movie.mp4',
        providerId: 'org.example.public-domain',
        language: 'en',
      }),
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.com/addon/stream/movie/tt0137523.json',
      expect.objectContaining({ method: 'GET', redirect: 'follow' }),
    );
  });

  it('preserves a standard configured manifest path on stream requests', async () => {
    const fetcher = jest.fn(async () => response(JSON.stringify({
      streams: [{ url: 'https://cdn.example/movie.mp4' }],
    })));
    const configuredPath =
      '%7B%22language%22%3A%22fr-FR%22%2C%22region%22%3A%22FR%22%7D';
    const adapter = new StremioAddonAdapter({
      ...descriptor,
      manifestUrl:
        `https://provider.example/${configuredPath}/manifest.json`,
    }, fetcher, 50);

    await adapter.resolve({
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: { imdb: 'tt0137523' },
    });

    expect(fetcher).toHaveBeenCalledWith(
      `https://provider.example/${configuredPath}/stream/movie/tt0137523.json`,
      expect.objectContaining({ method: 'GET', redirect: 'follow' }),
    );
  });

  it('preserves secure manifest query configuration on stream requests', async () => {
    const fetcher = jest.fn(async () => response(JSON.stringify({ streams: [] })));
    const adapter = new StremioAddonAdapter({
      ...descriptor,
      manifestUrl: 'https://example.com/addon/manifest.json?token=LOCAL-ONLY#fragment',
    }, fetcher, 50);

    await adapter.resolve({
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: { imdb: 'tt0137523' },
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://example.com/addon/stream/movie/tt0137523.json?token=LOCAL-ONLY',
      expect.any(Object),
    );
  });

  it('allows harmless double dots inside provider resource ids', async () => {
    const fetcher = jest.fn(async () => response(
      JSON.stringify({ streams: [] }),
    ));
    const customDescriptor = {
      ...descriptor,
      stream: {
        types: ['movie' as const],
        idPrefixes: ['custom:'],
      },
    };
    const adapter = new StremioAddonAdapter(
      customDescriptor,
      fetcher,
      50,
    );

    await adapter.resolve({
      mediaId: 'stremio-catalog:movie:custom%3Amovie..backup',
      kind: 'movie',
      externalIds: {},
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://example.com/addon/stream/movie/custom%3Amovie..backup.json',
      expect.any(Object),
    );
  });

  it('rejects insecure non-loopback provider endpoints before fetching', async () => {
    const fetcher = jest.fn(async () => response(
      JSON.stringify({ streams: [] }),
    ));
    const adapter = new StremioAddonAdapter({
      ...descriptor,
      manifestUrl: 'http://example.com/addon/manifest.json',
    }, fetcher, 50);

    await expect(adapter.resolve({
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: { imdb: 'tt0137523' },
    })).rejects.toThrow('secure HTTPS');

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps manual loopback HTTP provider endpoints available for development', async () => {
    const fetcher = jest.fn(async () => response(
      JSON.stringify({ streams: [] }),
    ));
    const adapter = new StremioAddonAdapter({
      ...descriptor,
      manifestUrl: 'http://127.0.0.1:7000/addon/manifest.json',
    }, fetcher, 50);

    await adapter.resolve({
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: { imdb: 'tt0137523' },
    });

    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:7000/addon/stream/movie/tt0137523.json',
      expect.any(Object),
    );
  });

  it('honors a shorter resolver-provided provider budget', async () => {
    jest.useFakeTimers();
    try {
      let signal: { aborted?: boolean } | undefined;
      const fetcher = jest.fn((_url: string, init: any) => {
        signal = init.signal;
        return new Promise<any>(() => undefined);
      });
      const adapter = new StremioAddonAdapter(
        descriptor,
        fetcher,
        8_000,
      );

      const pending = adapter.resolve({
        mediaId: 'tmdb:movie:550',
        kind: 'movie',
        externalIds: { imdb: 'tt0137523' },
      }, {
        timeoutMs: 25,
      });
      const rejection = expect(pending).rejects.toThrow(
        'Provider request timed out',
      );

      await jest.advanceTimersByTimeAsync(26);

      await rejection;
      expect(signal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('bounds alternate stream routes to one provider timeout budget', async () => {
    const now = jest.spyOn(Date, 'now');
    now
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_500)
      .mockReturnValueOnce(2_001);
    const fetcher = jest.fn(async () => response(
      JSON.stringify({ streams: [] }),
    ));
    const adapter = new StremioAddonAdapter({
      ...descriptor,
      stream: {
        types: ['movie' as const],
        idPrefixes: ['tmdb:'],
      },
    }, fetcher, 1_000);

    try {
      await adapter.resolve({
        mediaId: 'tmdb:movie:550',
        kind: 'movie',
        externalIds: { tmdb: '550' },
      });
    } finally {
      now.mockRestore();
    }

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.com/addon/stream/movie/tmdb%3A550.json',
      expect.any(Object),
    );
  });

  it('reserves provider timeout budget for alternate accepted stream ids', async () => {
    jest.useFakeTimers();
    try {
      const fetcher = jest.fn((url: string) => {
        if (url.includes('tmdb%3A550.json')) {
          return new Promise<any>(() => undefined);
        }
        return Promise.resolve(response(JSON.stringify({
          streams: [{ url: 'https://cdn.example/fallback.mp4' }],
        })));
      });
      const adapter = new StremioAddonAdapter({
        ...descriptor,
        stream: {
          types: ['movie' as const],
          idPrefixes: ['tmdb:'],
        },
      }, fetcher, 40);

      const pending = adapter.resolve({
        mediaId: 'tmdb:movie:550',
        kind: 'movie',
        externalIds: { tmdb: '550' },
      });

      await jest.advanceTimersByTimeAsync(21);

      await expect(pending).resolves.toEqual([
        expect.objectContaining({
          url: 'https://cdn.example/fallback.mp4',
        }),
      ]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('tries a TMDB fallback route when the first accepted ID returns no streams', async () => {
    const calls: string[] = [];
    const fetcher = jest.fn(async (url: string) => {
      calls.push(url);
      return response(JSON.stringify({
        streams: url.includes('tmdb%3Amovie%3A550')
          ? [{ url: 'https://cdn.example/fallback.mp4' }]
          : [],
      }));
    });
    const adapter = new StremioAddonAdapter({
      ...descriptor,
      stream: {
        types: ['movie' as const],
        idPrefixes: ['tmdb:'],
      },
    }, fetcher, 50);

    const sources = await adapter.resolve({
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: { tmdb: '550' },
    });

    expect(calls).toEqual([
      'https://example.com/addon/stream/movie/tmdb%3A550.json',
      'https://example.com/addon/stream/movie/tmdb%3Amovie%3A550.json',
    ]);
    expect(sources[0]?.url).toBe('https://cdn.example/fallback.mp4');
  });

  it('keeps a successful empty fallback result from becoming a provider outage', async () => {
    const fetcher = jest.fn(async (url: string) => {
      if (url.includes('tmdb%3A550.json')) {
        return response('{}', { status: 404 });
      }
      return response(JSON.stringify({ streams: [] }));
    });
    const adapter = new StremioAddonAdapter({
      ...descriptor,
      stream: {
        types: ['movie' as const],
        idPrefixes: ['tmdb:'],
      },
    }, fetcher, 50);

    await expect(adapter.resolve({
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: { tmdb: '550' },
    })).resolves.toEqual([]);
  });

  it('uses the encoded series episode protocol ID', async () => {
    const fetcher = jest.fn(async () => response(JSON.stringify({ streams: [] })));
    const adapter = new StremioAddonAdapter(descriptor, fetcher, 50);

    await adapter.resolve({
      mediaId: 'tmdb:series:1399',
      kind: 'episode',
      externalIds: { imdb: 'tt0944947' },
      seasonNumber: 1,
      episodeNumber: 2,
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://example.com/addon/stream/series/tt0944947%3A1%3A2.json',
      expect.any(Object),
    );
  });
});

describe('AddonInstallationService', () => {
  it('inspects before installation and enables a provider that needs no configuration', async () => {
    const repository = new MemoryRepository();
    const secrets = new MemorySecrets();
    const loader = { load: jest.fn(async () => manifest) };
    const service = new AddonInstallationService(
      repository,
      secrets,
      loader,
      () => '2026-09-15T11:30:00.000Z',
    );

    const inspected = await service.inspectManifest('https://example.com/addon', 'manual');
    expect(inspected.descriptor.id).toBe('org.example.public-domain');

    const installed = await service.install(inspected, {});
    expect(installed.installed).toEqual(expect.objectContaining({
      enabled: true,
      setupIncomplete: false,
    }));
    await expect(repository.list()).resolves.toHaveLength(1);
  });

  it('applies required manifest defaults so a catalog provider installs enabled', async () => {
    const repository = new MemoryRepository();
    const secrets = new MemorySecrets();
    const catalogManifest = {
      id: 'com.nuvio.tmdb.catalogs',
      name: 'Nuvio Catalog Addon',
      version: '1.2.0',
      resources: ['catalog', { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'] }],
      types: ['movie', 'series'],
      catalogs: [
        { type: 'movie', id: 'trending-movies', name: 'Trending Movies', extra: [{ name: 'skip', isRequired: false }] },
      ],
      config: [
        { key: 'language', type: 'text', title: 'Language locale', default: 'en-US', required: true },
        { key: 'region', type: 'text', title: 'Region', default: 'US', required: true },
      ],
      behaviorHints: { configurable: true },
    };
    const service = new AddonInstallationService(
      repository,
      secrets,
      { load: async () => catalogManifest },
      () => '2026-09-19T09:00:00.000Z',
    );

    const inspected = await service.inspectManifest('https://catalog.nuvio.tv/manifest.json', 'manual');
    const installed = await service.install(inspected, {});

    expect(installed.installed).toEqual(expect.objectContaining({
      enabled: true,
      setupIncomplete: false,
    }));
    expect(installed.safeConfig).toEqual({
      language: 'en-US',
      region: 'US',
    });
  });

  it('preserves existing safe config when reinstalling a configurable provider', async () => {
    const repository = new MemoryRepository();
    const secrets = new MemorySecrets();
    const catalogManifest = {
      id: 'com.nuvio.tmdb.catalogs',
      name: 'Nuvio Catalog Addon',
      version: '1.2.0',
      resources: ['catalog', {
        name: 'meta',
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'tmdb:'],
      }],
      types: ['movie', 'series'],
      catalogs: [{
        type: 'movie',
        id: 'trending-movies',
        name: 'Trending Movies',
      }],
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
      behaviorHints: { configurable: true },
    };
    let now = 0;
    const service = new AddonInstallationService(
      repository,
      secrets,
      { load: async () => catalogManifest },
      () => new Date(
        Date.parse('2026-09-19T09:00:00.000Z') + now++,
      ).toISOString(),
    );

    const firstInspection = await service.inspectManifest(
      'https://catalog.nuvio.tv/manifest.json',
      'manual',
    );
    await service.install(firstInspection, {
      language: 'fr-FR',
      region: 'FR',
    });

    const replacementInspection = await service.inspectManifest(
      'https://catalog.nuvio.tv/manifest.json',
      'manual',
    );
    const replaced = await service.install(
      replacementInspection,
      {},
    );

    expect(replaced.safeConfig).toEqual({
      language: 'fr-FR',
      region: 'FR',
    });
  });

  it('keeps a secret-requiring provider disabled until its local secret is configured', async () => {
    const repository = new MemoryRepository();
    const secrets = new MemorySecrets();
    const configuredManifest = {
      ...manifest,
      behaviorHints: { configurationRequired: true },
      config: [{ key: 'token', type: 'password', title: 'Token', required: true }],
    };
    const service = new AddonInstallationService(
      repository,
      secrets,
      { load: async () => configuredManifest },
      () => '2026-09-15T11:30:00.000Z',
    );

    const inspected = await service.inspectManifest('https://example.com/addon', 'manual');
    const incomplete = await service.install(inspected, {});
    expect(incomplete.installed).toEqual(expect.objectContaining({
      enabled: false,
      setupIncomplete: true,
    }));

    const complete = await service.configure('org.example.public-domain', { token: 'LOCAL-SECRET' });
    expect(complete.installed).toEqual(expect.objectContaining({
      enabled: true,
      setupIncomplete: false,
    }));
    expect(secrets.values.get('org.example.public-domain:token')).toBe('LOCAL-SECRET');
    expect(JSON.stringify(await repository.list())).not.toContain('LOCAL-SECRET');
  });
});

test('explicitly clearing a provider secret removes the saved credential', async () => {
  const repository = new MemoryRepository();
  const secrets = new MemorySecrets();
  const configuredManifest = {
    ...manifest,
    behaviorHints: { configurationRequired: true },
    config: [{ key: 'token', type: 'password', title: 'Token', required: true }],
  };
  const service = new AddonInstallationService(
    repository,
    secrets,
    { load: async () => configuredManifest },
  );

  const inspected = await service.inspectManifest(
    'https://example.com/manifest.json',
    'manual',
  );
  await service.install(inspected, { token: 'LOCAL-SECRET' });
  expect(secrets.values.get('org.example.public-domain:token')).toBe(
    'LOCAL-SECRET',
  );

  // Omitting the field preserves the existing saved secret.
  const preserved = await service.configure(
    'org.example.public-domain',
    {},
  );
  expect(preserved.installed.setupIncomplete).toBe(false);
  expect(secrets.values.get('org.example.public-domain:token')).toBe(
    'LOCAL-SECRET',
  );
  expect(
    secrets.values.get(
      `org.example.public-domain:${RUNTIME_MANIFEST_URL_SECRET_KEY}`,
    ),
  ).toContain('LOCAL-SECRET');

  // Explicitly submitting the secret field as blank removes it and rolls the
  // runtime endpoint back to the public base manifest.
  const cleared = await service.configure(
    'org.example.public-domain',
    { token: '' },
  );
  expect(secrets.values.has('org.example.public-domain:token')).toBe(false);
  expect(
    secrets.values.get(
      `org.example.public-domain:${RUNTIME_MANIFEST_URL_SECRET_KEY}`,
    ),
  ).toBe('https://example.com/manifest.json');
  expect(cleared.descriptor?.manifestUrl).toBe(
    'https://example.com/manifest.json',
  );
  expect(cleared.installed).toEqual(expect.objectContaining({
    enabled: false,
    setupIncomplete: true,
  }));
});

test('failed provider configuration restores previous secure state', async () => {
  class FailingNextSaveRepository extends MemoryRepository {
    failNextSave = false;

    override async save(record: AddonStateRecord): Promise<void> {
      if (this.failNextSave) {
        this.failNextSave = false;
        throw new Error('repository save failed');
      }
      await super.save(record);
    }
  }

  const repository = new FailingNextSaveRepository();
  const secrets = new MemorySecrets();
  const configuredManifest = {
    ...manifest,
    behaviorHints: { configurationRequired: true },
    config: [
      {
        key: 'token',
        type: 'password',
        title: 'Token',
        required: true,
      },
    ],
  };
  const service = new AddonInstallationService(
    repository,
    secrets,
    { load: async () => configuredManifest },
  );

  const inspected = await service.inspectManifest(
    'https://example.com/manifest.json',
    'manual',
  );
  await service.install(inspected, { token: 'OLD-FIXTURE' });

  const runtimeKey =
    `org.example.public-domain:${RUNTIME_MANIFEST_URL_SECRET_KEY}`;
  const previousRuntime = secrets.values.get(runtimeKey);
  expect(previousRuntime).toContain('OLD-FIXTURE');

  repository.failNextSave = true;
  await expect(
    service.configure(
      'org.example.public-domain',
      { token: 'NEW-FIXTURE' },
    ),
  ).rejects.toThrow('repository save failed');

  expect(
    secrets.values.get('org.example.public-domain:token'),
  ).toBe('OLD-FIXTURE');
  expect(secrets.values.get(runtimeKey)).toBe(previousRuntime);
  expect(JSON.stringify(await repository.list()))
    .not.toContain('NEW-FIXTURE');
});

test('configured manifest URLs persist only in secure storage and rehydrate after restart', async () => {
  const repository = new MemoryRepository();
  const secrets = new MemorySecrets();
  const configurableManifest = {
    ...manifest,
    behaviorHints: { configurable: true },
  };
  const privateUrl = 'https://provider.example/realdebrid=LOCAL-SECRET/manifest.json';
  const loader = { load: jest.fn(async (_url: string) => configurableManifest) };
  const service = new AddonInstallationService(
    repository,
    secrets,
    loader,
    () => '2026-09-19T12:00:00.000Z',
  );

  const inspected = await service.inspectManifest(privateUrl, 'manual');
  const runtime = await service.install(inspected, {});

  expect(runtime.descriptor?.manifestUrl).toBe(privateUrl);
  expect(secrets.values.get(
    `org.example.public-domain:${RUNTIME_MANIFEST_URL_SECRET_KEY}`,
  )).toBe(privateUrl);

  const stored = (await repository.list())[0]!;
  expect(stored.installed.manifestUrl).toBeUndefined();
  expect(stored.descriptor?.manifestUrl).toBeUndefined();
  expect(JSON.stringify(stored)).not.toContain('LOCAL-SECRET');

  const restored = await service.hydrate(stored);
  expect(restored.descriptor?.manifestUrl).toBe(privateUrl);
});

test('synced safe provider without cached descriptor rehydrates in one pass', async () => {
  const repository = new MemoryRepository();
  const secrets = new MemorySecrets();
  const configurableManifest = {
    id: 'com.nuvio.tmdb.catalogs',
    name: 'Nuvio Catalog Addon',
    version: '1.2.0',
    resources: ['catalog'],
    types: ['movie', 'series'],
    catalogs: [{
      type: 'movie',
      id: 'trending-movies',
      name: 'Trending Movies',
    }],
    config: [
      {
        key: 'language',
        type: 'text',
        title: 'Language locale',
        required: true,
      },
      {
        key: 'region',
        type: 'text',
        title: 'Region',
        required: true,
      },
    ],
    behaviorHints: { configurable: true },
  };
  const loader = { load: jest.fn(async (_url: string) => configurableManifest) };
  const service = new AddonInstallationService(
    repository,
    secrets,
    loader,
  );
  const synchronized: AddonStateRecord = {
    installed: {
      addonId: 'com.nuvio.tmdb.catalogs',
      manifestUrl: 'https://catalog.nuvio.tv/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 100,
      installedAt: '2026-09-28T18:00:00.000Z',
      updatedAt: '2026-09-28T18:00:00.000Z',
      setupIncomplete: true,
    },
    safeConfig: {
      language: 'fr-FR',
      region: 'FR',
    },
    syncIdentity: {
      name: 'Nuvio Catalog Addon',
      capabilities: ['catalog'],
      supportedMediaKinds: ['movie', 'series'],
      configurable: true,
    },
  };

  const restored = await service.hydrate(synchronized);

  expect(restored.installed).toEqual(expect.objectContaining({
    enabled: true,
    setupIncomplete: false,
  }));
  expect(decodeURIComponent(restored.descriptor?.manifestUrl ?? '')).toBe(
    'https://catalog.nuvio.tv/{"language":"fr-FR","region":"FR"}/manifest.json',
  );
  expect(loader.load).toHaveBeenCalledTimes(2);
  expect(loader.load.mock.calls[0]?.[0]).toBe(
    'https://catalog.nuvio.tv/manifest.json',
  );
  expect(decodeURIComponent(loader.load.mock.calls[1]?.[0] ?? '')).toBe(
    'https://catalog.nuvio.tv/{"language":"fr-FR","region":"FR"}/manifest.json',
  );
});

test('safe standard provider configuration rehydrates after volatile runtime storage is cleared', async () => {
  const repository = new MemoryRepository();
  const initialSecrets = new MemorySecrets();
  const configurableManifest = {
    id: 'com.nuvio.tmdb.catalogs',
    name: 'Nuvio Catalog Addon',
    version: '1.2.0',
    resources: ['catalog'],
    types: ['movie', 'series'],
    catalogs: [{
      type: 'movie',
      id: 'trending-movies',
      name: 'Trending Movies',
    }],
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
    behaviorHints: { configurable: true },
  };
  const loader = {
    load: jest.fn(async (_url: string) => configurableManifest),
  };
  const installService = new AddonInstallationService(
    repository,
    initialSecrets,
    loader,
  );

  const inspected = await installService.inspectManifest(
    'https://catalog.nuvio.tv/manifest.json',
    'manual',
  );
  await installService.install(inspected, {
    language: 'fr-FR',
    region: 'FR',
  });

  const [stored] = await repository.list();
  expect(stored?.descriptor?.manifestUrl).toBeUndefined();
  expect(stored?.safeConfig).toEqual({
    language: 'fr-FR',
    region: 'FR',
  });

  // Browser runtime secrets are intentionally volatile. A fresh secret store
  // simulates a PWA reload while the safe provider metadata remains persisted.
  const reloadedSecrets = new MemorySecrets();
  const reloadService = new AddonInstallationService(
    repository,
    reloadedSecrets,
    loader,
  );
  const restored = await reloadService.hydrate(stored!);

  expect(restored.installed).toEqual(expect.objectContaining({
    enabled: true,
    setupIncomplete: false,
  }));
  expect(decodeURIComponent(restored.descriptor?.manifestUrl ?? '')).toBe(
    'https://catalog.nuvio.tv/{"language":"fr-FR","region":"FR"}/manifest.json',
  );
  expect(
    decodeURIComponent(
      reloadedSecrets.values.get(
        `com.nuvio.tmdb.catalogs:${RUNTIME_MANIFEST_URL_SECRET_KEY}`,
      ) ?? '',
    ),
  ).toBe(
    'https://catalog.nuvio.tv/{"language":"fr-FR","region":"FR"}/manifest.json',
  );
  expect(loader.load).toHaveBeenCalledTimes(3);
  expect(decodeURIComponent(loader.load.mock.calls.at(-1)?.[0] ?? '')).toBe(
    'https://catalog.nuvio.tv/{"language":"fr-FR","region":"FR"}/manifest.json',
  );
});

test('safe provider runtime recovery does not re-enable a deliberately disabled provider', async () => {
  const repository = new MemoryRepository();
  const initialSecrets = new MemorySecrets();
  const configurableManifest = {
    id: 'com.nuvio.tmdb.catalogs',
    name: 'Nuvio Catalog Addon',
    version: '1.2.0',
    resources: ['catalog'],
    types: ['movie', 'series'],
    catalogs: [{
      type: 'movie',
      id: 'trending-movies',
      name: 'Trending Movies',
    }],
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
    behaviorHints: { configurable: true },
  };
  const loader = { load: jest.fn(async (_url: string) => configurableManifest) };
  const service = new AddonInstallationService(
    repository,
    initialSecrets,
    loader,
  );

  const inspected = await service.inspectManifest(
    'https://catalog.nuvio.tv/manifest.json',
    'manual',
  );
  const installed = await service.install(inspected, {
    language: 'fr-FR',
    region: 'FR',
  });
  await service.setEnabled(installed.installed.addonId, false);

  const [stored] = await repository.list();
  const reloadedSecrets = new MemorySecrets();
  const restored = await new AddonInstallationService(
    repository,
    reloadedSecrets,
    loader,
  ).hydrate(stored!);

  expect(restored.installed).toEqual(expect.objectContaining({
    enabled: false,
    setupIncomplete: false,
  }));
  expect(decodeURIComponent(restored.descriptor?.manifestUrl ?? '')).toBe(
    'https://catalog.nuvio.tv/{"language":"fr-FR","region":"FR"}/manifest.json',
  );
});

test('provider rehydration never reconstructs a standard endpoint without its required secret', async () => {
  const repository = new MemoryRepository();
  const initialSecrets = new MemorySecrets();
  const configurableManifest = {
    ...manifest,
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
        default: 'FR',
        required: true,
      },
    ],
    behaviorHints: {
      configurable: true,
      configurationRequired: true,
    },
  };
  const loader = {
    load: jest.fn(async (_url: string) => configurableManifest),
  };
  const installService = new AddonInstallationService(
    repository,
    initialSecrets,
    loader,
  );

  const inspected = await installService.inspectManifest(
    'https://provider.example/manifest.json',
    'manual',
  );
  await installService.install(inspected, {
    token: 'LOCAL-SECRET',
    region: 'FR',
  });

  const [stored] = await repository.list();
  expect(stored?.safeConfig).toEqual({ region: 'FR' });
  expect(JSON.stringify(stored)).not.toContain('LOCAL-SECRET');

  const reloadedSecrets = new MemorySecrets();
  const reloadService = new AddonInstallationService(
    repository,
    reloadedSecrets,
    loader,
  );
  const restored = await reloadService.hydrate(stored!);

  expect(restored.installed).toEqual(expect.objectContaining({
    enabled: false,
    setupIncomplete: true,
  }));
  expect(restored.descriptor?.manifestUrl).toBeUndefined();
  expect(
    reloadedSecrets.values.has(
      `org.example.public-domain:${RUNTIME_MANIFEST_URL_SECRET_KEY}`,
    ),
  ).toBe(false);
});

test('safe TvVoo country preset stays enabled without volatile runtime storage', async () => {
  const repository = new MemoryRepository();
  const secrets = new MemorySecrets();
  const manifestUrl =
    'https://tvvoo.hayd.uk/cfg-fr-al-bk/manifest.json';
  const tvvooManifest = {
    id: 'org.stremio.vavoo.clean',
    name: 'TvVoo',
    version: '5.1.0',
    resources: [{ name: 'stream', types: ['tv'] }],
    types: ['tv'],
    catalogs: [{
      type: 'tv',
      id: 'channels',
      name: 'Channels',
    }],
    behaviorHints: { configurable: true },
  };
  const service = new AddonInstallationService(
    repository,
    secrets,
    { load: jest.fn(async () => tvvooManifest) },
  );
  const stored = {
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
    descriptor: {
      id: 'org.stremio.vavoo.clean',
      name: 'TvVoo',
      version: '5.1.0',
      sourceType: 'stremio-manifest' as const,
      capabilities: ['live-tv' as const],
      requiresConfiguration: false,
      configurable: true,
      configurationFields: [],
      supportedMediaKinds: [],
      manifestUrl,
    },
  };

  const restored = await service.hydrate(stored);

  expect(restored.installed).toEqual(expect.objectContaining({
    enabled: true,
    setupIncomplete: false,
  }));
  expect(restored.descriptor?.manifestUrl).toBe(manifestUrl);
  expect(
    secrets.values.has(
      `org.stremio.vavoo.clean:${RUNTIME_MANIFEST_URL_SECRET_KEY}`,
    ),
  ).toBe(false);
});

test('credentialized manifest paths stay local even when the manifest does not advertise configuration', async () => {
  const repository = new MemoryRepository();
  const secrets = new MemorySecrets();
  const privateUrl = 'https://provider.example/alldebrid=LOCAL-SECRET/manifest.json';
  const loader = { load: jest.fn(async () => manifest) };
  const service = new AddonInstallationService(repository, secrets, loader);

  const inspected = await service.inspectManifest(privateUrl, 'manual');
  expect(inspected.descriptor.configurable).toBe(false);

  const runtime = await service.install(inspected, {});

  expect(runtime.descriptor?.manifestUrl).toBe(privateUrl);
  expect(
    secrets.values.get(
      `org.example.public-domain:${RUNTIME_MANIFEST_URL_SECRET_KEY}`,
    ),
  ).toBe(privateUrl);

  const [stored] = await repository.list();
  expect(stored?.installed.manifestUrl).toBeUndefined();
  expect(stored?.descriptor?.manifestUrl).toBeUndefined();
  expect(JSON.stringify(stored)).not.toContain('LOCAL-SECRET');
});

test('mislabeled token fields are stored as secrets and excluded from safe config', async () => {
  const repository = new MemoryRepository();
  const secrets = new MemorySecrets();
  const configuredManifest = {
    ...manifest,
    config: [
      { key: 'accessToken', type: 'text', title: 'Access token', required: true },
      { key: 'region', type: 'text', title: 'Region', required: false },
    ],
  };
  const service = new AddonInstallationService(
    repository,
    secrets,
    { load: async () => configuredManifest },
    () => '2026-09-19T12:10:00.000Z',
  );

  const inspected = await service.inspectManifest('https://example.com/manifest.json', 'manual');
  const installed = await service.install(inspected, {
    accessToken: 'LOCAL-ONLY-TOKEN',
    region: 'fr',
  });

  expect(secrets.values.get('org.example.public-domain:accessToken')).toBe('LOCAL-ONLY-TOKEN');
  expect(installed.safeConfig).toEqual({ region: 'fr' });
  expect(JSON.stringify(await repository.list())).not.toContain('LOCAL-ONLY-TOKEN');
});

test('reinstall scrubs stale sensitive values from previously safe provider config', async () => {
  const repository = new MemoryRepository();
  const secrets = new MemorySecrets();
  const configuredManifest = {
    ...manifest,
    config: [
      { key: 'accessToken', type: 'text', title: 'Access token', required: false },
      { key: 'region', type: 'text', title: 'Region', required: false },
    ],
  };
  const service = new AddonInstallationService(
    repository,
    secrets,
    { load: async () => configuredManifest },
    () => '2026-09-21T16:10:00.000Z',
  );

  const inspected = await service.inspectManifest(
    'https://example.com/manifest.json',
    'manual',
  );
  repository.records = [{
    installed: {
      addonId: inspected.descriptor.id,
      manifestUrl: inspected.manifestUrl,
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 100,
      installedAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
      setupIncomplete: false,
    },
    safeConfig: {
      accessToken: 'STALE-PLAINTEXT-TOKEN',
      region: 'al',
    },
    descriptor: inspected.descriptor,
  }];

  const reinstalled = await service.install(inspected, { region: 'fr' });

  expect(reinstalled.safeConfig).toEqual({ region: 'fr' });
  expect(JSON.stringify(await repository.list())).not.toContain(
    'STALE-PLAINTEXT-TOKEN',
  );
});

test('reinstall removes secure fields that disappeared from the manifest schema', async () => {
  const repository = new MemoryRepository();
  const secrets = new MemorySecrets();
  const oldManifest = {
    ...manifest,
    config: [
      {
        key: 'token',
        type: 'password',
        title: 'Token',
        required: false,
      },
    ],
  };
  const newManifest = {
    ...manifest,
    config: [
      {
        key: 'region',
        type: 'text',
        title: 'Region',
        required: false,
      },
    ],
  };
  const loader = {
    load: jest.fn(async (url: string) => (
      url.includes('/new/')
        ? newManifest
        : oldManifest
    )),
  };
  const service = new AddonInstallationService(
    repository,
    secrets,
    loader,
  );

  const initial = await service.inspectManifest(
    'https://example.com/old/manifest.json',
    'manual',
  );
  await service.install(initial, { token: 'OLD-FIXTURE' });
  expect(
    secrets.values.get('org.example.public-domain:token'),
  ).toBe('OLD-FIXTURE');

  const replacement = await service.inspectManifest(
    'https://example.com/new/manifest.json',
    'manual',
  );
  await service.install(replacement, { region: 'fr' });

  expect(
    secrets.values.has('org.example.public-domain:token'),
  ).toBe(false);
});

test('removing a configured provider deletes its secure runtime manifest URL', async () => {
  const repository = new MemoryRepository();
  const secrets = new MemorySecrets();
  const configurableManifest = {
    ...manifest,
    behaviorHints: { configurable: true },
  };
  const privateUrl = 'https://provider.example/debrid=LOCAL/manifest.json';
  const service = new AddonInstallationService(
    repository,
    secrets,
    { load: async () => configurableManifest },
  );

  const inspected = await service.inspectManifest(privateUrl, 'manual');
  await service.install(inspected, {});
  await service.remove('org.example.public-domain');

  expect(secrets.values.has(
    `org.example.public-domain:${RUNTIME_MANIFEST_URL_SECRET_KEY}`,
  )).toBe(false);
});


test('failed provider removal keeps secure runtime state intact', async () => {
  class FailingRemoveRepository extends MemoryRepository {
    override async remove(_addonId: string): Promise<void> {
      throw new Error('repository remove failed');
    }
  }

  const repository = new FailingRemoveRepository();
  const secrets = new MemorySecrets();
  const configurableManifest = {
    ...manifest,
    behaviorHints: { configurable: true },
  };
  const privateUrl = 'https://provider.example/debrid=fixture/manifest.json';
  const service = new AddonInstallationService(
    repository,
    secrets,
    { load: async () => configurableManifest },
  );

  const inspected = await service.inspectManifest(privateUrl, 'manual');
  await service.install(inspected, {});

  await expect(
    service.remove('org.example.public-domain'),
  ).rejects.toThrow('repository remove failed');

  expect(await repository.list()).toHaveLength(1);
  expect(secrets.values.has(
    `org.example.public-domain:${RUNTIME_MANIFEST_URL_SECRET_KEY}`,
  )).toBe(true);
});

test('failed provider secret cleanup restores the removed provider record', async () => {
  class FailingDeleteSecrets extends MemorySecrets {
    override async deleteProvider(
      _providerId: string,
      _fieldKeys: readonly string[],
    ): Promise<void> {
      throw new Error('secret cleanup failed');
    }
  }

  const repository = new MemoryRepository();
  const secrets = new FailingDeleteSecrets();
  const configurableManifest = {
    ...manifest,
    behaviorHints: { configurable: true },
  };
  const privateUrl = 'https://provider.example/debrid=fixture/manifest.json';
  const service = new AddonInstallationService(
    repository,
    secrets,
    { load: async () => configurableManifest },
  );

  const inspected = await service.inspectManifest(privateUrl, 'manual');
  await service.install(inspected, {});

  await expect(
    service.remove('org.example.public-domain'),
  ).rejects.toThrow('secret cleanup failed');

  expect(await repository.list()).toHaveLength(1);
  expect(secrets.values.has(
    `org.example.public-domain:${RUNTIME_MANIFEST_URL_SECRET_KEY}`,
  )).toBe(true);
});

test('token-like default values are never persisted in safe provider config', async () => {
  const repository = new MemoryRepository();
  const secrets = new MemorySecrets();
  const configuredManifest = {
    ...manifest,
    config: [
      {
        key: 'accessToken',
        type: 'text',
        title: 'Access token',
        required: false,
        default: 'MUST-STAY-LOCAL',
      },
      {
        key: 'region',
        type: 'text',
        title: 'Region',
        required: false,
        default: 'fr',
      },
    ],
  };
  const service = new AddonInstallationService(
    repository,
    secrets,
    { load: async () => configuredManifest },
  );

  const inspected = await service.inspectManifest('https://example.com/manifest.json', 'manual');
  const installed = await service.install(inspected, {});

  expect(installed.safeConfig).toEqual({ region: 'fr' });
  expect(JSON.stringify(await repository.list())).not.toContain('MUST-STAY-LOCAL');
});


test('standard configurable provider settings update the validated runtime manifest URL', async () => {
  const repository = new MemoryRepository();
  const secrets = new MemorySecrets();
  const configurableManifest = {
    id: 'com.nuvio.tmdb.catalogs',
    name: 'Nuvio Catalog Addon',
    version: '1.2.0',
    resources: ['catalog'],
    types: ['movie', 'series'],
    catalogs: [{ type: 'movie', id: 'trending-movies', name: 'Trending Movies' }],
    config: [
      { key: 'language', type: 'text', title: 'Language locale', default: 'en-US', required: true },
      { key: 'region', type: 'text', title: 'Region', default: 'US', required: true },
    ],
    behaviorHints: { configurable: true },
  };
  const loader = {
    load: jest.fn(async (_manifestUrl: string) => configurableManifest),
  };
  const service = new AddonInstallationService(
    repository,
    secrets,
    loader,
    () => '2026-09-19T14:00:00.000Z',
  );

  const inspected = await service.inspectManifest(
    'https://catalog.example/manifest.json',
    'manual',
  );
  await service.install(inspected, {});
  const configured = await service.configure('com.nuvio.tmdb.catalogs', {
    language: 'fr-FR',
    region: 'FR',
  });

  const configuredUrl = loader.load.mock.calls.at(-1)?.[0] as string;
  expect(decodeURIComponent(configuredUrl)).toBe(
    'https://catalog.example/{"language":"fr-FR","region":"FR"}/manifest.json',
  );
  expect(configured.descriptor?.manifestUrl).toBe(configuredUrl);
  expect(configured.safeConfig).toEqual({
    language: 'fr-FR',
    region: 'FR',
  });

  // Safe language/region settings and the public base manifest persist, while
  // the configured runtime endpoint stays device-local.
  const [stored] = await repository.list();
  expect(stored?.safeConfig).toEqual({
    language: 'fr-FR',
    region: 'FR',
  });
  expect(stored?.installed.manifestUrl).toBe(
    'https://catalog.example/manifest.json',
  );
  expect(stored?.descriptor?.manifestUrl).toBeUndefined();
  expect(
    secrets.values.get(
      `com.nuvio.tmdb.catalogs:${RUNTIME_MANIFEST_URL_SECRET_KEY}`,
    ),
  ).toBe(configuredUrl);
});

test('custom configurable provider rejects guessed standard config and keeps manifest replacement as fallback', async () => {
  const repository = new MemoryRepository();
  const secrets = new MemorySecrets();
  const configuredManifest = {
    ...manifest,
    config: [
      { key: 'token', type: 'password', title: 'Token', required: true },
    ],
    behaviorHints: { configurable: true, configurationRequired: true },
  };
  const loader = {
    load: jest.fn(async (url: string) => {
      if (url.includes('%7B') || url.includes('%22')) {
        throw new Error('custom provider does not use JSON config');
      }
      return configuredManifest;
    }),
  };
  const service = new AddonInstallationService(repository, secrets, loader);

  const inspected = await service.inspectManifest(
    'https://custom.example/manifest.json',
    'manual',
  );
  await service.install(inspected, {});

  await expect(service.configure('org.example.public-domain', {
    token: 'LOCAL-SECRET',
  })).rejects.toThrow('Update manifest URL');

  expect(JSON.stringify(await repository.list())).not.toContain('LOCAL-SECRET');
});


test('provider mutation timestamps remain monotonic when the device clock moves backward', async () => {
  const repository = new MemoryRepository();
  const secrets = new MemorySecrets();
  let now = '2026-09-22T10:00:00.000Z';
  const service = new AddonInstallationService(
    repository,
    secrets,
    { load: async () => manifest },
    () => now,
  );

  const inspected = await service.inspectManifest(
    'https://example.com/manifest.json',
    'manual',
  );
  const installed = await service.install(inspected, {});
  expect(installed.installed.updatedAt).toBe(
    '2026-09-22T10:00:00.000Z',
  );

  now = '2026-09-22T09:00:00.000Z';
  const disabled = await service.setEnabled(
    'org.example.public-domain',
    false,
  );

  expect(disabled.installed.updatedAt).toBe(
    '2026-09-22T10:00:00.001Z',
  );
});

test('provider reorder stamps a newer mutation timestamp for synchronization', async () => {
  const repository = new MemoryRepository();
  const secrets = new MemorySecrets();
  let now = '2026-09-22T10:00:00.000Z';
  const loader = { load: async () => manifest };
  const service = new AddonInstallationService(
    repository,
    secrets,
    loader,
    () => now,
  );

  const first = await service.inspectManifest(
    'https://example.com/manifest.json',
    'manual',
  );
  await service.install(first, {});

  const secondManifest = {
    ...manifest,
    id: 'org.example.second',
    name: 'Second',
  };
  const secondService = new AddonInstallationService(
    repository,
    secrets,
    { load: async () => secondManifest },
    () => now,
  );
  const second = await secondService.inspectManifest(
    'https://second.example/manifest.json',
    'manual',
  );
  await secondService.install(second, {});

  now = '2026-09-22T09:00:00.000Z';
  const moved = await service.move(
    'org.example.public-domain',
    'up',
  );

  expect(moved.map((item) => item.installed.addonId)).toEqual([
    'org.example.public-domain',
    'org.example.second',
  ]);
  for (const record of moved) {
    expect(record.installed.updatedAt).toBe(
      '2026-09-22T10:00:00.001Z',
    );
  }
});

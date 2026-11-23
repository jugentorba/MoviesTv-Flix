import { reconcileInstalledAddons } from '../index';

const identity = {
  name: 'Remote provider',
  capabilities: ['stream' as const],
  supportedMediaKinds: ['movie' as const],
  configurable: false,
};

function remote(manifestUrl: string) {
  return {
    addonId: 'org.example.remote',
    manifestUrl,
    sourceType: 'stremio-manifest' as const,
    enabled: true,
    priority: 100,
    safeConfig: {},
    setupIncomplete: false,
    updatedAt: '2026-09-23T18:00:00.000Z',
    identity,
  };
}

describe('synced manifest URL revalidation', () => {
  test('drops unsafe remote-only manifest URLs before local hydration', () => {
    const [record] = reconcileInstalledAddons(
      [],
      [remote('http://evil.example/manifest.json')],
      new Set(),
    );

    expect(record?.installed.manifestUrl).toBeUndefined();
    // Preserve the preference while the missing endpoint and setup gate
    // prevent activation before local hydration validates a replacement.
    expect(record?.installed.enabled).toBe(true);
    expect(record?.installed.setupIncomplete).toBe(true);
  });

  test('does not replace a safe local URL with an unsafe newer remote URL', () => {
    const [record] = reconcileInstalledAddons(
      [{
        installed: {
          addonId: 'org.example.remote',
          manifestUrl: 'https://provider.example/manifest.json',
          sourceType: 'stremio-manifest',
          enabled: true,
          priority: 50,
          installedAt: '2026-09-23T16:00:00.000Z',
          updatedAt: '2026-09-23T17:00:00.000Z',
          setupIncomplete: false,
        },
        safeConfig: {},
        descriptor: undefined,
      }],
      [remote('https://provider.example/token=REMOTE-SECRET/manifest.json')],
      new Set(),
    );

    expect(record?.installed.manifestUrl)
      .toBe('https://provider.example/manifest.json');
    expect(JSON.stringify(record)).not.toContain('REMOTE-SECRET');
  });

  test('still accepts a safe newer HTTPS manifest', () => {
    const [record] = reconcileInstalledAddons(
      [{
        installed: {
          addonId: 'org.example.remote',
          manifestUrl: 'https://old.example/manifest.json',
          sourceType: 'stremio-manifest',
          enabled: true,
          priority: 50,
          installedAt: '2026-09-23T16:00:00.000Z',
          updatedAt: '2026-09-23T17:00:00.000Z',
          setupIncomplete: false,
        },
        safeConfig: {},
        descriptor: undefined,
      }],
      [remote('https://provider.example/manifest.json')],
      new Set(),
    );

    expect(record?.installed.manifestUrl)
      .toBe('https://provider.example/manifest.json');
  });

  test('a public provider arrives on the second device ready to use', () => {
    // No secret and no runtime configuration: the URL is the whole install, so
    // the other device must not be asked to set anything up.
    const [record] = reconcileInstalledAddons(
      [],
      [remote('https://v3-cinemeta.strem.io/manifest.json')],
      new Set(),
    );

    expect(record?.installed.manifestUrl)
      .toBe('https://v3-cinemeta.strem.io/manifest.json');
    expect(record?.installed.enabled).toBe(true);
    expect(record?.installed.setupIncomplete).toBe(false);
  });

  test('a provider whose link carries a token arrives needing that link once', () => {
    const [record] = reconcileInstalledAddons(
      [],
      [{
        ...remote(''),
        // The sender already refused to upload it; the record still syncs.
        manifestUrl: undefined,
        setupIncomplete: true,
        identity: { ...identity, configurable: true },
      }],
      new Set(),
    );

    expect(record?.installed.manifestUrl).toBeUndefined();
    expect(record?.installed.setupIncomplete).toBe(true);
    // The user's on/off preference survives; the setup gate is what blocks it.
    expect(record?.installed.enabled).toBe(true);
  });
});

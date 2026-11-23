import {
  isSafePublicConfiguredManifestUrl,
  reconcileInstalledAddons,
  toSafeAddonSyncRecord,
} from '../index';

const SAFE_TVVOO =
  'https://tvvoo.hayd.uk/cfg-fr-al-bk/manifest.json';

const descriptor = {
  id: 'org.stremio.vavoo.clean',
  name: 'TvVoo',
  version: '5.1.0',
  sourceType: 'stremio-manifest' as const,
  capabilities: ['live-tv' as const],
  requiresConfiguration: false,
  configurable: true,
  configurationFields: [],
  supportedMediaKinds: [],
  manifestUrl: SAFE_TVVOO,
};

describe('TvVoo country-only preset sync', () => {
  test('recognizes only the public country preset shape on the official host', () => {
    expect(isSafePublicConfiguredManifestUrl(SAFE_TVVOO)).toBe(true);
    expect(isSafePublicConfiguredManifestUrl(
      'https://tvvoo.hayd.uk/cfg-fr/manifest.json',
    )).toBe(true);

    expect(isSafePublicConfiguredManifestUrl(
      'https://evil.example/cfg-fr-al-bk/manifest.json',
    )).toBe(false);
    expect(isSafePublicConfiguredManifestUrl(
      'https://tvvoo.hayd.uk/cfg-fr-al-bk-cln/manifest.json',
    )).toBe(false);
    expect(isSafePublicConfiguredManifestUrl(
      'https://tvvoo.hayd.uk/cfg-fr-al-mfu_aHR0cHM6Ly9wcm94eQ-mfp_c2VjcmV0/manifest.json',
    )).toBe(false);
  });

  test('serializes a safe country-only configured endpoint for account sync', () => {
    const record = toSafeAddonSyncRecord(
      {
        addonId: descriptor.id,
        manifestUrl: SAFE_TVVOO,
        sourceType: 'stremio-manifest',
        enabled: true,
        priority: 100,
        installedAt: '2026-09-23T17:00:00.000Z',
        updatedAt: '2026-09-23T17:00:00.000Z',
        setupIncomplete: false,
      },
      [],
      {},
      descriptor,
    );

    expect(record.manifestUrl).toBe(SAFE_TVVOO);
    expect(record.enabled).toBe(true);
    expect(record.setupIncomplete).toBe(false);
    expect(record.identity?.configurable).toBe(true);
  });

  test('restores a synced country-only preset without forcing local setup', () => {
    const [restored] = reconcileInstalledAddons(
      [],
      [{
        addonId: descriptor.id,
        manifestUrl: SAFE_TVVOO,
        sourceType: 'stremio-manifest',
        enabled: true,
        priority: 100,
        safeConfig: {},
        setupIncomplete: false,
        updatedAt: '2026-09-23T17:00:00.000Z',
        identity: {
          name: 'TvVoo',
          capabilities: ['live-tv'],
          supportedMediaKinds: [],
          configurable: true,
        },
      }],
      new Set(),
    );

    expect(restored?.installed).toEqual(expect.objectContaining({
      manifestUrl: SAFE_TVVOO,
      enabled: true,
      setupIncomplete: false,
    }));
  });

  test('still omits configurable TvVoo endpoints carrying proxy credentials', () => {
    const sensitiveUrl =
      'https://tvvoo.hayd.uk/cfg-fr-al-mfu_aHR0cHM6Ly9wcm94eQ-mfp_c2VjcmV0/manifest.json';
    const record = toSafeAddonSyncRecord(
      {
        addonId: descriptor.id,
        manifestUrl: sensitiveUrl,
        sourceType: 'stremio-manifest',
        enabled: true,
        priority: 100,
        installedAt: '2026-09-23T17:00:00.000Z',
        updatedAt: '2026-09-23T17:00:00.000Z',
        setupIncomplete: false,
      },
      [],
      {},
      { ...descriptor, manifestUrl: sensitiveUrl },
    );

    expect(record.manifestUrl).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain('c2VjcmV0');
  });
});

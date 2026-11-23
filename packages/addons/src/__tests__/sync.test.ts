import * as addons from '../index';

function exported<T>(name: string): T | undefined {
  return (addons as any)[name] as T | undefined;
}

const installed = {
  addonId: 'org.example.configured',
  manifestUrl: 'https://example.com/manifest.json',
  sourceType: 'stremio-manifest' as const,
  enabled: true,
  priority: 50,
  installedAt: '2026-09-05T15:00:00.000Z',
  updatedAt: '2026-09-05T15:10:00.000Z',
  setupIncomplete: false,
};

const fields = [
  { key: 'region', label: 'Region', type: 'select' as const, required: false, secret: false },
  { key: 'apiKey', label: 'API key', type: 'secret' as const, required: true, secret: true },
  { key: 'enabledOption', label: 'Enabled option', type: 'boolean' as const, required: false, secret: false },
];

describe('safe add-on account sync serialization', () => {
  it('copies only fields explicitly classified as non-secret', () => {
    const toSafeAddonSyncRecord = exported<(installed: any, fields: any[], values: Record<string, unknown>) => any>('toSafeAddonSyncRecord');
    expect(toSafeAddonSyncRecord).toBeDefined();

    const record = toSafeAddonSyncRecord?.(installed, fields, {
      region: 'fr',
      apiKey: 'DO-NOT-SYNC-123',
      enabledOption: true,
      undeclared: 'also-do-not-sync',
    });

    expect(record).toEqual({
      addonId: 'org.example.configured',
      manifestUrl: 'https://example.com/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 50,
      safeConfig: { region: 'fr', enabledOption: true },
      setupIncomplete: false,
      updatedAt: '2026-09-05T15:10:00.000Z',
    });
    expect(JSON.stringify(record)).not.toContain('DO-NOT-SYNC-123');
    expect(JSON.stringify(record)).not.toContain('undeclared');
  });

  it('treats duplicate config keys as sensitive when any declaration is sensitive', () => {
    const toSafeAddonSyncRecord = exported<(installed: any, fields: any[], values: Record<string, unknown>) => any>('toSafeAddonSyncRecord');
    const record = toSafeAddonSyncRecord?.(
      installed,
      [
        { key: 'credential', label: 'Credential', type: 'secret', required: true, secret: true },
        { key: 'credential', label: 'Credential copy', type: 'text', required: false, secret: false },
        { key: 'region', label: 'Region', type: 'text', required: false, secret: false },
      ],
      {
        credential: 'MUST-STAY-LOCAL',
        region: 'fr',
      },
    );

    expect(record?.safeConfig).toEqual({ region: 'fr' });
    expect(JSON.stringify(record)).not.toContain('MUST-STAY-LOCAL');
  });

  it('bounds and validates non-secret config values before sync', () => {
    const toSafeAddonSyncRecord = exported<
      (
        installed: any,
        fields: any[],
        values: Record<string, unknown>,
      ) => any
    >('toSafeAddonSyncRecord');

    const record = toSafeAddonSyncRecord?.(
      installed,
      [
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
          key: 'endpointPath',
          label: 'Endpoint path',
          type: 'url',
          required: false,
          secret: false,
        },
        {
          key: 'mode',
          label: 'Mode',
          type: 'select',
          required: false,
          secret: false,
          options: [
            { value: 'fast', label: 'Fast' },
            { value: 'safe', label: 'Safe' },
          ],
        },
        {
          key: 'flag',
          label: 'Flag',
          type: 'boolean',
          required: false,
          secret: false,
        },
      ],
      {
        region: ' fr ',
        endpoint:
          'https://api.example/config?token=LOCAL-SECRET',
        endpointPath:
          'https://api.example/token=fixture-value/config',
        mode: 'unknown',
        flag: 'true',
      },
    );

    expect(record?.safeConfig).toEqual({
      region: 'fr',
    });
    expect(JSON.stringify(record)).not.toContain('LOCAL-SECRET');

    const safe = toSafeAddonSyncRecord?.(
      installed,
      [
        {
          key: 'endpoint',
          label: 'Endpoint',
          type: 'url',
          required: false,
          secret: false,
        },
        {
          key: 'mode',
          label: 'Mode',
          type: 'select',
          required: false,
          secret: false,
          options: [{ value: 'safe', label: 'Safe' }],
        },
        {
          key: 'flag',
          label: 'Flag',
          type: 'boolean',
          required: false,
          secret: false,
        },
      ],
      {
        endpoint: ' https://api.example/config ',
        mode: 'safe',
        flag: true,
      },
    );

    expect(safe?.safeConfig).toEqual({
      endpoint: 'https://api.example/config',
      mode: 'safe',
      flag: true,
    });
  });

  it('drops oversized and control-character config strings before sync', () => {
    const toSafeAddonSyncRecord = exported<
      (
        installed: any,
        fields: any[],
        values: Record<string, unknown>,
      ) => any
    >('toSafeAddonSyncRecord');

    const record = toSafeAddonSyncRecord?.(
      installed,
      [
        {
          key: 'large',
          label: 'Large',
          type: 'text',
          required: false,
          secret: false,
        },
        {
          key: 'control',
          label: 'Control',
          type: 'text',
          required: false,
          secret: false,
        },
      ],
      {
        large: 'x'.repeat(2_049),
        control: 'safe\u0000secret',
      },
    );

    expect(record?.safeConfig).toEqual({});
  });

  it('drops unsupported object/array values even for non-secret fields', () => {
    const toSafeAddonSyncRecord = exported<(installed: any, fields: any[], values: Record<string, unknown>) => any>('toSafeAddonSyncRecord');
    expect(toSafeAddonSyncRecord).toBeDefined();
    const record = toSafeAddonSyncRecord?.(installed, fields, {
      region: { unexpected: true },
      enabledOption: ['yes'],
    });
    expect(record?.safeConfig).toEqual({});
  });
});


  it('drops token-like config keys even when a provider mislabels them as plain text', () => {
    const toSafeAddonSyncRecord = exported<(installed: any, fields: any[], values: Record<string, unknown>) => any>('toSafeAddonSyncRecord');
    const record = toSafeAddonSyncRecord?.(
      installed,
      [
        { key: 'region', label: 'Region', type: 'text', required: false, secret: false },
        { key: 'accessToken', label: 'Access token', type: 'text', required: true, secret: false },
      ],
      {
        region: 'fr',
        accessToken: 'SHOULD-NOT-SYNC',
      },
    );

    expect(record?.safeConfig).toEqual({ region: 'fr' });
    expect(JSON.stringify(record)).not.toContain('SHOULD-NOT-SYNC');
  });

  it('omits configured manifest URLs that appear to contain provider credentials', () => {
    const toSafeAddonSyncRecord = exported<(installed: any, fields: any[], values: Record<string, unknown>) => any>('toSafeAddonSyncRecord');
    const record = toSafeAddonSyncRecord?.(
      {
        ...installed,
        manifestUrl: 'https://provider.example/realdebrid=LOCAL-SECRET/manifest.json',
      },
      [],
      {},
    );

    expect(record?.manifestUrl).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain('LOCAL-SECRET');
  });


it('omits even short opaque manifest paths when the provider is configurable', () => {
  const toSafeAddonSyncRecord = exported<(installed: any, fields: any[], values: Record<string, unknown>, descriptor?: any) => any>('toSafeAddonSyncRecord');
  const descriptor = {
    id: 'org.example.configurable',
    name: 'Configurable',
    version: '1.0.0',
    sourceType: 'stremio-manifest',
    capabilities: ['stream'],
    requiresConfiguration: false,
    configurable: true,
    configurationFields: [],
    supportedMediaKinds: ['movie'],
    manifestUrl: 'https://provider.example/a1b2c3/manifest.json',
  };

  const record = toSafeAddonSyncRecord?.(
    {
      ...installed,
      addonId: descriptor.id,
      manifestUrl: descriptor.manifestUrl,
    },
    [],
    {},
    descriptor,
  );

  expect(record?.manifestUrl).toBeUndefined();
});


it('omits hex-like manifest path tokens from sync metadata', () => {
  const safeManifestUrlForSync = exported<
    (manifestUrl?: string) => string | undefined
  >('safeManifestUrlForSync');

  expect(safeManifestUrlForSync).toBeDefined();
  expect(
    safeManifestUrlForSync?.(
      'https://provider.example/0123456789abcdef0123456789abcdef/manifest.json',
    ),
  ).toBeUndefined();
});


test('keeps short opaque configured manifest paths local while public preset paths remain sync-safe', () => {
  const safeManifestUrlForSync = exported<
    (manifestUrl?: string) => string | undefined
  >('safeManifestUrlForSync');

  expect(
    safeManifestUrlForSync?.(
      'https://provider.example/A1b2C3d4E5f6/manifest.json',
    ),
  ).toBeUndefined();
  expect(
    safeManifestUrlForSync?.(
      'https://provider.example/cfg-fr-al-bk/manifest.json',
    ),
  ).toBe(
    'https://provider.example/cfg-fr-al-bk/manifest.json',
  );
  expect(
    safeManifestUrlForSync?.(
      'https://catalog.example/manifest.json',
    ),
  ).toBe(
    'https://catalog.example/manifest.json',
  );
});

test('safe provider sync omits URLs above the normalized URL ceiling', () => {
  const safeManifestUrlForSync = exported<
    (manifestUrl?: string) => string | undefined
  >('safeManifestUrlForSync');
  expect(safeManifestUrlForSync).toBeDefined();

  const expanded =
    `https://provider.example/${'é'.repeat(2_000)}/manifest.json`;
  expect(expanded.length).toBeLessThan(8_192);
  expect(safeManifestUrlForSync?.(expanded)).toBeUndefined();
});


test('local provider config can keep loopback URLs without syncing them', () => {
  const sanitizeAddonConfig = exported<
    (
      fields: any[],
      values: Record<string, unknown>,
    ) => Record<string, unknown>
  >('sanitizeAddonConfig');
  const toSafeAddonSyncRecord = exported<
    (
      installed: any,
      fields: any[],
      values: Record<string, unknown>,
    ) => any
  >('toSafeAddonSyncRecord');
  const localFields = [{
    key: 'endpoint',
    label: 'Endpoint',
    type: 'url',
    required: true,
    secret: false,
  }];
  const localValues = {
    endpoint: 'http://127.0.0.1:7000/api',
  };

  expect(
    sanitizeAddonConfig?.(localFields, localValues),
  ).toEqual({
    endpoint: 'http://127.0.0.1:7000/api',
  });

  expect(
    toSafeAddonSyncRecord?.(
      installed,
      localFields,
      localValues,
    ).safeConfig,
  ).toEqual({});
});

test('plaintext provider config never keeps credential-shaped values', () => {
  const sanitizeAddonConfig = exported<
    (
      fields: any[],
      values: Record<string, unknown>,
    ) => Record<string, unknown>
  >('sanitizeAddonConfig');

  expect(sanitizeAddonConfig?.(
    [{
      key: 'note',
      label: 'Note',
      type: 'text',
      required: false,
      secret: false,
    }],
    {
      note: 'token=LOCAL-SECRET',
    },
  )).toEqual({});
});

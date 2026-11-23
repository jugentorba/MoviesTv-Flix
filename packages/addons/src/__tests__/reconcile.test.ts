import * as addons from '../index';

function exported<T>(name: string): T | undefined {
  return (addons as any)[name] as T | undefined;
}

const descriptor = {
  id: 'org.example.one',
  name: 'Example',
  version: '1.0.0',
  sourceType: 'stremio-manifest' as const,
  capabilities: ['stream' as const],
  requiresConfiguration: false,
  configurationFields: [],
  supportedMediaKinds: ['movie' as const],
};

function local(updatedAt: string, overrides: Record<string, unknown> = {}) {
  return {
    installed: {
      addonId: 'org.example.one',
      manifestUrl: 'https://example.com/manifest.json',
      sourceType: 'stremio-manifest' as const,
      enabled: false,
      priority: 10,
      installedAt: '2026-09-05T15:00:00.000Z',
      updatedAt,
      setupIncomplete: false,
      ...overrides,
    },
    safeConfig: { region: 'fr' },
    descriptor,
  };
}

function remote(updatedAt: string, overrides: Record<string, unknown> = {}) {
  return {
    addonId: 'org.example.one',
    manifestUrl: 'https://example.com/manifest.json',
    sourceType: 'stremio-manifest' as const,
    enabled: true,
    priority: 50,
    safeConfig: { region: 'al' },
    setupIncomplete: false,
    updatedAt,
    ...overrides,
  };
}

describe('reconcileInstalledAddons', () => {
  it('uses newer remote safe metadata while preserving the local descriptor and installedAt', () => {
    const reconcileInstalledAddons = exported<(local: any[], remote: any[], configured: Set<string>) => any[]>('reconcileInstalledAddons');
    expect(reconcileInstalledAddons).toBeDefined();

    const result = reconcileInstalledAddons?.(
      [local('2026-09-05T15:10:00.000Z')],
      [remote('2026-09-05T16:00:00.000Z')],
      new Set(['org.example.one']),
    );

    expect(result).toEqual([
      expect.objectContaining({
        safeConfig: { region: 'al' },
        descriptor,
        installed: expect.objectContaining({
          enabled: true,
          priority: 50,
          installedAt: '2026-09-05T15:00:00.000Z',
          updatedAt: '2026-09-05T16:00:00.000Z',
        }),
      }),
    ]);
  });

  it('uses remote safe metadata as the deterministic equal-timestamp tie breaker', () => {
    const reconcileInstalledAddons = exported<(local: any[], remote: any[], configured: Set<string>) => any[]>('reconcileInstalledAddons');
    expect(reconcileInstalledAddons).toBeDefined();

    const tiedAt = '2026-09-22T10:00:00.000Z';
    const result = reconcileInstalledAddons?.(
      [local(tiedAt, { enabled: false, priority: 90 })],
      [remote(tiedAt, { enabled: true, priority: 50 })],
      new Set(['org.example.one']),
    );

    expect(result?.[0]).toEqual(expect.objectContaining({
      safeConfig: { region: 'al' },
      installed: expect.objectContaining({
        enabled: true,
        priority: 50,
        updatedAt: tiedAt,
      }),
    }));
  });

  it('keeps newer local safe metadata when the cloud copy is older', () => {
    const reconcileInstalledAddons = exported<(local: any[], remote: any[], configured: Set<string>) => any[]>('reconcileInstalledAddons');
    expect(reconcileInstalledAddons).toBeDefined();
    const result = reconcileInstalledAddons?.(
      [local('2026-09-05T17:00:00.000Z', { enabled: false, priority: 90 })],
      [remote('2026-09-05T16:00:00.000Z')],
      new Set(['org.example.one']),
    );
    expect(result?.[0]).toEqual(expect.objectContaining({
      safeConfig: { region: 'fr' },
      installed: expect.objectContaining({ enabled: false, priority: 90, updatedAt: '2026-09-05T17:00:00.000Z' }),
    }));
  });

  it('forces a required-secret provider incomplete and disabled when this device lacks its secret', () => {
    const reconcileInstalledAddons = exported<(local: any[], remote: any[], configured: Set<string>) => any[]>('reconcileInstalledAddons');
    expect(reconcileInstalledAddons).toBeDefined();
    const secretDescriptor = {
      ...descriptor,
      requiresConfiguration: true,
      configurationFields: [
        { key: 'token', label: 'Token', type: 'secret' as const, required: true, secret: true },
      ],
    };
    const localSecretProvider = { ...local('2026-09-05T15:10:00.000Z'), descriptor: secretDescriptor };
    const result = reconcileInstalledAddons?.(
      [localSecretProvider],
      [remote('2026-09-05T16:00:00.000Z', { enabled: true, setupIncomplete: false })],
      new Set(),
    );
    expect(result?.[0].installed).toEqual(expect.objectContaining({
      enabled: false,
      setupIncomplete: true,
    }));
  });

  it('allows the synchronized enabled state when this device has the required local secret', () => {
    const reconcileInstalledAddons = exported<(local: any[], remote: any[], configured: Set<string>) => any[]>('reconcileInstalledAddons');
    expect(reconcileInstalledAddons).toBeDefined();
    const secretDescriptor = {
      ...descriptor,
      requiresConfiguration: true,
      configurationFields: [
        { key: 'token', label: 'Token', type: 'secret' as const, required: true, secret: true },
      ],
    };
    const result = reconcileInstalledAddons?.(
      [{ ...local('2026-09-05T15:10:00.000Z'), descriptor: secretDescriptor }],
      [remote('2026-09-05T16:00:00.000Z')],
      new Set(['org.example.one']),
    );
    expect(result?.[0].installed).toEqual(expect.objectContaining({ enabled: true, setupIncomplete: false }));
  });

  it('keeps a configurable remote-only provider incomplete while preserving its synced toggle', () => {
    const reconcileInstalledAddons = exported<(local: any[], remote: any[], configured: Set<string>) => any[]>('reconcileInstalledAddons');
    expect(reconcileInstalledAddons).toBeDefined();
    const result = reconcileInstalledAddons?.([], [remote('2026-09-05T16:00:00.000Z', {
      enabled: true,
      identity: {
        name: 'Example',
        capabilities: ['stream'],
        supportedMediaKinds: ['movie'],
        configurable: true,
      },
    })], new Set());
    expect(result?.[0]).toEqual(expect.objectContaining({
      descriptor: undefined,
      installed: expect.objectContaining({ enabled: true, setupIncomplete: true }),
    }));

    const disabled = reconcileInstalledAddons?.([], [remote('2026-09-05T16:00:00.000Z', {
      enabled: false,
      identity: {
        name: 'Example',
        capabilities: ['stream'],
        supportedMediaKinds: ['movie'],
        configurable: true,
      },
    })], new Set());
    expect(disabled?.[0]?.installed).toEqual(expect.objectContaining({
      enabled: false,
      setupIncomplete: true,
    }));
  });

  it('preserves a legacy public remote enabled state until its manifest is revalidated', () => {
    const reconcileInstalledAddons = exported<(local: any[], remote: any[], configured: Set<string>) => any[]>('reconcileInstalledAddons');
    expect(reconcileInstalledAddons).toBeDefined();

    const result = reconcileInstalledAddons?.(
      [],
      [remote('2026-09-05T16:00:00.000Z', { enabled: true })],
      new Set(),
    );

    expect(result?.[0]).toEqual(expect.objectContaining({
      descriptor: undefined,
      syncIdentity: undefined,
      installed: expect.objectContaining({
        enabled: true,
        setupIncomplete: false,
      }),
    }));
  });

  it('preserves a safe public remote enabled state while its manifest is revalidated', () => {
    const reconcileInstalledAddons = exported<(local: any[], remote: any[], configured: Set<string>) => any[]>('reconcileInstalledAddons');
    expect(reconcileInstalledAddons).toBeDefined();

    const result = reconcileInstalledAddons?.([], [
      remote('2026-09-05T16:00:00.000Z', {
        identity: {
          name: 'Example',
          capabilities: ['stream'],
          supportedMediaKinds: ['movie'],
          configurable: false,
        },
      }),
    ], new Set());

    expect(result?.[0]).toEqual(expect.objectContaining({
      descriptor: undefined,
      syncIdentity: expect.objectContaining({ configurable: false }),
      installed: expect.objectContaining({
        enabled: true,
        setupIncomplete: false,
      }),
    }));
  });
});

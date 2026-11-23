import type { SafeAddonSyncRecord } from '@moviestv/addons';
import { SupabaseAddonSyncGateway } from '../SupabaseAddonSyncGateway';

describe('SupabaseAddonSyncGateway', () => {
  it('maps only explicit safe fields into cloud upsert payloads', async () => {
    const upsert = jest.fn(async (_payload: unknown) => ({ error: null }));
    const client = {
      from: jest.fn(() => ({ upsert })),
    };
    const gateway = new SupabaseAddonSyncGateway(client as never);
    const record = {
      addonId: 'org.example.one',
      manifestUrl: 'https://example.com/manifest.json',
      sourceType: 'stremio-manifest' as const,
      enabled: true,
      priority: 50,
      safeConfig: { region: 'fr' },
      setupIncomplete: false,
      updatedAt: '2026-09-15T11:40:00.000Z',
      runtimeSecret: 'DO-NOT-SYNC',
    };

    await gateway.upsert('user-1', record);

    expect(client.from).toHaveBeenCalledWith('user_addons');
    expect(upsert).toHaveBeenCalledWith({
      user_id: 'user-1',
      addon_id: 'org.example.one',
      manifest_url: 'https://example.com/manifest.json',
      source_type: 'stremio-manifest',
      enabled: true,
      priority: 50,
      safe_config: { region: 'fr' },
      setup_incomplete: false,
      updated_at: '2026-09-15T11:40:00.000Z',
      provider_name: null,
      capabilities: [],
      media_kinds: [],
      configurable: false,
    });
    expect(JSON.stringify(upsert.mock.calls[0]?.[0])).not.toContain('DO-NOT-SYNC');
  });

  it('maps cloud rows back into the safe synchronization contract', async () => {
    const row = {
      addon_id: 'org.example.one',
      manifest_url: 'https://example.com/manifest.json',
      source_type: 'stremio-manifest',
      enabled: false,
      priority: 20,
      safe_config: { region: 'al', flag: true, ignored: 42 },
      setup_incomplete: true,
      updated_at: '2026-09-15T11:41:00.000Z',
    };
    const order = jest.fn(async () => ({ data: [row], error: null }));
    const eq = jest.fn(() => ({ order }));
    const select = jest.fn(() => ({ eq }));
    const client = { from: jest.fn(() => ({ select })) };
    const gateway = new SupabaseAddonSyncGateway(client as never);

    const expected: SafeAddonSyncRecord[] = [{
      addonId: 'org.example.one',
      manifestUrl: 'https://example.com/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: false,
      priority: 20,
      safeConfig: { region: 'al', flag: true },
      setupIncomplete: true,
      updatedAt: '2026-09-15T11:41:00.000Z',
    }];
    await expect(gateway.list('user-1')).resolves.toEqual(expected);
  });

  it('scopes delete operations to both the signed-in user and provider id', async () => {
    const secondEq = jest.fn(async () => ({ error: null }));
    const firstEq = jest.fn(() => ({ eq: secondEq }));
    const remove = jest.fn(() => ({ eq: firstEq }));
    const client = { from: jest.fn(() => ({ delete: remove })) };
    const gateway = new SupabaseAddonSyncGateway(client as never);

    await gateway.remove('user-1', 'org.example.one');

    expect(remove).toHaveBeenCalledTimes(1);
    expect(firstEq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(secondEq).toHaveBeenCalledWith('addon_id', 'org.example.one');
  });
});

it('conditionally deletes a provider only when the cloud row is not newer', async () => {
  const select = jest.fn(async () => ({
    data: [{ addon_id: 'org.example.one' }],
    error: null,
  }));
  const lte = jest.fn(() => ({ select }));
  const secondEq = jest.fn(() => ({ lte }));
  const firstEq = jest.fn(() => ({ eq: secondEq }));
  const remove = jest.fn(() => ({ eq: firstEq }));
  const gateway = new SupabaseAddonSyncGateway({
    from: jest.fn(() => ({ delete: remove })),
  } as never);

  await expect(gateway.remove(
    'user-1',
    'org.example.one',
    '2026-09-20T14:00:00.000Z',
  )).resolves.toBe(true);

  expect(firstEq).toHaveBeenCalledWith('user_id', 'user-1');
  expect(secondEq).toHaveBeenCalledWith(
    'addon_id',
    'org.example.one',
  );
  expect(lte).toHaveBeenCalledWith(
    'updated_at',
    '2026-09-20T14:00:00.000Z',
  );
  expect(select).toHaveBeenCalledWith('addon_id');
});

it('reports a blocked conditional provider delete when no row matched', async () => {
  const select = jest.fn(async () => ({
    data: [],
    error: null,
  }));
  const lte = jest.fn(() => ({ select }));
  const secondEq = jest.fn(() => ({ lte }));
  const firstEq = jest.fn(() => ({ eq: secondEq }));
  const remove = jest.fn(() => ({ eq: firstEq }));
  const gateway = new SupabaseAddonSyncGateway({
    from: jest.fn(() => ({ delete: remove })),
  } as never);

  await expect(gateway.remove(
    'user-1',
    'org.example.one',
    '2026-09-20T14:00:00.000Z',
  )).resolves.toBe(false);
});


  it('drops legacy credential-like manifest URLs and token-like config keys on readback', async () => {
    const row = {
      addon_id: 'org.example.legacy',
      manifest_url: 'https://provider.example/realdebrid=LEGACY-SECRET/manifest.json',
      source_type: 'stremio-manifest',
      enabled: true,
      priority: 90,
      safe_config: {
        region: 'fr',
        apiKey: 'LEGACY-KEY',
        access_token: 'LEGACY-TOKEN',
      },
      setup_incomplete: false,
      updated_at: '2026-09-19T12:00:00.000Z',
    };
    const order = jest.fn(async () => ({ data: [row], error: null }));
    const eq = jest.fn(() => ({ order }));
    const select = jest.fn(() => ({ eq }));
    const client = { from: jest.fn(() => ({ select })) };
    const gateway = new SupabaseAddonSyncGateway(client as never);

    const result = await gateway.list('user-1');

    expect(result).toEqual([expect.objectContaining({
      addonId: 'org.example.legacy',
      safeConfig: { region: 'fr' },
    })]);
    expect(result[0]?.manifestUrl).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('LEGACY-SECRET');
    expect(JSON.stringify(result)).not.toContain('LEGACY-KEY');
    expect(JSON.stringify(result)).not.toContain('LEGACY-TOKEN');
  });


  it('sanitizes unsafe values even when upsert is called directly', async () => {
    const upsert = jest.fn(async (_payload: unknown) => ({ error: null }));
    const client = { from: jest.fn(() => ({ upsert })) };
    const gateway = new SupabaseAddonSyncGateway(client as never);

    await gateway.upsert('user-1', {
      addonId: 'org.example.unsafe',
      manifestUrl: 'https://provider.example/realdebrid=SECRET/manifest.json',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 10,
      safeConfig: {
        region: 'fr',
        apiKey: 'SECRET-KEY',
      },
      setupIncomplete: false,
      updatedAt: '2026-09-19T12:10:00.000Z',
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      manifest_url: null,
      safe_config: { region: 'fr' },
    }));
    expect(JSON.stringify(upsert.mock.calls[0]?.[0])).not.toContain('SECRET');
  });


it('round-trips only non-secret provider identity metadata', async () => {
  const row = {
    addon_id: 'org.example.remote',
    manifest_url: null,
    source_type: 'stremio-manifest',
    enabled: false,
    priority: 80,
    safe_config: {},
    setup_incomplete: true,
    updated_at: '2026-09-19T18:30:00.000Z',
    provider_name: 'Remote Provider',
    capabilities: ['stream', 'subtitle', 'invalid-capability'],
    media_kinds: ['movie', 'series', 'episode'],
    configurable: true,
  };
  const order = jest.fn(async () => ({ data: [row], error: null }));
  const eq = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ eq }));
  const gateway = new SupabaseAddonSyncGateway({
    from: jest.fn(() => ({ select })),
  } as never);

  await expect(gateway.list('user-1')).resolves.toEqual([{
    addonId: 'org.example.remote',
    sourceType: 'stremio-manifest',
    enabled: false,
    priority: 80,
    safeConfig: {},
    setupIncomplete: true,
    updatedAt: '2026-09-19T18:30:00.000Z',
    identity: {
      name: 'Remote Provider',
      capabilities: ['stream', 'subtitle'],
      supportedMediaKinds: ['movie', 'series'],
      configurable: true,
    },
  }]);
});

it('writes safe provider identity without any runtime descriptor or credentials', async () => {
  const upsert = jest.fn(async (_payload: unknown) => ({ error: null }));
  const gateway = new SupabaseAddonSyncGateway({
    from: jest.fn(() => ({ upsert })),
  } as never);

  await gateway.upsert('user-1', {
    addonId: 'org.example.remote',
    sourceType: 'stremio-manifest',
    enabled: false,
    priority: 80,
    safeConfig: {},
    setupIncomplete: true,
    updatedAt: '2026-09-19T18:30:00.000Z',
    identity: {
      name: 'Remote Provider',
      capabilities: ['stream', 'subtitle'],
      supportedMediaKinds: ['movie', 'series'],
      configurable: true,
    },
  });

  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
    provider_name: 'Remote Provider',
    capabilities: ['stream', 'subtitle'],
    media_kinds: ['movie', 'series'],
    configurable: true,
  }));
  expect(JSON.stringify(upsert.mock.calls[0]?.[0])).not.toMatch(/descriptor|token|secret/i);
});


test('drops malformed cloud provider rows and bounds synchronized row count', async () => {
  const rows = Array.from({ length: 505 }, (_, index) => ({
    addon_id: `org.example.${index}`,
    manifest_url: 'https://example.com/manifest.json',
    source_type: 'stremio-manifest',
    enabled: true,
    priority: index,
    safe_config: {
      region: 'fr',
      accessToken: 'MUST-NOT-SYNC',
    },
    setup_incomplete: false,
    updated_at: '2026-09-21T18:00:00.000Z',
    provider_name: `Provider ${index}`,
    capabilities: ['stream', 'stream', 'subtitle'],
    media_kinds: ['movie', 'movie', 'series'],
    configurable: false,
  }));
  rows[0] = {
    ...rows[0],
    addon_id: 'x'.repeat(513),
  };
  rows[1] = {
    ...rows[1],
    updated_at: 'not-a-date',
  };

  const order = jest.fn(async () => ({ data: rows, error: null }));
  const eq = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ eq }));
  const gateway = new SupabaseAddonSyncGateway({
    from: jest.fn(() => ({ select })),
  } as never);

  const result = await gateway.list('user-1');

  expect(result).toHaveLength(498);
  expect(result[0]?.identity?.capabilities).toEqual([
    'stream',
    'subtitle',
  ]);
  expect(result[0]?.identity?.supportedMediaKinds).toEqual([
    'movie',
    'series',
  ]);
  expect(JSON.stringify(result)).not.toContain('MUST-NOT-SYNC');
});

test('rejects invalid provider sync writes before calling Supabase', async () => {
  const from = jest.fn();
  const gateway = new SupabaseAddonSyncGateway({ from } as never);

  await expect(gateway.upsert('user-1', {
    addonId: 'bad\u0000id',
    sourceType: 'stremio-manifest',
    enabled: true,
    priority: 10,
    safeConfig: {},
    setupIncomplete: false,
    updatedAt: '2026-09-21T18:00:00.000Z',
  })).rejects.toThrow('Provider sync record is invalid');

  await expect(gateway.remove(
    'user-1',
    'org.example.one',
    'not-a-date',
  )).rejects.toThrow('removal timestamp is invalid');

  expect(from).not.toHaveBeenCalled();
});


test('validates and normalizes provider sync user ids before Supabase access', async () => {
  const from = jest.fn();
  const gateway = new SupabaseAddonSyncGateway({ from } as never);
  const validRecord: SafeAddonSyncRecord = {
    addonId: 'org.example.one',
    sourceType: 'stremio-manifest',
    enabled: true,
    priority: 10,
    safeConfig: {},
    setupIncomplete: false,
    updatedAt: '2026-09-22T10:00:00.000Z',
  };

  for (const userId of [
    '',
    '   ',
    'bad\u0000user',
    'x'.repeat(513),
  ]) {
    await expect(gateway.list(userId))
      .rejects.toThrow('Provider sync user id is invalid');
    await expect(gateway.upsert(userId, validRecord))
      .rejects.toThrow('Provider sync user id is invalid');
    await expect(gateway.remove(userId, validRecord.addonId))
      .rejects.toThrow('Provider sync user id is invalid');
  }

  expect(from).not.toHaveBeenCalled();
});

test('trims provider sync user ids before query scoping', async () => {
  const order = jest.fn(async () => ({ data: [], error: null }));
  const eq = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ eq }));
  const gateway = new SupabaseAddonSyncGateway({
    from: jest.fn(() => ({ select })),
  } as never);

  await gateway.list(' user-1 ');

  expect(eq).toHaveBeenCalledWith('user_id', 'user-1');
});


test('bounds provider sync rows in the Supabase query', async () => {
  const limit = jest.fn(async () => ({ data: [], error: null }));
  const order = jest.fn(() => ({ limit }));
  const eq = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ eq }));
  const gateway = new SupabaseAddonSyncGateway({
    from: jest.fn(() => ({ select })),
  } as never);

  await gateway.list('user-1');

  expect(limit).toHaveBeenCalledWith(500);
});


test('times out stalled provider cloud list requests', async () => {
  const order = jest.fn(() => new Promise(() => undefined));
  const eq = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ eq }));
  const gateway = new SupabaseAddonSyncGateway({
    from: jest.fn(() => ({ select })),
  } as never, 2);

  await expect(gateway.list('user-1'))
    .rejects.toThrow('Provider synchronization timed out');
});

test('times out stalled provider cloud upserts', async () => {
  const upsert = jest.fn(() => new Promise(() => undefined));
  const gateway = new SupabaseAddonSyncGateway({
    from: jest.fn(() => ({ upsert })),
  } as never, 2);

  await expect(gateway.upsert('user-1', {
    addonId: 'org.example.timeout',
    sourceType: 'stremio-manifest',
    enabled: true,
    priority: 10,
    safeConfig: {},
    setupIncomplete: false,
    updatedAt: '2026-09-22T10:00:00.000Z',
  })).rejects.toThrow('Provider synchronization timed out');
});

test('times out stalled provider cloud removals', async () => {
  const secondEq = jest.fn(() => new Promise(() => undefined));
  const firstEq = jest.fn(() => ({ eq: secondEq }));
  const remove = jest.fn(() => ({ eq: firstEq }));
  const gateway = new SupabaseAddonSyncGateway({
    from: jest.fn(() => ({ delete: remove })),
  } as never, 2);

  await expect(
    gateway.remove('user-1', 'org.example.timeout'),
  ).rejects.toThrow('Provider synchronization timed out');
});


test('drops credential-bearing safe-config values on cloud read and direct write', async () => {
  const row = {
    addon_id: 'org.example.legacy-value',
    manifest_url: 'https://example.com/manifest.json',
    source_type: 'stremio-manifest',
    enabled: true,
    priority: 10,
    safe_config: {
      region: 'fr',
      endpoint:
        'https://api.example/config?token=LEGACY-SECRET',
      pathEndpoint:
        'https://api.example/token=fixture-value/config',
      note: 'token=LEGACY-PLAIN',
      localEndpoint: 'http://127.0.0.1:7000/api',
      scriptEndpoint: 'javascript:alert(1)',
    },
    setup_incomplete: false,
    updated_at: '2026-09-22T10:00:00.000Z',
  };
  const order = jest.fn(async () => ({ data: [row], error: null }));
  const eq = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ eq }));
  const readGateway = new SupabaseAddonSyncGateway({
    from: jest.fn(() => ({ select })),
  } as never);

  await expect(readGateway.list('user-1')).resolves.toEqual([
    expect.objectContaining({
      safeConfig: { region: 'fr' },
    }),
  ]);

  const upsert = jest.fn(async (_payload: unknown) => ({ error: null }));
  const writeGateway = new SupabaseAddonSyncGateway({
    from: jest.fn(() => ({ upsert })),
  } as never);
  await writeGateway.upsert('user-1', {
    addonId: 'org.example.direct',
    sourceType: 'stremio-manifest',
    enabled: true,
    priority: 10,
    safeConfig: {
      region: 'al',
      endpoint:
        'https://api.example/config?key=LOCAL-SECRET',
      pathEndpoint:
        'https://api.example/token=fixture-value/config',
      note: 'secret=LOCAL-PLAIN',
      localEndpoint: 'http://127.0.0.1:7000/api',
      scriptEndpoint: 'javascript:alert(1)',
    },
    setupIncomplete: false,
    updatedAt: '2026-09-22T10:00:00.000Z',
  });

  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
    safe_config: { region: 'al' },
  }));
  expect(JSON.stringify(upsert.mock.calls[0]?.[0]))
    .not.toContain('LOCAL-SECRET');
  expect(JSON.stringify(upsert.mock.calls[0]?.[0]))
    .not.toContain('LOCAL-PLAIN');
});

import type { AddonStateRecord } from '@moviestv/addons';
import type { LiveTvProviderDescriptor } from '@moviestv/live-tv';
import {
  createLiveTvProviders,
  mergeLiveTvProviders,
  sameLiveTvProviders,
} from '../live-tv-providers';

const liveTv = {
  catalogs: [{ type: 'channel' as const, id: 'all', name: 'All Channels' }],
  streamTypes: ['channel' as const],
};

function record(
  id: string,
  priority: number,
  options: { enabled?: boolean; setupIncomplete?: boolean; liveTv?: boolean; hydrated?: boolean; manifest?: boolean } = {},
): AddonStateRecord {
  const enabled = options.enabled ?? true;
  const setupIncomplete = options.setupIncomplete ?? false;
  const hasLiveTv = options.liveTv ?? true;
  const hydrated = options.hydrated ?? true;
  const hasManifest = options.manifest ?? true;
  return {
    installed: {
      addonId: id,
      ...(hasManifest ? { manifestUrl: `https://${id}.example/manifest.json` } : {}),
      sourceType: 'stremio-manifest',
      enabled,
      priority,
      installedAt: '2026-09-18T00:00:00Z',
      updatedAt: '2026-09-18T00:00:00Z',
      setupIncomplete,
    },
    safeConfig: {},
    ...(hydrated ? {
      descriptor: {
        id,
        name: id,
        version: '1.0.0',
        sourceType: 'stremio-manifest',
        capabilities: hasLiveTv ? ['live-tv'] : ['stream'],
        requiresConfiguration: false,
        configurationFields: [],
        supportedMediaKinds: hasLiveTv ? [] : ['movie'],
        ...(hasManifest ? { manifestUrl: `https://${id}.example/manifest.json` } : {}),
        ...(hasLiveTv ? { liveTv } : {}),
      },
    } : {}),
  };
}

describe('createLiveTvProviders', () => {
  it('returns only enabled configured hydrated Live TV providers in priority order', () => {
    const result = createLiveTvProviders([
      record('low', 10),
      record('disabled', 500, { enabled: false }),
      record('incomplete', 400, { setupIncomplete: true }),
      record('movie', 300, { liveTv: false }),
      record('missing-descriptor', 200, { hydrated: false }),
      record('missing-manifest', 150, { manifest: false }),
      record('high', 100),
    ]);

    expect(result.map((provider) => provider.addonId)).toEqual(['high', 'low']);
    expect(result[0]).toEqual(expect.objectContaining({
      addonId: 'high',
      name: 'high',
      priority: 100,
      manifestUrl: 'https://high.example/manifest.json',
      liveTv,
    }));
  });
});


  it('keeps a securely hydrated Live TV provider whose endpoint is only on the runtime descriptor', () => {
    const secure = record('secure-tv', 250, { manifest: false });
    secure.descriptor = {
      ...secure.descriptor!,
      manifestUrl: 'https://secure-tv.example/configured=LOCAL/manifest.json',
    };

    expect(createLiveTvProviders([secure])).toEqual([
      expect.objectContaining({
        addonId: 'secure-tv',
        manifestUrl: 'https://secure-tv.example/configured=LOCAL/manifest.json',
        priority: 250,
      }),
    ]);
  });


test('keeps a hydrated TvVoo public country preset active', () => {
  const tvvoo = record('org.stremio.vavoo.clean', 300);
  tvvoo.installed = {
    ...tvvoo.installed,
    manifestUrl: 'https://tvvoo.hayd.uk/cfg-fr-al-bk/manifest.json',
  };
  tvvoo.descriptor = {
    ...tvvoo.descriptor!,
    id: 'org.stremio.vavoo.clean',
    name: 'TvVoo',
    manifestUrl: 'https://tvvoo.hayd.uk/cfg-fr-al-bk/manifest.json',
    configurable: true,
    configurationFields: [],
  };

  expect(createLiveTvProviders([tvvoo])).toEqual([
    expect.objectContaining({
      addonId: 'org.stremio.vavoo.clean',
      name: 'TvVoo',
      manifestUrl: 'https://tvvoo.hayd.uk/cfg-fr-al-bk/manifest.json',
      priority: 300,
    }),
  ]);
});

test('keeps manual loopback HTTP Live TV providers local to the device', () => {
  const local = record('local', 100);
  local.descriptor = {
    ...local.descriptor!,
    manifestUrl: 'http://127.0.0.1:7000/manifest.json',
  };

  expect(createLiveTvProviders([local])).toEqual([
    expect.objectContaining({
      addonId: 'local',
      manifestUrl: 'http://127.0.0.1:7000/manifest.json',
    }),
  ]);
});

test('filters insecure and blank Live TV providers', () => {
  const base: any = {
    installed: { enabled: true, setupIncomplete: false, addonId: 'good', priority: 1 },
    descriptor: { name: 'Good', manifestUrl: 'https://example.com/manifest.json', capabilities: ['live-tv'], liveTv: { catalogs: [], streamTypes: ['tv'] } },
  };
  expect(createLiveTvProviders([
    { ...base, installed: { ...base.installed, addonId: ' ' } },
    { ...base, installed: { ...base.installed, addonId: 'http' }, descriptor: { ...base.descriptor, manifestUrl: 'http://example.com/manifest.json' } },
    base,
  ])).toHaveLength(1);
});


test('filters Live TV providers whose normalized manifest URL is oversized', () => {
  const oversized = record('oversized', 100);
  const manifestUrl =
    `https://provider.example/${'é'.repeat(2_000)}/manifest.json`;
  expect(manifestUrl.length).toBeLessThan(8_192);
  oversized.descriptor = {
    ...oversized.descriptor!,
    manifestUrl,
  };

  expect(createLiveTvProviders([oversized])).toEqual([]);
});


test('keeps only the 100 highest-priority eligible Live TV providers', () => {
  const records = Array.from(
    { length: 105 },
    (_, index) => record(`provider-${index}`, index),
  );

  const result = createLiveTvProviders(records);

  expect(result).toHaveLength(100);
  expect(result[0]?.addonId).toBe('provider-104');
  expect(result.some((provider) => provider.addonId === 'provider-0'))
    .toBe(false);
});


test('isolates malformed Live TV capability metadata', () => {
  const malformed = record('broken', 200) as any;
  malformed.descriptor = {
    ...malformed.descriptor,
    capabilities: null,
  };

  const malformedShape = record('broken-shape', 150) as any;
  malformedShape.descriptor = {
    ...malformedShape.descriptor,
    liveTv: {
      catalogs: null,
      streamTypes: ['channel'],
    },
  };

  expect(() => createLiveTvProviders([
    malformed,
    malformedShape,
    record('healthy', 100),
  ])).not.toThrow();

  expect(
    createLiveTvProviders([
      malformed,
      malformedShape,
      record('healthy', 100),
    ]).map((provider) => provider.addonId),
  ).toEqual(['healthy']);
});

function provider(addonId: string, priority: number): LiveTvProviderDescriptor {
  return {
    addonId,
    name: addonId,
    manifestUrl: addonId.startsWith('m3u:') ? '' : `https://${addonId}.example/manifest.json`,
    priority,
    liveTv: { catalogs: [], streamTypes: ['channel'] },
    ...(addonId.startsWith('m3u:') ? { kind: 'playlist' as const } : {}),
  };
}

describe('mergeLiveTvProviders', () => {
  test('orders add-on and playlist providers together by priority', () => {
    expect(mergeLiveTvProviders(
      [provider('org.example.tv', 50)],
      [provider('m3u:one', 90), provider('m3u:two', 10)],
    ).map((item) => item.addonId)).toEqual(['m3u:one', 'org.example.tv', 'm3u:two']);
  });

  test('breaks priority ties by id so the order is stable', () => {
    const addon = [provider('org.b', 10), provider('org.a', 10)];
    const playlist = [provider('m3u:z', 10), provider('m3u:a', 10)];

    expect(mergeLiveTvProviders(addon, playlist).map((item) => item.addonId))
      .toEqual(['m3u:a', 'm3u:z', 'org.a', 'org.b']);
  });

  test('keeps the first entry when an id appears twice', () => {
    const first = { ...provider('org.example.tv', 50), name: 'First' };
    const second = { ...provider('org.example.tv', 50), name: 'Second' };

    const merged = mergeLiveTvProviders([first], [second]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe('First');
  });

  test('drops an entry with an empty id and handles no playlist providers', () => {
    expect(mergeLiveTvProviders([{ ...provider('org.a', 10), addonId: '  ' }], []))
      .toEqual([]);
    expect(mergeLiveTvProviders([provider('org.a', 10)], []))
      .toEqual([provider('org.a', 10)]);
  });
});

describe('sameLiveTvProviders', () => {
  test('is true for equal content even when the arrays differ', () => {
    expect(sameLiveTvProviders(
      [provider('org.a', 10), provider('m3u:one', 5)],
      [provider('org.a', 10), provider('m3u:one', 5)],
    )).toBe(true);
    expect(sameLiveTvProviders([], [])).toBe(true);
  });

  test('detects a different id, priority, name or kind', () => {
    const base = [provider('org.a', 10)];

    expect(sameLiveTvProviders(base, [provider('org.b', 10)])).toBe(false);
    expect(sameLiveTvProviders(base, [provider('org.a', 11)])).toBe(false);
    expect(sameLiveTvProviders(base, [{ ...provider('org.a', 10), name: 'Other' }]))
      .toBe(false);
    expect(sameLiveTvProviders(base, [{ ...provider('org.a', 10), kind: 'playlist' }]))
      .toBe(false);
    expect(sameLiveTvProviders(base, [])).toBe(false);
  });
});

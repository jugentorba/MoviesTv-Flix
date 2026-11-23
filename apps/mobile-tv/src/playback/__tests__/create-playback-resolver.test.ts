import type {
  AddonAdapter,
  AddonDescriptor,
  AddonStateRecord,
} from '@moviestv/addons';
import type { StreamSource } from '@moviestv/core';
import { createPlaybackResolver } from '../createPlaybackResolver';

const request = {
  mediaId: 'movie:550',
  kind: 'movie' as const,
  externalIds: { tmdb: '550', imdb: 'tt0137523' },
};

function descriptor(id: string): AddonDescriptor {
  return {
    id,
    name: id,
    version: '1.0.0',
    sourceType: 'stremio-manifest',
    capabilities: ['stream'],
    requiresConfiguration: false,
    configurationFields: [],
    supportedMediaKinds: ['movie'],
    manifestUrl: `https://${id}.example/manifest.json`,
    stream: { types: ['movie'], idPrefixes: ['tt'] },
  };
}

function record(
  id: string,
  priority: number,
  options: { hydrated?: boolean; sourceType?: 'stremio-manifest' | 'native' } = {},
): AddonStateRecord {
  const sourceType = options.sourceType ?? 'stremio-manifest';
  const addonDescriptor = options.hydrated === false || sourceType !== 'stremio-manifest'
    ? undefined
    : descriptor(id);

  return {
    installed: {
      addonId: id,
      ...(sourceType === 'stremio-manifest'
        ? { manifestUrl: `https://${id}.example/manifest.json` }
        : {}),
      sourceType,
      enabled: true,
      priority,
      installedAt: '2026-09-16T07:00:00.000Z',
      updatedAt: '2026-09-16T07:00:00.000Z',
      setupIncomplete: false,
    },
    safeConfig: {},
    descriptor: addonDescriptor,
  };
}

function source(providerId: string, suffix: string): StreamSource {
  return {
    id: `${providerId}:${suffix}`,
    providerId,
    url: `https://cdn.example/${providerId}/${suffix}.mp4`,
  };
}

test('builds playback resolution from hydrated Stremio providers in installed priority order', async () => {
  const highSource = source('high', '1');
  const lowSource = source('low', '1');
  const factory = jest.fn((addonDescriptor: AddonDescriptor): AddonAdapter => ({
    descriptor: () => addonDescriptor,
    resolve: jest.fn(async () => addonDescriptor.id === 'high' ? [highSource] : [lowSource]),
  }));

  const resolver = createPlaybackResolver([
    record('low', 10),
    record('unhydrated', 900, { hydrated: false }),
    record('native', 800, { sourceType: 'native' }),
    record('high', 100),
  ], factory);

  await expect(resolver.resolve(request)).resolves.toEqual([highSource, lowSource]);
  expect(factory.mock.calls.map(([addonDescriptor]) => addonDescriptor.id)).toEqual(['low', 'high']);
});


test('keeps catalog-native movie requests eligible for matching Stremio providers', async () => {
  const nativeRecord = record('native-catalog', 100);
  nativeRecord.descriptor = {
    ...nativeRecord.descriptor!,
    supportedMediaKinds: ['movie'],
    stream: {
      types: ['movie'],
      idPrefixes: ['custom:'],
    },
  };
  const nativeSource = source('native-catalog', '1');
  const resolve = jest.fn(async () => [nativeSource]);
  const factory = jest.fn((addonDescriptor: AddonDescriptor): AddonAdapter => ({
    descriptor: () => addonDescriptor,
    resolve,
  }));

  const resolver = createPlaybackResolver(
    [nativeRecord],
    factory,
  );

  await expect(resolver.resolve({
    mediaId: 'stremio-native:movie:custom%3A42',
    kind: 'movie',
    externalIds: {},
  })).resolves.toEqual([nativeSource]);

  expect(resolve).toHaveBeenCalledWith(
    {
      mediaId: 'stremio-native:movie:custom%3A42',
      kind: 'movie',
      externalIds: {},
    },
    expect.objectContaining({ timeoutMs: expect.any(Number) }),
  );
});

test('keeps catalog-native episode requests eligible for matching Stremio providers', async () => {
  const nativeRecord = record('native-series', 100);
  nativeRecord.descriptor = {
    ...nativeRecord.descriptor!,
    supportedMediaKinds: ['series'],
    stream: {
      types: ['series'],
      idPrefixes: ['custom:'],
    },
  };
  const nativeSource = source('native-series', '1');
  const resolve = jest.fn(async () => [nativeSource]);
  const factory = jest.fn((addonDescriptor: AddonDescriptor): AddonAdapter => ({
    descriptor: () => addonDescriptor,
    resolve,
  }));

  const resolver = createPlaybackResolver(
    [nativeRecord],
    factory,
  );
  const nativeRequest = {
    mediaId: 'custom:episode:1',
    seriesMediaId: 'stremio-native:series:custom%3Ashow-42',
    kind: 'episode' as const,
    externalIds: {},
    seasonNumber: 1,
    episodeNumber: 2,
  };

  await expect(resolver.resolve(nativeRequest))
    .resolves.toEqual([nativeSource]);
  expect(resolve).toHaveBeenCalledWith(
    nativeRequest,
    expect.objectContaining({ timeoutMs: expect.any(Number) }),
  );
});

test('skips an adapter construction failure without blocking healthy providers', async () => {
  const healthySource = source('healthy', '1');
  const factory = jest.fn((addonDescriptor: AddonDescriptor): AddonAdapter => {
    if (addonDescriptor.id === 'broken') {
      throw new Error('adapter construction failed');
    }
    return {
      descriptor: () => addonDescriptor,
      resolve: jest.fn(async () => [healthySource]),
    };
  });

  const resolver = createPlaybackResolver([
    record('broken', 200),
    record('healthy', 100),
  ], factory);

  await expect(resolver.resolve(request)).resolves.toEqual([
    healthySource,
  ]);
  expect(factory).toHaveBeenCalledTimes(2);
});

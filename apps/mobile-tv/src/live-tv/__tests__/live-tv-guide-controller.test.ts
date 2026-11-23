import type {
  GuideSnapshot,
  LiveTvChannel,
  LiveTvProviderDescriptor,
} from '@moviestv/live-tv';
import { LiveTvGuideController } from '../LiveTvGuideController';
import type { LiveTvBrowserChannel } from '../live-tv-aggregation';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = Date.UTC(2026, 8, 14, 18, 30, 0);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function channel(): LiveTvChannel {
  return {
    id: 'provider-a:channel:fr2.remote',
    title: 'France 2',
    countryCode: 'FR',
    providerId: 'provider-a',
    resourceType: 'channel',
    remoteId: 'fr2.remote',
  };
}

function snapshot(
  fetchedAtMs = NOW - 10 * MINUTE,
  sourceRevision = 1,
): GuideSnapshot {
  return {
    sourceRevision,
    fetchedAtMs,
    channels: [{
      id: 'fr2.remote',
      displayNames: ['France 2'],
      countryCode: 'FR',
    }],
    programmes: [
      {
        channelId: 'fr2.remote',
        title: 'Journal',
        startAtMs: NOW - 30 * MINUTE,
        endAtMs: NOW + 15 * MINUTE,
      },
      {
        channelId: 'fr2.remote',
        title: 'Film',
        startAtMs: NOW + 15 * MINUTE,
        endAtMs: NOW + 2 * HOUR,
      },
    ],
  };
}

function repository(options: {
  configured?: boolean;
  revision?: number;
  url?: string | null;
  cache?: GuideSnapshot | null;
} = {}) {
  let cache = options.cache ?? null;
  return {
    loadConfig: jest.fn(async () => (
      options.configured === false
        ? { configured: false, sourceRevision: 0, secure: false }
        : {
          configured: true,
          sourceRevision: options.revision ?? 1,
          secure: Boolean(options.url?.includes('?')),
          ...(options.url?.includes('?')
            ? {}
            : { publicUrl: options.url ?? 'https://guide.example/epg.xml' }),
        }
    )),
    resolveUrl: jest.fn(async () => (
      options.url === undefined ? 'https://guide.example/epg.xml' : options.url
    )),
    loadCache: jest.fn(async (revision: number) => (
      cache?.sourceRevision === revision ? cache : null
    )),
    saveCache: jest.fn(async (next: GuideSnapshot) => {
      cache = next;
    }),
  };
}

function provider(result: GuideSnapshot | Error) {
  return {
    load: jest.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

describe('LiveTvGuideController', () => {
  test('returns unconfigured without network when no guide is configured', async () => {
    const repo = repository({ configured: false });
    const source = provider(snapshot());
    const controller = new LiveTvGuideController(repo as any, source as any);

    const state = await controller.load([channel()], NOW);

    expect(state.status).toBe('unconfigured');
    expect(state.matches.size).toBe(0);
    expect(source.load).not.toHaveBeenCalled();
  });

  test('reuses a cache younger than thirty minutes', async () => {
    const cached = snapshot(NOW - 29 * MINUTE);
    const repo = repository({ cache: cached });
    const source = provider(snapshot(NOW));
    const controller = new LiveTvGuideController(repo as any, source as any);

    const state = await controller.load([channel()], NOW);

    expect(state.status).toBe('ready');
    expect(state.snapshot).toEqual(cached);
    expect(state.matches.get(channel().id)).toBe('fr2.remote');
    expect(source.load).not.toHaveBeenCalled();
  });

  test('refreshes stale cache and saves the fresh snapshot', async () => {
    const cached = snapshot(NOW - 31 * MINUTE);
    const fresh = snapshot(NOW);
    const repo = repository({ cache: cached });
    const source = provider(fresh);
    const controller = new LiveTvGuideController(repo as any, source as any);

    const state = await controller.load([channel()], NOW);

    expect(source.load).toHaveBeenCalledWith(
      'https://guide.example/epg.xml',
      1,
    );
    expect(repo.saveCache).toHaveBeenCalledWith(fresh);
    expect(state.status).toBe('ready');
    expect(state.snapshot).toEqual(fresh);
  });

  test('falls back to cache for up to six hours on refresh failure', async () => {
    const cached = snapshot(NOW - 5 * HOUR - 59 * MINUTE);
    const repo = repository({ cache: cached });
    const source = provider(new Error('offline'));
    const controller = new LiveTvGuideController(repo as any, source as any);

    const state = await controller.load([channel()], NOW);

    expect(state.status).toBe('stale');
    expect(state.snapshot).toEqual(cached);
    expect(state.message).toContain('outdated');
    expect(state.matches.get(channel().id)).toBe('fr2.remote');
  });

  test('returns safe unavailable state when refresh and stale cache fail', async () => {
    const tokenized = 'https://guide.example/epg.xml?token=super-secret';
    const repo = repository({
      url: tokenized,
      cache: snapshot(NOW - 6 * HOUR - 1),
    });
    const source = provider(new Error(`Failed to fetch ${tokenized}`));
    const controller = new LiveTvGuideController(repo as any, source as any);

    const state = await controller.load([channel()], NOW);

    expect(state.status).toBe('unavailable');
    expect(state.message).toBe('Programme guide unavailable.');
    expect(state.message).not.toContain('super-secret');
  });

  test('returns unavailable when guide configuration storage fails', async () => {
    const repo = repository();
    repo.loadConfig.mockRejectedValueOnce(
      new Error('secure storage unavailable'),
    );
    const source = provider(snapshot());
    const controller = new LiveTvGuideController(repo as any, source as any);

    await expect(controller.load([channel()], NOW)).resolves.toMatchObject({
      status: 'unavailable',
      message: 'Programme guide unavailable.',
    });
    expect(source.load).not.toHaveBeenCalled();
  });

  test('returns unavailable when the configured guide URL cannot be resolved', async () => {
    const repo = repository();
    repo.resolveUrl.mockRejectedValueOnce(
      new Error('secure URL store unavailable'),
    );
    const source = provider(snapshot());
    const controller = new LiveTvGuideController(repo as any, source as any);

    await expect(controller.load([channel()], NOW)).resolves.toMatchObject({
      status: 'unavailable',
      message: 'Programme guide unavailable.',
    });
    expect(source.load).not.toHaveBeenCalled();
  });

  test('continues with a fresh guide when cache reading fails', async () => {
    const fresh = snapshot(NOW);
    const repo = repository();
    repo.loadCache.mockRejectedValueOnce(
      new Error('cache storage unavailable'),
    );
    const source = provider(fresh);
    const controller = new LiveTvGuideController(repo as any, source as any);

    const state = await controller.load([channel()], NOW);

    expect(source.load).toHaveBeenCalledTimes(1);
    expect(state.status).toBe('ready');
    expect(state.snapshot).toEqual(fresh);
  });

  test('keeps freshly loaded guide data when cache persistence fails', async () => {
    const fresh = snapshot(NOW);
    const repo = repository();
    repo.saveCache.mockRejectedValueOnce(
      new Error('cache write unavailable'),
    );
    const source = provider(fresh);
    const controller = new LiveTvGuideController(repo as any, source as any);

    const state = await controller.load([channel()], NOW);

    expect(state.status).toBe('ready');
    expect(state.snapshot).toEqual(fresh);
    expect(state.matches.get(channel().id)).toBe('fr2.remote');
  });

  test('projects Now/Next and current-first timeline', async () => {
    const repo = repository({ cache: snapshot() });
    const source = provider(snapshot());
    const controller = new LiveTvGuideController(repo as any, source as any);
    const state = await controller.load([channel()], NOW);

    expect(controller.nowNext(state, channel().id, NOW)).toMatchObject({
      now: { title: 'Journal' },
      next: { title: 'Film' },
    });
    expect(
      controller.timeline(state, channel().id, NOW).map((item) => item.title),
    ).toEqual(['Journal', 'Film']);
    expect(source.load).not.toHaveBeenCalled();
  });

  test('timeline current and future ordering is deterministic across locales', () => {
    const controller = new LiveTvGuideController({} as any, {} as any);
    const target = snapshot();
    target.programmes = [
      {
        channelId: 'fr2.remote',
        title: 'Beta current',
        startAtMs: NOW - MINUTE,
        endAtMs: NOW + MINUTE,
      },
      {
        channelId: 'fr2.remote',
        title: 'Alpha current',
        startAtMs: NOW - MINUTE,
        endAtMs: NOW + MINUTE,
      },
      {
        channelId: 'fr2.remote',
        title: 'Beta future',
        startAtMs: NOW + MINUTE,
        endAtMs: NOW + 2 * MINUTE,
      },
      {
        channelId: 'fr2.remote',
        title: 'Alpha future',
        startAtMs: NOW + MINUTE,
        endAtMs: NOW + 2 * MINUTE,
      },
    ];
    const state = {
      status: 'ready',
      snapshot: target,
      matches: new Map([[channel().id, 'fr2.remote']]),
    } as any;
    const original = String.prototype.localeCompare;
    String.prototype.localeCompare = function localeCompareBlocked() {
      throw new Error('locale-specific ordering must not be used');
    };

    try {
      expect(
        controller.timeline(state, channel().id, NOW)
          .map((item) => item.title),
      ).toEqual([
        'Alpha current',
        'Alpha future',
        'Beta future',
      ]);
    } finally {
      String.prototype.localeCompare = original;
    }
  });

  test('indexes snapshot programmes once for repeated Now/Next and timeline reads', () => {
    const controller = new LiveTvGuideController({} as any, {} as any);
    const target = snapshot();
    const originalProgrammes = target.programmes;
    let programmeReads = 0;

    Object.defineProperty(target, 'programmes', {
      configurable: true,
      get() {
        programmeReads += 1;
        return originalProgrammes;
      },
    });

    const state = {
      status: 'ready',
      snapshot: target,
      matches: new Map([[channel().id, 'fr2.remote']]),
    } as any;

    expect(controller.nowNext(state, channel().id, NOW).now?.title)
      .toBe('Journal');
    expect(controller.nowNext(state, channel().id, NOW).next?.title)
      .toBe('Film');
    expect(controller.timeline(state, channel().id, NOW).map(
      (item) => item.title,
    )).toEqual(['Journal', 'Film']);
    expect(programmeReads).toBe(1);
  });

  test('does not let an older guide refresh overwrite the newest cache', async () => {
    const repo = repository();
    const first = deferred<GuideSnapshot>();
    const second = deferred<GuideSnapshot>();
    const source = {
      load: jest.fn()
        .mockImplementationOnce(async () => first.promise)
        .mockImplementationOnce(async () => second.promise),
    };
    const controller = new LiveTvGuideController(repo as any, source as any);
    const older = snapshot(NOW - 2 * MINUTE);
    const newer = {
      ...snapshot(NOW),
      programmes: snapshot(NOW).programmes.map((programme) => ({
        ...programme,
        title: programme.title === 'Journal' ? 'Latest Journal' : programme.title,
      })),
    };

    const firstRefresh = controller.refresh([channel()], NOW);
    const secondRefresh = controller.refresh([channel()], NOW);

    second.resolve(newer);
    const newestState = await secondRefresh;
    expect(newestState.snapshot).toEqual(newer);

    first.resolve(older);
    await firstRefresh;

    expect(repo.saveCache).toHaveBeenCalledTimes(1);
    expect(repo.saveCache).toHaveBeenCalledWith(newer);
  });

  test('matches a merged station using a backup provider remote id', async () => {
    const primaryProvider: LiveTvProviderDescriptor = {
      addonId: 'provider-a',
      name: 'Provider A',
      manifestUrl: 'https://a.example/manifest.json',
      priority: 100,
      liveTv: { catalogs: [], streamTypes: ['channel'] },
    };
    const backupProvider: LiveTvProviderDescriptor = {
      addonId: 'provider-b',
      name: 'Provider B',
      manifestUrl: 'https://b.example/manifest.json',
      priority: 50,
      liveTv: { catalogs: [], streamTypes: ['channel'] },
    };
    const primary = channel();
    const backup: LiveTvChannel = {
      ...primary,
      id: 'provider-b:channel:france2',
      providerId: 'provider-b',
      remoteId: 'france2',
    };
    const merged: LiveTvBrowserChannel = {
      ...primary,
      variants: [
        { provider: primaryProvider, channel: primary },
        { provider: backupProvider, channel: backup },
      ],
    };
    const cached: GuideSnapshot = {
      ...snapshot(),
      channels: [{
        id: 'france2',
        displayNames: ['Different guide name'],
        countryCode: 'FR',
      }],
      programmes: snapshot().programmes.map((programme) => ({
        ...programme,
        channelId: 'france2',
      })),
    };
    const repo = repository({ cache: cached });
    const controller = new LiveTvGuideController(
      repo as any,
      provider(cached) as any,
    );

    const state = await controller.load([merged], NOW);

    expect(state.matches.get(merged.id)).toBe('france2');
    expect(controller.nowNext(state, merged.id, NOW).now?.title)
      .toBe('Journal');
  });

});


test('returns unavailable for an invalid guide clock', async () => {
  const repository = {
    loadConfig: jest.fn(), resolveUrl: jest.fn(), loadCache: jest.fn(), saveCache: jest.fn(),
  };
  const provider = { load: jest.fn() };
  const controller = new LiveTvGuideController(repository as any, provider as any);
  const state = await controller.load([], Number.NaN);
  expect(state.status).toBe('unavailable');
  expect(repository.loadConfig).not.toHaveBeenCalled();
});

test('ignores invalid clocks for now-next and timeline lookups', () => {
  const controller = new LiveTvGuideController({} as any, {} as any);
  const state = { status: 'ready', snapshot: undefined, matches: new Map() } as any;
  expect(controller.nowNext(state, 'x', Number.NaN)).toEqual({ now: undefined, next: undefined });
  expect(controller.timeline(state, 'x', Number.NaN)).toEqual([]);
});

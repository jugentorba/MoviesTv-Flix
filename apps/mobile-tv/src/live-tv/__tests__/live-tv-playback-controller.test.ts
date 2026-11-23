import type { StreamSource } from '@moviestv/core';
import type { LiveTvChannel, LiveTvProviderDescriptor } from '@moviestv/live-tv';
import { LiveTvPlaybackController } from '../LiveTvPlaybackController';
import type { LiveTvBrowserChannel } from '../live-tv-aggregation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const provider: LiveTvProviderDescriptor = {
  addonId: 'p', name: 'P', manifestUrl: 'https://p.example/manifest.json', priority: 1,
  liveTv: { catalogs: [], streamTypes: ['channel'] },
};
const channel = (id: string): LiveTvChannel => ({
  id: `p:channel:${id}`, providerId: 'p', remoteId: id, resourceType: 'channel', title: id.toUpperCase(),
});

describe('LiveTvPlaybackController', () => {
  it('ignores stale resolution results and keeps the latest channel', async () => {
    const a = channel('a');
    const b = channel('b');
    const first = deferred<any[]>();
    const second = deferred<any[]>();
    const controller = new LiveTvPlaybackController({
      resolveChannel: async (_provider, selected) => selected.id === a.id ? first.promise : second.promise,
    });

    const firstRequest = controller.selectChannel(provider, a);
    const secondRequest = controller.selectChannel(provider, b);
    second.resolve([{ id: 'b1', url: 'https://b.example/live' }]);
    await secondRequest;
    first.resolve([{ id: 'a1', url: 'https://a.example/live' }]);
    await firstRequest;

    expect(controller.state.channel?.id).toBe(b.id);
    expect(controller.state.selectedSourceId).toBe('b1');
  });

  it('uses a generic error state when no sources resolve', async () => {
    const controller = new LiveTvPlaybackController({ resolveChannel: async () => [] });
    await controller.selectChannel(provider, channel('a'));
    expect(controller.state).toEqual(expect.objectContaining({ status: 'error', sources: [], selectedSourceId: null }));
  });

  it('selects only valid source IDs', async () => {
    const controller = new LiveTvPlaybackController({
      resolveChannel: async () => [
        { id: 'one', url: 'https://one.example/live' },
        { id: 'two', url: 'https://two.example/live' },
      ],
    });
    await controller.selectChannel(provider, channel('a'));
    controller.selectSource('missing');
    expect(controller.state.selectedSourceId).toBe('one');
    controller.selectSource('two');
    expect(controller.state.selectedSourceId).toBe('two');
  });

  it('zaps to visible neighbors and wraps at boundaries', async () => {
    const a = channel('a');
    const b = channel('b');
    const c = channel('c');
    const controller = new LiveTvPlaybackController({
      resolveChannel: async (_provider, selected) => [{
        id: selected.id,
        url: 'https://stream.example/live',
      }],
    });

    await controller.selectChannel(provider, b);

    await controller.previous([a, b, c], [provider]);
    expect(controller.state.channel?.id).toBe(a.id);

    await controller.previous([a, b, c], [provider]);
    expect(controller.state.channel?.id).toBe(c.id);

    await controller.next([a, b, c], [provider]);
    expect(controller.state.channel?.id).toBe(a.id);

    await controller.next([a, b, c], [provider]);
    expect(controller.state.channel?.id).toBe(b.id);
  });
});


  it('fails over to the next resolved source before refreshing an exhausted provider', async () => {
    const controller = new LiveTvPlaybackController({
      resolveChannel: async () => [
        { id: 'first', url: 'https://first.example/live.m3u8' },
        { id: 'second', url: 'https://second.example/live.m3u8' },
      ],
    });

    await controller.selectChannel(provider, channel('a'));
    expect(controller.state.selectedSourceId).toBe('first');

    controller.sourceFailed('first');
    expect(controller.state.status).toBe('ready');
    expect(controller.state.selectedSourceId).toBe('second');

    controller.sourceFailed('second');
    expect(controller.state.status).toBe('resolving');

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(controller.state.status).toBe('error');
    expect(controller.state.selectedSourceId).toBeNull();
  });


it('uses ranked source order for initial selection and failover', async () => {
  const controller = new LiveTvPlaybackController(
    {
      resolveChannel: async () => [
        { id: 'provider-first', url: 'https://stream.example/live.mkv' },
        { id: 'browser-first', url: 'https://stream.example/live.m3u8' },
      ],
    },
    (sources) => [...sources].reverse(),
  );

  await controller.selectChannel(provider, channel('a'));

  expect(controller.state.sources.map((source) => source.id)).toEqual([
    'browser-first',
    'provider-first',
  ]);
  expect(controller.state.selectedSourceId).toBe('browser-first');

  controller.sourceFailed('browser-first');
  expect(controller.state.selectedSourceId).toBe('provider-first');
});


const backupProvider: LiveTvProviderDescriptor = {
  addonId: 'backup',
  name: 'Backup',
  manifestUrl: 'https://backup.example/manifest.json',
  priority: 0,
  liveTv: { catalogs: [], streamTypes: ['channel'] },
};

function mergedChannel(): LiveTvBrowserChannel {
  const primary = channel('a');
  const backup: LiveTvChannel = {
    id: 'backup:channel:a',
    providerId: 'backup',
    remoteId: 'a',
    resourceType: 'channel',
    title: 'A',
  };
  return {
    ...primary,
    variants: [
      { provider, channel: primary },
      { provider: backupProvider, channel: backup },
    ],
  };
}

it('keeps active playback refreshable when country metadata improves', async () => {
  const calls: string[] = [];
  const primary = {
    ...channel('fr2'),
    title: 'France 2',
  };
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      return selectedProvider.addonId === 'backup'
        ? [{
            id: 'backup-source',
            url: 'https://backup.example/live.m3u8',
          }]
        : [{
            id: 'primary-source',
            url: 'https://primary.example/live.m3u8',
          }];
    },
  });

  await controller.selectLogicalChannel({
    ...primary,
    variants: [{ provider, channel: primary }],
  });
  expect(controller.state.selectedSourceId).toBe('primary-source');

  const identifiedPrimary = {
    ...primary,
    countryCode: 'FR',
  };
  const backup: LiveTvChannel = {
    id: 'backup:channel:fr2',
    providerId: 'backup',
    remoteId: 'fr2',
    resourceType: 'channel',
    title: 'Fránce-2',
    countryCode: 'FR',
  };
  controller.updateLogicalChannel({
    ...identifiedPrimary,
    variants: [
      { provider, channel: identifiedPrimary },
      { provider: backupProvider, channel: backup },
    ],
  });

  expect(controller.state.channel?.countryCode).toBe('FR');

  controller.sourceFailed('primary-source');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(calls).toEqual(['p', 'p', 'backup']);
  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('backup-source');
});

it('keeps refreshed playback when the logical primary provider changes', async () => {
  const calls: string[] = [];
  const primary = {
    ...channel('fr2'),
    title: 'France 2',
  };
  const backup: LiveTvChannel = {
    id: 'backup:channel:fr2',
    providerId: 'backup',
    remoteId: 'fr2',
    resourceType: 'channel',
    title: 'Fránce-2',
    countryCode: 'FR',
  };
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      return selectedProvider.addonId === 'backup'
        ? [{
            id: 'backup-source',
            url: 'https://backup.example/live.m3u8',
          }]
        : [{
            id: 'primary-source',
            url: 'https://primary.example/live.m3u8',
          }];
    },
  });

  await controller.selectLogicalChannel({
    ...primary,
    variants: [{ provider, channel: primary }],
  });

  controller.updateLogicalChannel({
    ...backup,
    variants: [
      { provider: backupProvider, channel: backup },
      { provider, channel: primary },
    ],
  });

  expect(controller.state.channel?.id).toBe(backup.id);
  expect(controller.state.channel?.countryCode).toBe('FR');

  controller.sourceFailed('primary-source');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(calls).toEqual(['p', 'p', 'backup']);
  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('backup-source');
});

it('does not let a hung primary consume the whole multi-provider resolve budget', async () => {
  jest.useFakeTimers();
  try {
    const budgets: Array<{ provider: string; timeoutMs?: number }> = [];
    const controller = new LiveTvPlaybackController(
      {
        resolveChannel: async (selectedProvider, _channel, options) => {
          budgets.push({
            provider: selectedProvider.addonId,
            timeoutMs: options?.timeoutMs,
          });
          if (selectedProvider.addonId === provider.addonId) {
            return new Promise<StreamSource[]>(() => undefined);
          }
          return [{
            id: 'backup-source',
            url: 'https://backup.example/live.m3u8',
          }];
        },
      },
      undefined,
      80,
    );

    const pending = controller.selectLogicalChannel(mergedChannel());
    await Promise.resolve();

    expect(budgets[0]).toEqual({
      provider: 'p',
      timeoutMs: 40,
    });

    await jest.advanceTimersByTimeAsync(41);
    await pending;

    expect(budgets.map((entry) => entry.provider)).toEqual([
      'p',
      'backup',
    ]);
    expect(budgets[1]?.timeoutMs).toBeGreaterThan(0);
    // The backup starts at the 40 ms timeout, before the clock reaches 41.
    expect(budgets[1]?.timeoutMs).toBeLessThanOrEqual(40);
    expect(controller.state.status).toBe('ready');
    expect(controller.state.selectedSourceId).toBe('backup-source');
  } finally {
    jest.useRealTimers();
  }
});

it('falls back to the next provider when primary resolution fails', async () => {
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      if (selectedProvider.addonId === provider.addonId) {
        throw new Error('primary offline');
      }
      return [{
        id: 'backup-source',
        url: 'https://backup.example/live.m3u8',
      }];
    },
  });

  await controller.selectLogicalChannel(mergedChannel());

  expect(calls).toEqual(['p', 'backup']);
  expect(controller.state.status).toBe('ready');
  expect(controller.state.channel?.id).toBe('p:channel:a');
  expect(controller.state.selectedSourceId).toBe('backup-source');
});

it('re-resolves one exhausted Live TV provider and accepts a fresh signed URL', async () => {
  let call = 0;
  const controller = new LiveTvPlaybackController({
    resolveChannel: async () => {
      call += 1;
      return [{
        id: 'main',
        url: call === 1
          ? 'https://stream.example/live.m3u8?token=old'
          : 'https://stream.example/live.m3u8?token=fresh',
      }];
    },
  });

  await controller.selectChannel(provider, channel('a'));
  expect(controller.state.sources[0]?.url).toContain('token=old');

  controller.sourceFailed('main');
  expect(controller.state.status).toBe('resolving');

  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(call).toBe(2);
  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('main');
  expect(controller.state.sources[0]?.url).toContain('token=fresh');
});

it('falls back to the next provider after all primary streams fail', async () => {
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      return selectedProvider.addonId === provider.addonId
        ? [{
          id: 'primary-source',
          url: 'https://primary.example/live.m3u8',
        }]
        : [{
          id: 'backup-source',
          url: 'https://backup.example/live.m3u8',
        }];
    },
  });

  await controller.selectLogicalChannel(mergedChannel());
  expect(controller.state.selectedSourceId).toBe('primary-source');

  controller.sourceFailed('primary-source');

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toEqual(['p', 'p', 'backup']);
  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('backup-source');
});

it('retry restarts merged-channel resolution from the preferred provider', async () => {
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      return selectedProvider.addonId === provider.addonId
        ? []
        : [{
          id: 'backup-source',
          url: 'https://backup.example/live.m3u8',
        }];
    },
  });

  await controller.selectLogicalChannel(mergedChannel());
  expect(calls).toEqual(['p', 'backup']);

  await controller.retry();
  expect(calls).toEqual(['p', 'backup', 'p', 'backup']);
});


it('skips an already failed stream URL when falling back to another provider', async () => {
  const calls: string[] = [];
  const logical = mergedChannel();
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      if (selectedProvider.addonId === provider.addonId) {
        return [{
          id: 'primary-source',
          url: 'https://shared.example/live.m3u8',
        }];
      }
      return [
        {
          id: 'duplicate-backup',
          url: 'https://shared.example/live.m3u8#backup-copy',
        },
        {
          id: 'distinct-backup',
          url: 'https://backup.example/distinct.m3u8',
        },
      ];
    },
  });

  await controller.selectLogicalChannel(logical);
  expect(controller.state.selectedSourceId).toBe('primary-source');

  controller.sourceFailed('primary-source');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(calls).toEqual(['p', 'p', 'backup']);
  expect(controller.state.status).toBe('ready');
  expect(controller.state.sources.map((source) => source.id)).toEqual([
    'distinct-backup',
  ]);
  expect(controller.state.selectedSourceId).toBe('distinct-backup');
});

it('keeps same-URL provider fallback when request headers differ', async () => {
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => (
      selectedProvider.addonId === provider.addonId
        ? [{
          id: 'primary-source',
          url: 'https://shared.example/live.m3u8',
          headers: { Referer: 'https://primary.example/' },
        }]
        : [{
          id: 'header-backup',
          url: 'https://shared.example/live.m3u8',
          headers: { Referer: 'https://backup.example/' },
        }]
    ),
  });

  await controller.selectLogicalChannel(mergedChannel());
  controller.sourceFailed('primary-source');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('header-backup');
});

it('retry clears failed-stream memory and can retry the original source', async () => {
  const resolver = jest.fn(async () => [{
    id: 'main',
    url: 'https://stream.example/live.m3u8',
  }]);
  const controller = new LiveTvPlaybackController({
    resolveChannel: resolver,
  });

  await controller.selectChannel(provider, channel('a'));
  controller.sourceFailed('main');
  expect(controller.state.status).toBe('resolving');

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(controller.state.status).toBe('error');

  await controller.retry();

  expect(resolver).toHaveBeenCalledTimes(3);
  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('main');
});


it('adopts refreshed provider variants without interrupting the active stream', async () => {
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      return [{
        id: selectedProvider.addonId === provider.addonId
          ? 'primary-source'
          : 'refreshed-backup',
        url: selectedProvider.addonId === provider.addonId
          ? 'https://primary.example/live.m3u8'
          : 'https://backup.example/live.m3u8',
      }];
    },
  });

  const original = mergedChannel();
  await controller.selectLogicalChannel(original);
  expect(controller.state.selectedSourceId).toBe('primary-source');

  const refreshedPrimary: LiveTvChannel = {
    id: 'backup:channel:a',
    providerId: 'backup',
    remoteId: 'a',
    resourceType: 'channel',
    title: 'A',
  };
  const refreshed: LiveTvBrowserChannel = {
    ...refreshedPrimary,
    variants: [
      {
        provider: backupProvider,
        channel: refreshedPrimary,
      },
    ],
  };

  controller.updateLogicalChannel(refreshed);

  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('primary-source');
  expect(controller.state.channel?.id).toBe('backup:channel:a');

  controller.sourceFailed('primary-source');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(calls).toEqual(['p', 'backup']);
  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('refreshed-backup');
});

it('ignores a stale player error when a later channel reuses the same source id', async () => {
  const firstChannel = channel('a');
  const secondChannel = channel('b');
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (_provider, selected) => [{
      id: 'main',
      url: `https://stream.example/${selected.remoteId}.m3u8`,
    }],
  });

  await controller.selectChannel(provider, firstChannel);
  const staleSource = controller.state.sources[0]!;
  expect(staleSource.id).toBe('main');

  await controller.selectChannel(provider, secondChannel);
  expect(controller.state.selectedSourceId).toBe('main');
  expect(controller.state.sources[0]?.url).toBe(
    'https://stream.example/b.m3u8',
  );

  controller.sourceFailed('main', staleSource);

  expect(controller.state.status).toBe('ready');
  expect(controller.state.channel?.id).toBe(secondChannel.id);
  expect(controller.state.selectedSourceId).toBe('main');
  expect(controller.state.sources[0]?.url).toBe(
    'https://stream.example/b.m3u8',
  );
});

it('retries a reconfigured provider endpoint after the old active stream fails', async () => {
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.manifestUrl);
      return [{
        id: selectedProvider.manifestUrl.includes('new-endpoint')
          ? 'new-source'
          : 'old-source',
        url: selectedProvider.manifestUrl.includes('new-endpoint')
          ? 'https://stream.example/new.m3u8'
          : 'https://stream.example/old.m3u8',
      }];
    },
  });

  const originalChannel = channel('a');
  const original: LiveTvBrowserChannel = {
    ...originalChannel,
    variants: [{ provider, channel: originalChannel }],
  };
  await controller.selectLogicalChannel(original);
  expect(controller.state.selectedSourceId).toBe('old-source');

  const refreshedProvider: LiveTvProviderDescriptor = {
    ...provider,
    manifestUrl: 'https://new-endpoint.example/manifest.json',
  };
  const refreshed: LiveTvBrowserChannel = {
    ...originalChannel,
    variants: [{
      provider: refreshedProvider,
      channel: originalChannel,
    }],
  };

  controller.updateLogicalChannel(refreshed);

  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('old-source');

  controller.sourceFailed('old-source');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(calls).toEqual([
    'https://p.example/manifest.json',
    'https://new-endpoint.example/manifest.json',
  ]);
  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('new-source');
});

it('restarts an in-flight resolve against refreshed provider variants', async () => {
  const primaryResolve = deferred<any[]>();
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      if (selectedProvider.addonId === provider.addonId) {
        return primaryResolve.promise;
      }
      return [{
        id: 'backup-live',
        url: 'https://backup.example/refreshed.m3u8',
      }];
    },
  });

  const original = mergedChannel();
  const firstSelection = controller.selectLogicalChannel(original);
  await Promise.resolve();
  expect(calls).toEqual(['p']);

  const refreshedPrimary: LiveTvChannel = {
    id: 'backup:channel:a',
    providerId: 'backup',
    remoteId: 'a',
    resourceType: 'channel',
    title: 'A',
  };
  const refreshed: LiveTvBrowserChannel = {
    ...refreshedPrimary,
    variants: [{
      provider: backupProvider,
      channel: refreshedPrimary,
    }],
  };

  controller.updateLogicalChannel(refreshed);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(calls).toEqual(['p', 'backup']);
  expect(controller.state.status).toBe('ready');
  expect(controller.state.channel?.id).toBe(refreshed.id);
  expect(controller.state.selectedSourceId).toBe('backup-live');

  primaryResolve.resolve([{
    id: 'stale-primary',
    url: 'https://primary.example/stale.m3u8',
  }]);
  await firstSelection;

  expect(controller.state.status).toBe('ready');
  expect(controller.state.channel?.id).toBe(refreshed.id);
  expect(controller.state.selectedSourceId).toBe('backup-live');
});


it('wraps source failover to an earlier unfailed source after manual selection', async () => {
  const controller = new LiveTvPlaybackController({
    resolveChannel: async () => [
      { id: 'first', url: 'https://first.example/live.m3u8' },
      { id: 'second', url: 'https://second.example/live.m3u8' },
      { id: 'third', url: 'https://third.example/live.m3u8' },
    ],
  });
  await controller.selectChannel(provider, channel('a'));
  controller.selectSource('third');
  controller.sourceFailed('third');
  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('first');
});


test('dedupes equivalent resolved Live TV sources', async () => {
  const provider: any = { addonId: 'p', name: 'P', manifestUrl: 'https://p/manifest.json', priority: 1, liveTv: { catalogs: [], streamTypes: ['tv'] } };
  const channel: any = { id: 'p:1', providerId: 'p', remoteId: '1', resourceType: 'tv', title: 'One' };
  const resolver = { resolveChannel: jest.fn(async () => [
    { id: 'a', url: 'https://cdn/live.m3u8' },
    { id: 'b', url: 'https://cdn/live.m3u8' },
  ]) };
  const controller = new LiveTvPlaybackController(resolver);
  await controller.selectChannel(provider, channel);
  expect(controller.state.sources).toHaveLength(1);
});

test('rejects malformed playback variants without resolving them', async () => {
  const resolver = { resolveChannel: jest.fn() };
  const controller = new LiveTvPlaybackController(resolver);
  const provider: any = { addonId: 'p', liveTv: { catalogs: [], streamTypes: ['tv'] } };
  const channel: any = { id: 'x', providerId: 'other', remoteId: '', resourceType: 'tv', title: 'Bad' };
  await controller.selectChannel(provider, channel);
  expect(resolver.resolveChannel).not.toHaveBeenCalled();
  expect(controller.state.status).toBe('error');
});


test('subscriber failure does not block other Live TV listeners', async () => {
  const provider: any = {
    addonId: 'p',
    manifestUrl: 'https://p.example/manifest.json',
    liveTv: { catalogs: [], streamTypes: ['tv'] },
  };
  const channel: any = { id: 'p:1', providerId: 'p', remoteId: '1', resourceType: 'tv', title: 'One' };
  const resolver = { resolveChannel: jest.fn(async () => [{ id: 's', url: 'https://cdn/live.m3u8' }]) };
  const controller = new LiveTvPlaybackController(resolver);
  const healthy = jest.fn();
  controller.subscribe(() => { throw new Error('listener failed'); });
  controller.subscribe(healthy);
  await controller.selectChannel(provider, channel);
  expect(healthy).toHaveBeenCalled();
  expect(controller.state.status).toBe('ready');
});


test('new playback subscribers receive the current state immediately', () => {
  const controller = new LiveTvPlaybackController({ resolveChannel: jest.fn() });
  const listener = jest.fn();
  controller.subscribe(listener);
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'idle' }));
});


test('dedupes conflicting Live TV source ids', async () => {
  const resolver = { resolveChannel: jest.fn(async () => [
    { id: 'same', url: 'https://example.com/a.m3u8' },
    { id: 'same', url: 'https://example.com/b.m3u8' },
  ]) };
  const controller = new LiveTvPlaybackController(resolver);
  await controller.selectChannel(provider, channel('a'));
  expect(controller.state.sources).toHaveLength(1);
});

test('rapid zapping can supersede a resolving channel', async () => {
  const first = channel('channel-1');
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const resolver = { resolveChannel: jest.fn(async (_provider, selected) => {
    if (selected.remoteId === first.remoteId) await wait;
    return [{ id: selected.remoteId, url: `https://example.com/${selected.remoteId}.m3u8` }];
  }) };
  const controller = new LiveTvPlaybackController(resolver);
  void controller.selectChannel(provider, first);
  const second = channel('channel-2');
  await controller.next([first, second], [provider]);
  release();
  await Promise.resolve();
  expect(controller.state.channel?.remoteId).toBe('channel-2');
});


test('normalizes resolved source ids and URLs', async () => {
  const controller = new LiveTvPlaybackController({ resolveChannel: async () => [{ id: ' main ', url: ' https://example.com/live.m3u8 ' }] });
  await controller.selectChannel(provider, channel('a'));
  expect(controller.state.selectedSourceId).toBe('main');
  expect(controller.state.sources[0]?.url).toBe('https://example.com/live.m3u8');
});

test('rejects credential-bearing Live TV source URLs', async () => {
  const controller = new LiveTvPlaybackController({ resolveChannel: async () => [{ id: 'bad', url: 'https://user:pass@example.com/live.m3u8' }] });
  await controller.selectChannel(provider, channel('a'));
  expect(controller.state.status).toBe('error');
});


test('manual source selection accepts normalized source ids', async () => {
  const controller = new LiveTvPlaybackController({ resolveChannel: async () => [
    { id: 'one', url: 'https://example.com/one.m3u8' },
    { id: 'two', url: 'https://example.com/two.m3u8' },
  ] });
  await controller.selectChannel(provider, channel('a'));
  controller.selectSource(' two ');
  expect(controller.state.selectedSourceId).toBe('two');
});


test('sanitizes malformed Live TV source metadata without losing valid siblings', async () => {
  const controller = new LiveTvPlaybackController({
    resolveChannel: async () => [
      {
        id: ' first ',
        url: ' https://first.example/live.m3u8 ',
        name: ' First ',
        headers: {
          Referer: 123,
          Cookie: 'secret',
          'X-Good': ' ok ',
          'X-Injection': 'value\r\nInjected: yes',
        },
      } as any,
      {
        id: 'second',
        url: 'https://second.example/live.m3u8',
      },
      {
        id: 'ftp',
        url: 'ftp://invalid.example/live.m3u8',
      },
      {
        id: 'credentials',
        url: 'https://user:pass@invalid.example/live.m3u8',
      },
    ],
  });

  await controller.selectChannel(provider, channel('a'));

  expect(controller.state.status).toBe('ready');
  expect(controller.state.sources.map((source) => source.id)).toEqual([
    'first',
    'second',
  ]);
  expect(controller.state.sources[0]).toEqual(expect.objectContaining({
    id: 'first',
    url: 'https://first.example/live.m3u8',
    name: 'First',
    headers: {
      'X-Good': 'ok',
    },
  }));
});

test('bounds Live TV resolver source normalization work per variant', async () => {
  const sources = Array.from({ length: 1_005 }, (_, index) => ({
    id: `source-${index}`,
    url: index < 1_000
      ? `https://stream.example/${index}.m3u8`
      : 'javascript:alert(1)',
  }));
  const controller = new LiveTvPlaybackController({
    resolveChannel: async () => sources,
  });

  await controller.selectChannel(provider, channel('a'));

  expect(controller.state.status).toBe('ready');
  expect(controller.state.sources).toHaveLength(1_000);
  expect(
    controller.state.sources.some((source) => (
      source.id === 'source-1004'
    )),
  ).toBe(false);
});


test('drops malformed refreshed Live TV variants before failover', async () => {
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      return [{
        id: 'main',
        url: 'https://stream.example/live.m3u8',
      }];
    },
  });

  const initialChannel = channel('a');
  await controller.selectLogicalChannel({
    ...initialChannel,
    variants: [{ provider, channel: initialChannel }],
  });
  expect(controller.state.status).toBe('ready');

  const malformedProvider: LiveTvProviderDescriptor = {
    addonId: 'backup',
    name: 'Backup',
    manifestUrl: 'https://backup.example/manifest.json',
    priority: 0,
    liveTv: {
      catalogs: [],
      streamTypes: ['channel'],
    },
  };
  const malformedChannel: LiveTvChannel = {
    id: 'backup:tv:a',
    providerId: 'backup',
    remoteId: 'x'.repeat(513),
    resourceType: 'tv',
    title: 'A',
  };

  controller.updateLogicalChannel({
    ...initialChannel,
    variants: [{
      provider: malformedProvider,
      channel: malformedChannel,
    }],
  });

  controller.sourceFailed('main');
  await Promise.resolve();

  expect(calls).toEqual(['p']);
  expect(controller.state.status).toBe('error');
});

test('rejects Live TV variants whose resource type is not declared by the provider', async () => {
  const resolveChannel = jest.fn(async () => [{
    id: 'bad',
    url: 'https://stream.example/live.m3u8',
  }]);
  const controller = new LiveTvPlaybackController({
    resolveChannel,
  });
  const tvChannel: LiveTvChannel = {
    id: 'p:tv:a',
    providerId: 'p',
    remoteId: 'a',
    resourceType: 'tv',
    title: 'A',
  };

  await controller.selectLogicalChannel({
    ...tvChannel,
    variants: [{
      provider: {
        ...provider,
        liveTv: {
          ...provider.liveTv,
          streamTypes: ['channel'],
        },
      },
      channel: tvChannel,
    }],
  });

  expect(resolveChannel).not.toHaveBeenCalled();
  expect(controller.state.status).toBe('error');
});


it('tries newly added higher-priority Live TV provider after the active provider fails', async () => {
  const calls: string[] = [];
  const higherProvider: LiveTvProviderDescriptor = {
    addonId: 'higher',
    name: 'Higher',
    manifestUrl: 'https://higher.example/manifest.json',
    priority: 2,
    liveTv: { catalogs: [], streamTypes: ['channel'] },
  };
  const higherChannel: LiveTvChannel = {
    id: 'higher:channel:a',
    providerId: 'higher',
    remoteId: 'a',
    resourceType: 'channel',
    title: 'A',
  };
  const primary = channel('a');
  const backup: LiveTvChannel = {
    id: 'backup:channel:a',
    providerId: 'backup',
    remoteId: 'a',
    resourceType: 'channel',
    title: 'A',
  };

  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      if (selectedProvider.addonId === 'p') {
        return [{
          id: 'primary-source',
          url: 'https://primary.example/live.m3u8',
        }];
      }
      if (selectedProvider.addonId === 'higher') {
        return [{
          id: 'higher-source',
          url: 'https://higher.example/live.m3u8',
        }];
      }
      return [{
        id: 'backup-source',
        url: 'https://backup.example/live.m3u8',
      }];
    },
  });

  await controller.selectLogicalChannel({
    ...primary,
    variants: [
      { provider, channel: primary },
      { provider: backupProvider, channel: backup },
    ],
  });
  expect(controller.state.selectedSourceId).toBe('primary-source');

  controller.updateLogicalChannel({
    ...primary,
    variants: [
      { provider: higherProvider, channel: higherChannel },
      { provider, channel: primary },
      { provider: backupProvider, channel: backup },
    ],
  });

  controller.sourceFailed('primary-source');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(calls).toEqual(['p', 'p', 'higher']);
  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('higher-source');
});


it('retry restores the full provider list after source failover', async () => {
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      if (selectedProvider.addonId === 'p') {
        return [{
          id: 'primary-source',
          url: 'https://primary.example/live.m3u8',
        }];
      }
      return [{
        id: 'backup-source',
        url: 'https://backup.example/live.m3u8',
      }];
    },
  });

  await controller.selectLogicalChannel(mergedChannel());
  controller.sourceFailed('primary-source');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(controller.state.selectedSourceId).toBe('backup-source');

  controller.sourceFailed('backup-source');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(controller.state.status).toBe('error');

  await controller.retry();

  expect(calls).toEqual(['p', 'p', 'backup', 'backup', 'p']);
  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('primary-source');
});


test('allows loopback HTTP Live TV providers in the playback controller', async () => {
  const resolveChannel = jest.fn(async () => [{
    id: 'local-source',
    url: 'http://127.0.0.1:7000/live.m3u8',
  }]);
  const controller = new LiveTvPlaybackController({ resolveChannel });
  const selected = channel('a');

  await controller.selectLogicalChannel({
    ...selected,
    variants: [{
      provider: {
        ...provider,
        manifestUrl: 'http://127.0.0.1:7000/manifest.json',
      },
      channel: selected,
    }],
  });

  expect(resolveChannel).toHaveBeenCalledTimes(1);
  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('local-source');
});

test('rejects malformed Live TV provider manifest URLs before resolving', async () => {
  const resolveChannel = jest.fn(async () => [{
    id: 'should-not-run',
    url: 'https://stream.example/live.m3u8',
  }]);
  const controller = new LiveTvPlaybackController({ resolveChannel });
  const selected = channel('a');

  await controller.selectLogicalChannel({
    ...selected,
    variants: [{
      provider: {
        ...provider,
        manifestUrl: 'http://insecure.example/manifest.json',
      },
      channel: selected,
    }],
  });

  expect(resolveChannel).not.toHaveBeenCalled();
  expect(controller.state.status).toBe('error');
});

test('automatic Live TV failover does not revisit an exhausted provider', async () => {
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      if (selectedProvider.addonId === 'p') {
        return [];
      }
      return [{
        id: 'backup-source',
        url: 'https://backup.example/live.m3u8',
      }];
    },
  });

  await controller.selectLogicalChannel(mergedChannel());
  expect(calls).toEqual(['p', 'backup']);
  expect(controller.state.selectedSourceId).toBe('backup-source');

  controller.sourceFailed('backup-source');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(calls).toEqual(['p', 'backup', 'backup']);
  expect(controller.state.status).toBe('error');
});


test('manual Live TV provider preference resolves that provider first', async () => {
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      return [{
        id: `${selectedProvider.addonId}-source`,
        url: `https://${selectedProvider.addonId}.example/live.m3u8`,
      }];
    },
  });

  await controller.selectLogicalChannel(mergedChannel());
  expect(controller.getActiveProviderId()).toBe('p');

  await expect(
    controller.setPreferredProvider('backup'),
  ).resolves.toBe(true);

  expect(controller.getPreferredProviderId()).toBe('backup');
  expect(controller.getActiveProviderId()).toBe('backup');
  expect(controller.state.selectedSourceId).toBe('backup-source');
  expect(calls).toEqual(['p', 'backup']);
});

test('preferred Live TV provider follows channel zapping when available', async () => {
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider, selectedChannel) => {
      calls.push(
        `${selectedProvider.addonId}:${selectedChannel.remoteId}`,
      );
      return [{
        id: `${selectedProvider.addonId}-${selectedChannel.remoteId}`,
        url:
          `https://${selectedProvider.addonId}.example/`
          + `${selectedChannel.remoteId}.m3u8`,
      }];
    },
  });

  await controller.selectLogicalChannel(mergedChannel());
  await controller.setPreferredProvider('backup');

  const primaryB = channel('b');
  const backupB: LiveTvChannel = {
    id: 'backup:channel:b',
    providerId: 'backup',
    remoteId: 'b',
    resourceType: 'channel',
    title: 'B',
  };
  await controller.selectLogicalChannel({
    ...primaryB,
    variants: [
      { provider, channel: primaryB },
      { provider: backupProvider, channel: backupB },
    ],
  });

  expect(calls.at(-1)).toBe('backup:b');
  expect(controller.getPreferredProviderId()).toBe('backup');
  expect(controller.getActiveProviderId()).toBe('backup');
});

test('clears a preferred provider when refreshed channel variants remove it', async () => {
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => [{
      id: `${selectedProvider.addonId}-source`,
      url: `https://${selectedProvider.addonId}.example/live.m3u8`,
    }],
  });

  const logical = mergedChannel();
  await controller.selectLogicalChannel(logical);
  await controller.setPreferredProvider('backup');

  expect(controller.getPreferredProviderId()).toBe('backup');
  expect(controller.getActiveProviderId()).toBe('backup');
  expect(controller.state.selectedSourceId).toBe('backup-source');

  const primaryOnly = {
    ...logical,
    variants: logical.variants.filter(
      (variant) => variant.provider.addonId === 'p',
    ),
  };

  controller.updateLogicalChannel(primaryOnly);

  expect(controller.getPreferredProviderId()).toBeNull();
  // Refreshing metadata should not tear down a stream that is still playing.
  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('backup-source');
});

test('preferred Live TV provider still falls back automatically', async () => {
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      if (selectedProvider.addonId === 'backup') return [];
      return [{
        id: 'primary-source',
        url: 'https://primary.example/live.m3u8',
      }];
    },
  });

  await controller.selectLogicalChannel(mergedChannel());
  await controller.setPreferredProvider('backup');

  expect(calls.slice(-2)).toEqual(['backup', 'p']);
  expect(controller.getPreferredProviderId()).toBe('backup');
  expect(controller.getActiveProviderId()).toBe('p');
  expect(controller.state.selectedSourceId).toBe('primary-source');
});

test('Auto restores normal Live TV provider priority', async () => {
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      return [{
        id: `${selectedProvider.addonId}-source`,
        url: `https://${selectedProvider.addonId}.example/live.m3u8`,
      }];
    },
  });

  await controller.selectLogicalChannel(mergedChannel());
  await controller.setPreferredProvider('backup');
  await expect(controller.setPreferredProvider(null)).resolves.toBe(true);

  expect(controller.getPreferredProviderId()).toBeNull();
  expect(controller.getActiveProviderId()).toBe('p');
  expect(calls.slice(-1)).toEqual(['p']);
});

test('rejects a Live TV provider preference not carried by the channel', async () => {
  const controller = new LiveTvPlaybackController({
    resolveChannel: async () => [{
      id: 'primary-source',
      url: 'https://primary.example/live.m3u8',
    }],
  });

  await controller.selectLogicalChannel(mergedChannel());

  await expect(
    controller.setPreferredProvider('not-installed'),
  ).resolves.toBe(false);
  expect(controller.getPreferredProviderId()).toBeNull();
  expect(controller.getActiveProviderId()).toBe('p');
});


it('re-resolves the current channel with a manually preferred provider', async () => {
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      return [{
        id: `${selectedProvider.addonId}-source`,
        url: `https://${selectedProvider.addonId}.example/live.m3u8`,
      }];
    },
  });

  await controller.selectLogicalChannel(mergedChannel());
  expect(controller.getActiveProviderId()).toBe('p');

  await expect(controller.setPreferredProvider('backup')).resolves.toBe(true);

  expect(controller.getPreferredProviderId()).toBe('backup');
  expect(controller.getActiveProviderId()).toBe('backup');
  expect(controller.state.selectedSourceId).toBe('backup-source');
  expect(calls).toEqual(['p', 'backup']);
});

it('keeps the preferred Live TV provider when zapping to another merged channel', async () => {
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider, selectedChannel) => {
      calls.push(`${selectedProvider.addonId}:${selectedChannel.remoteId}`);
      return [{
        id: `${selectedProvider.addonId}-${selectedChannel.remoteId}`,
        url: `https://${selectedProvider.addonId}.example/${selectedChannel.remoteId}.m3u8`,
      }];
    },
  });

  await controller.selectLogicalChannel(mergedChannel());
  await controller.setPreferredProvider('backup');

  const primaryB = channel('b');
  const backupB: LiveTvChannel = {
    id: 'backup:channel:b',
    providerId: 'backup',
    remoteId: 'b',
    resourceType: 'channel',
    title: 'B',
  };
  await controller.selectLogicalChannel({
    ...primaryB,
    variants: [
      { provider, channel: primaryB },
      { provider: backupProvider, channel: backupB },
    ],
  });

  expect(controller.getPreferredProviderId()).toBe('backup');
  expect(controller.getActiveProviderId()).toBe('backup');
  expect(controller.state.selectedSourceId).toBe('backup-b');
  expect(calls).toEqual(['p:a', 'backup:a', 'backup:b']);
});

it('clearing the preferred provider returns playback to automatic provider order', async () => {
  const calls: string[] = [];
  const controller = new LiveTvPlaybackController({
    resolveChannel: async (selectedProvider) => {
      calls.push(selectedProvider.addonId);
      return [{
        id: `${selectedProvider.addonId}-source`,
        url: `https://${selectedProvider.addonId}.example/live.m3u8`,
      }];
    },
  });

  await controller.selectLogicalChannel(mergedChannel());
  await controller.setPreferredProvider('backup');
  await expect(controller.setPreferredProvider(null)).resolves.toBe(true);

  expect(controller.getPreferredProviderId()).toBeNull();
  expect(controller.getActiveProviderId()).toBe('p');
  expect(controller.state.selectedSourceId).toBe('p-source');
  expect(calls).toEqual(['p', 'backup', 'p']);
});

it('rejects an unavailable preferred provider without interrupting playback', async () => {
  const resolveChannel = jest.fn(async (selectedProvider) => [{
    id: `${selectedProvider.addonId}-source`,
    url: `https://${selectedProvider.addonId}.example/live.m3u8`,
  }]);
  const controller = new LiveTvPlaybackController({ resolveChannel });

  await controller.selectLogicalChannel(mergedChannel());
  const before = controller.state;

  await expect(
    controller.setPreferredProvider('missing-provider'),
  ).resolves.toBe(false);

  expect(controller.getPreferredProviderId()).toBeNull();
  expect(controller.state).toBe(before);
  expect(resolveChannel).toHaveBeenCalledTimes(1);
});


test('accepts corrected HLS metadata on the same refreshed Live TV URL', async () => {
  let call = 0;
  const sharedUrl = 'https://stream.example/play/opaque?token=same';
  const controller = new LiveTvPlaybackController({
    resolveChannel: async () => {
      call += 1;
      return [{
        id: 'main',
        url: sharedUrl,
        ...(call > 1
          ? { contentType: 'application/vnd.apple.mpegurl' }
          : {}),
      }];
    },
  });

  await controller.selectChannel(provider, channel('a'));
  expect(controller.state.sources[0]?.contentType).toBeUndefined();

  controller.sourceFailed('main');
  expect(controller.state.status).toBe('resolving');

  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(call).toBe(2);
  expect(controller.state.status).toBe('ready');
  expect(controller.state.selectedSourceId).toBe('main');
  expect(controller.state.sources[0]?.contentType)
    .toBe('application/vnd.apple.mpegurl');
});

describe('LiveTvPlaybackController with a playlist provider', () => {
  // A playlist provider has no add-on manifest: `manifestUrl` is empty because
  // the channels carry their own stream URLs. It must still be playable.
  const playlistProvider: LiveTvProviderDescriptor = {
    addonId: 'playlist:1',
    name: 'My list',
    manifestUrl: '',
    priority: 100,
    kind: 'playlist',
    liveTv: { catalogs: [], streamTypes: ['channel'] },
  };
  const playlistChannel: LiveTvChannel = {
    id: 'playlist:1:ch',
    providerId: 'playlist:1',
    remoteId: 'ch',
    resourceType: 'channel',
    title: 'Channel',
    directStreamUrl: 'https://streams.example/live.m3u8',
  };

  it('selects and resolves a playlist channel', async () => {
    const controller = new LiveTvPlaybackController({
      resolveChannel: async () => ([{
        id: 'playlist:1:ch',
        providerId: 'playlist:1',
        sourceId: 'ch',
        name: 'Channel',
        url: 'https://streams.example/live.m3u8',
      }] as StreamSource[]),
    });

    await controller.selectChannel(playlistProvider, playlistChannel);

    expect(controller.state.status).toBe('ready');
    expect(controller.state.sources).toHaveLength(1);
    expect(controller.state.selectedSourceId).toBe('playlist:1:ch');
  });

  it('plays the playlist channel of an aggregated logical channel', async () => {
    const controller = new LiveTvPlaybackController({
      resolveChannel: async () => ([{
        id: 'playlist:1:ch',
        providerId: 'playlist:1',
        sourceId: 'ch',
        name: 'Channel',
        url: 'https://streams.example/live.m3u8',
      }] as StreamSource[]),
    });

    await controller.selectLogicalChannel({
      id: 'logical:1',
      title: 'Channel',
      variants: [{ provider: playlistProvider, channel: playlistChannel }],
    } as unknown as LiveTvBrowserChannel);

    expect(controller.state.status).toBe('ready');
    expect(controller.state.sources).toHaveLength(1);
  });
});

test('an add-on provider with an insecure manifest is still rejected', async () => {
  const resolver = { resolveChannel: jest.fn(async () => ([
    { id: 's', url: 'https://cdn.example/live.m3u8' },
  ])) };
  const controller = new LiveTvPlaybackController(resolver);
  const insecure: LiveTvProviderDescriptor = {
    addonId: 'addon',
    name: 'Add-on',
    manifestUrl: 'http://plain.example/manifest.json',
    priority: 1,
    liveTv: { catalogs: [], streamTypes: ['channel'] },
  };
  const channel: LiveTvChannel = {
    id: 'addon:1',
    providerId: 'addon',
    remoteId: '1',
    resourceType: 'channel',
    title: 'One',
  };

  await controller.selectChannel(insecure, channel);

  expect(resolver.resolveChannel).not.toHaveBeenCalled();
  expect(controller.state.status).toBe('error');
});

test('an add-on provider on loopback http is accepted', async () => {
  const resolver = { resolveChannel: jest.fn(async () => ([
    { id: 's', url: 'https://cdn.example/live.m3u8' },
  ])) };
  const controller = new LiveTvPlaybackController(resolver);
  const local: LiveTvProviderDescriptor = {
    addonId: 'addon',
    name: 'Add-on',
    manifestUrl: 'http://localhost:7000/manifest.json',
    priority: 1,
    liveTv: { catalogs: [], streamTypes: ['channel'] },
  };
  const channel: LiveTvChannel = {
    id: 'addon:1',
    providerId: 'addon',
    remoteId: '1',
    resourceType: 'channel',
    title: 'One',
  };

  await controller.selectChannel(local, channel);

  expect(controller.state.status).toBe('ready');
});

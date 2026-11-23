import type { WatchProgressRecord } from '@moviestv/sync';
import { AsyncStorageWatchProgressRepository } from '../AsyncStorageWatchProgressRepository';
import type { WatchProgressRemoteGateway } from '../SupabaseWatchProgressGateway';
import { WatchProgressController } from '../WatchProgressController';

const time = '2026-09-18T12:00:00.000Z';
const guest = { type: 'guest' } as const;
const user = { type: 'user', userId: 'a' } as const;
const progress = (positionSeconds = 120, mediaId = 'movie'): WatchProgressRecord => ({
  mediaId, kind: 'movie', title: mediaId, positionSeconds,
  durationSeconds: 1000, completed: false, updatedAt: time,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function repository() {
  const values = new Map<string, string>();
  return new AsyncStorageWatchProgressRepository({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  });
}
function remote(overrides: Partial<WatchProgressRemoteGateway> = {}): WatchProgressRemoteGateway {
  return { list: async () => [], upsert: async () => undefined, ...overrides };
}
function settled(controller: WatchProgressController): Promise<void> {
  if (controller.getSnapshot().status !== 'syncing') return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = controller.subscribe(() => {
      if (controller.getSnapshot().status !== 'syncing') { unsubscribe(); resolve(); }
    });
  });
}

test('guest restores local progress without reading or writing remote', async () => {
  const local = repository();
  await local.put(guest, progress());
  const calls: string[] = [];
  const controller = new WatchProgressController(local, remote({
    list: async () => { calls.push('list'); return []; },
    upsert: async () => { calls.push('upsert'); },
  }));
  await controller.restore(null);
  await controller.save(progress(200));
  expect(controller.getSnapshot()).toMatchObject({ status: 'ready', records: [progress(200)] });
  expect(calls).toEqual([]);
});

test('publishes local progress while remote restore is still pending', async () => {
  const local = repository();
  await local.put(user, progress());
  const response = deferred<WatchProgressRecord[]>();
  const started = deferred<void>();
  const controller = new WatchProgressController(local, remote({
    list: () => { started.resolve(); return response.promise; },
  }));
  const restoring = controller.restore('a');
  await started.promise;
  expect(controller.getSnapshot()).toMatchObject({ status: 'syncing', records: [progress()] });
  response.resolve([]);
  await restoring;
});

test('reconciles by mediaId and persists and uploads the union', async () => {
  const local = repository();
  await local.replaceAll(user, [progress(300), progress(100, 'local-only')]);
  const uploaded = new Map<string, WatchProgressRecord>();
  const controller = new WatchProgressController(local, remote({
    list: async () => [progress(200), progress(150, 'remote-only')],
    upsert: async (id, record) => { expect(id).toBe('a'); uploaded.set(record.mediaId, record); },
  }));
  await controller.restore('a');
  await settled(controller);
  const records = await local.list(user);
  expect(records).toHaveLength(3);
  expect(records.find((record) => record.mediaId === 'movie')?.positionSeconds).toBe(300);
  expect(uploaded.get('movie')?.positionSeconds).toBe(300);
  expect(uploaded.has('local-only')).toBe(true);
  expect(controller.getSnapshot().status).toBe('ready');
});

test('reconciles catalog-native episode aliases by parent series ID', async () => {
  const local = repository();
  const localRecord: WatchProgressRecord = {
    mediaId: 'custom:episode:old',
    kind: 'episode',
    title: 'Native Series · S1E2 · Old',
    externalIds: {},
    seriesId: 'stremio-custom:series:custom%3Ashow-42',
    seasonNumber: 1,
    episodeNumber: 2,
    positionSeconds: 900,
    durationSeconds: 1800,
    completed: false,
    updatedAt: '2026-09-23T08:00:00.000Z',
  };
  const remoteRecord: WatchProgressRecord = {
    ...localRecord,
    mediaId: 'custom:episode:new',
    title: 'Native Series · S1E2 · New',
    positionSeconds: 600,
    updatedAt: '2026-09-23T09:00:00.000Z',
  };
  await local.put(user, localRecord);
  const remove = jest.fn(async () => true);
  const controller = new WatchProgressController(local, remote({
    list: async () => [remoteRecord],
    upsert: async () => undefined,
    remove,
  }));

  await controller.restore('a');
  await settled(controller);

  expect(controller.getSnapshot().records).toEqual([
    expect.objectContaining({
      mediaId: 'custom:episode:new',
      seriesId: 'stremio-custom:series:custom%3Ashow-42',
      seasonNumber: 1,
      episodeNumber: 2,
      positionSeconds: 900,
    }),
  ]);
  await expect(local.list(user)).resolves.toHaveLength(1);
  expect(remove).not.toHaveBeenCalled();
});

test('reconciles local and remote progress for the same movie across catalog ids', async () => {
  const local = repository();
  const localRecord: WatchProgressRecord = {
    mediaId: 'provider-a:movie:550',
    kind: 'movie',
    title: 'Fight Club',
    externalIds: { imdb: 'tt0137523', tmdb: '550' },
    positionSeconds: 1800,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-18T12:00:00.000Z',
  };
  const remoteRecord: WatchProgressRecord = {
    ...localRecord,
    mediaId: 'provider-b:movie:550',
    title: 'Fight Club (remote metadata)',
    positionSeconds: 1200,
    updatedAt: '2026-09-18T13:00:00.000Z',
  };
  await local.put(user, localRecord);
  const uploads: WatchProgressRecord[] = [];
  const controller = new WatchProgressController(local, remote({
    list: async () => [remoteRecord],
    upsert: async (_id, value) => {
      uploads.push(value);
    },
  }));

  await controller.restore('a');
  await settled(controller);

  expect(controller.getSnapshot().records).toEqual([
    expect.objectContaining({
      mediaId: 'provider-b:movie:550',
      title: 'Fight Club (remote metadata)',
      positionSeconds: 1800,
      externalIds: {
        imdb: 'tt0137523',
        tmdb: '550',
      },
    }),
  ]);
  await expect(local.list(user)).resolves.toHaveLength(1);
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toEqual(expect.objectContaining({
    mediaId: 'provider-b:movie:550',
    positionSeconds: 1800,
  }));
});

test('saving progress through a second catalog id collapses the visible history row', async () => {
  const local = repository();
  const first: WatchProgressRecord = {
    mediaId: 'provider-a:movie:550',
    kind: 'movie',
    title: 'Fight Club',
    externalIds: { tmdb: '550' },
    positionSeconds: 600,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-18T12:00:00.000Z',
  };
  const second: WatchProgressRecord = {
    ...first,
    mediaId: 'provider-b:movie:550',
    positionSeconds: 1800,
    updatedAt: '2026-09-18T13:00:00.000Z',
  };
  const controller = new WatchProgressController(local);

  await controller.restore(null);
  await controller.save(first);
  await controller.save(second);

  expect(controller.getSnapshot().records).toEqual([
    expect.objectContaining({
      mediaId: 'provider-b:movie:550',
      positionSeconds: 1800,
    }),
  ]);
  await expect(local.list(guest)).resolves.toHaveLength(1);
});

test('keeps the remote alias when it becomes the merged canonical row', async () => {
  const local = repository();
  const localRecord: WatchProgressRecord = {
    mediaId: 'provider-a:movie:550',
    kind: 'movie',
    title: 'Fight Club',
    externalIds: { imdb: 'tt0137523', tmdb: '550' },
    positionSeconds: 1800,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-18T12:00:00.000Z',
  };
  const remoteAlias: WatchProgressRecord = {
    ...localRecord,
    mediaId: 'provider-b:movie:550',
    positionSeconds: 1200,
    updatedAt: '2026-09-18T13:00:00.000Z',
  };
  await local.put(user, localRecord);

  const calls: string[] = [];
  const controller = new WatchProgressController(local, remote({
    list: async () => [remoteAlias],
    upsert: async (_id, value) => {
      calls.push(`upsert:${value.mediaId}:${value.positionSeconds}`);
    },
    remove: async (_id, mediaId, notNewerThan) => {
      calls.push(`remove:${mediaId}:${notNewerThan}`);
      return true;
    },
  }));

  await controller.restore('a');
  await settled(controller);

  expect(calls).toEqual([
    'upsert:provider-b:movie:550:1800',
  ]);
});

test('cleans older remote aliases when the merged winner uses a different media id', async () => {
  const local = repository();
  const localWinner: WatchProgressRecord = {
    mediaId: 'provider-a:movie:550',
    kind: 'movie',
    title: 'Fight Club',
    externalIds: { imdb: 'tt0137523', tmdb: '550' },
    positionSeconds: 1800,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-18T14:00:00.000Z',
  };
  const remoteAlias: WatchProgressRecord = {
    ...localWinner,
    mediaId: 'provider-b:movie:550',
    positionSeconds: 1200,
    updatedAt: '2026-09-18T13:00:00.000Z',
  };
  await local.put(user, localWinner);

  const remove = jest.fn(async () => true);
  const controller = new WatchProgressController(local, remote({
    list: async () => [remoteAlias],
    upsert: async () => undefined,
    remove,
  }));

  await controller.restore('a');
  await settled(controller);

  expect(remove).toHaveBeenCalledWith(
    'a',
    'provider-b:movie:550',
    '2026-09-18T13:00:00.000Z',
  );
});

test('waits for canonical upload before deleting an older remote alias', async () => {
  const local = repository();
  const localWinner: WatchProgressRecord = {
    mediaId: 'provider-a:movie:550',
    kind: 'movie',
    title: 'Fight Club',
    externalIds: { tmdb: '550' },
    positionSeconds: 1800,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-18T14:00:00.000Z',
  };
  const remoteAlias: WatchProgressRecord = {
    ...localWinner,
    mediaId: 'provider-b:movie:550',
    positionSeconds: 1200,
    updatedAt: '2026-09-18T13:00:00.000Z',
  };
  await local.put(user, localWinner);
  const upload = deferred<void>();
  const uploadStarted = deferred<void>();
  const remove = jest.fn(async () => true);
  const controller = new WatchProgressController(local, remote({
    list: async () => [remoteAlias],
    upsert: async () => {
      uploadStarted.resolve();
      await upload.promise;
    },
    remove,
  }));

  const restoring = controller.restore('a');
  await uploadStarted.promise;

  expect(remove).not.toHaveBeenCalled();

  upload.resolve();
  await restoring;
  await settled(controller);

  expect(remove).toHaveBeenCalledWith(
    'a',
    'provider-b:movie:550',
    '2026-09-18T13:00:00.000Z',
  );
});

test('does not delete a remote alias when canonical upload fails', async () => {
  const local = repository();
  const localWinner: WatchProgressRecord = {
    mediaId: 'provider-a:movie:550',
    kind: 'movie',
    title: 'Fight Club',
    externalIds: { tmdb: '550' },
    positionSeconds: 1800,
    durationSeconds: 3600,
    completed: false,
    updatedAt: '2026-09-18T14:00:00.000Z',
  };
  const remoteAlias: WatchProgressRecord = {
    ...localWinner,
    mediaId: 'provider-b:movie:550',
    positionSeconds: 1200,
    updatedAt: '2026-09-18T13:00:00.000Z',
  };
  await local.put(user, localWinner);
  const remove = jest.fn(async () => true);
  const controller = new WatchProgressController(local, remote({
    list: async () => [remoteAlias],
    upsert: async () => {
      throw new Error('upload failed');
    },
    remove,
  }));

  await controller.restore('a');

  expect(remove).not.toHaveBeenCalled();
  expect(controller.getSnapshot().status).toBe('offline');
});

test('remote failure keeps local records and reports offline', async () => {
  const local = repository();
  await local.put(user, progress());
  const controller = new WatchProgressController(local, remote({
    list: async () => { throw new Error('network down'); },
  }));
  await controller.restore('a');
  expect(controller.getSnapshot()).toMatchObject({ records: [progress()], status: 'offline' });
  expect(await local.list(user)).toEqual([progress()]);
});

test('local restore failure reports error and does not attempt remote', async () => {
  const local = repository();
  local.list = async () => { throw new Error('disk unavailable'); };
  const calls: string[] = [];
  const controller = new WatchProgressController(local, remote({
    list: async () => { calls.push('remote'); return []; },
  }));
  await controller.restore('a');
  expect(controller.getSnapshot().status).toBe('error');
  expect(calls).toEqual([]);
});

test('cleanup write failure during restore reports error before remote sync', async () => {
  const local = repository();
  await local.put(user, progress());
  const originalReplaceAll = local.replaceAll.bind(local);
  const replaceAll = jest.spyOn(local, 'replaceAll')
    .mockImplementationOnce(async () => {
      throw new Error('disk full');
    })
    .mockImplementation(originalReplaceAll);
  const remoteList = jest.fn(async () => []);
  const controller = new WatchProgressController(
    local,
    remote({ list: remoteList }),
  );

  await controller.restore('a');

  expect(replaceAll).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot()).toMatchObject({
    userId: 'a',
    records: [],
    status: 'error',
  });
  expect(remoteList).not.toHaveBeenCalled();
});

test('late remote results from old identity cannot publish or persist', async () => {
  const local = repository();
  const response = deferred<WatchProgressRecord[]>();
  const started = deferred<void>();
  const uploads: string[] = [];
  const controller = new WatchProgressController(local, remote({
    list: (id) => {
      if (id === 'a') { started.resolve(); return response.promise; }
      return Promise.resolve([]);
    },
    upsert: async (id) => { uploads.push(id); },
  }));
  const old = controller.restore('a');
  await started.promise;
  await controller.restore('b');
  response.resolve([progress(900)]);
  await old;
  expect(controller.getSnapshot()).toMatchObject({ userId: 'b', records: [], status: 'ready' });
  expect(await local.list(user)).toEqual([]);
  expect(await local.list({ type: 'user', userId: 'b' })).toEqual([]);
  expect(uploads).toEqual([]);
});

test('late local restore cannot replace the new identity state', async () => {
  const local = repository();
  const originalList = local.list.bind(local);
  const response = deferred<WatchProgressRecord[]>();
  const started = deferred<void>();
  local.list = (scope) => {
    if (scope.type === 'user' && scope.userId === 'a') { started.resolve(); return response.promise; }
    return originalList(scope);
  };
  const controller = new WatchProgressController(local);
  const old = controller.restore('a');
  await started.promise;
  const current = controller.restore('b');
  response.resolve([progress()]);
  await Promise.all([old, current]);
  expect(controller.getSnapshot()).toMatchObject({ userId: 'b', records: [], status: 'ready' });
});

test('save waits for local durability before remote writes', async () => {
  const local = repository();
  const stored = deferred<void>();
  const started = deferred<void>();
  const originalPut = local.put.bind(local);
  local.put = async (scope, record) => {
    started.resolve();
    await stored.promise;
    await originalPut(scope, record);
  };
  const uploaded: number[] = [];
  const controller = new WatchProgressController(local, remote({
    upsert: async (_id, record) => { uploaded.push(record.positionSeconds); },
  }));
  await controller.restore('a');
  const saving = controller.save(progress(200));
  await started.promise;
  expect(uploaded).toEqual([]);
  stored.resolve();
  await saving;
  await settled(controller);
  expect(await local.list(user)).toEqual([progress(200)]);
  expect(uploaded).toEqual([200]);
});

test('keeps a native episode sync lane alive when a new save arrives during alias cleanup', async () => {
  const local = repository();
  const firstUpload = deferred<void>();
  const aliasCleanup = deferred<void>();
  const uploaded: string[] = [];
  const removed: string[] = [];
  let removeCalls = 0;
  const controller = new WatchProgressController(local, remote({
    upsert: async (_id, record) => {
      uploaded.push(record.mediaId);
      if (uploaded.length === 1) await firstUpload.promise;
    },
    remove: async (_id, mediaId) => {
      removed.push(mediaId);
      removeCalls += 1;
      if (removeCalls === 1) await aliasCleanup.promise;
      return true;
    },
  }));
  await controller.restore('a');

  const base: WatchProgressRecord = {
    mediaId: 'custom:episode:a',
    kind: 'episode',
    title: 'Native Series · S1E2',
    externalIds: {},
    seriesId: 'stremio-custom:series:custom%3Ashow-42',
    seasonNumber: 1,
    episodeNumber: 2,
    positionSeconds: 100,
    durationSeconds: 1800,
    completed: false,
    updatedAt: '2026-09-23T08:00:00.000Z',
  };

  await controller.save(base);
  await controller.save({
    ...base,
    mediaId: 'custom:episode:b',
    positionSeconds: 200,
    updatedAt: '2026-09-23T08:01:00.000Z',
  });

  firstUpload.resolve();
  while (!removed.length) await Promise.resolve();

  await controller.save({
    ...base,
    mediaId: 'custom:episode:c',
    positionSeconds: 300,
    updatedAt: '2026-09-23T08:02:00.000Z',
  });

  aliasCleanup.resolve();
  await settled(controller);

  expect(uploaded).toEqual([
    'custom:episode:a',
    'custom:episode:b',
    'custom:episode:c',
  ]);
  expect(removed).toEqual([
    'custom:episode:a',
    'custom:episode:b',
  ]);
  expect(controller.getSnapshot().records[0]).toEqual(
    expect.objectContaining({
      mediaId: 'custom:episode:c',
      positionSeconds: 300,
    }),
  );
});

test('keeps one remote episode lane when identity changes from IMDb+TMDB to TMDB-only', async () => {
  const local = repository();
  const firstUpload = deferred<void>();
  const uploaded: string[] = [];
  let active = 0;
  let maxActive = 0;
  const controller = new WatchProgressController(local, remote({
    upsert: async (_id, record) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      uploaded.push(record.mediaId);
      if (uploaded.length === 1) await firstUpload.promise;
      active -= 1;
    },
    remove: async () => true,
  }));
  await controller.restore('a');

  const first: WatchProgressRecord = {
    mediaId: 'provider-a:episode:1',
    kind: 'episode',
    title: 'Series · S2E3',
    externalIds: { imdb: 'tt0944947', tmdb: '1399' },
    seasonNumber: 2,
    episodeNumber: 3,
    positionSeconds: 300,
    durationSeconds: 1800,
    completed: false,
    updatedAt: '2026-09-23T08:00:00.000Z',
  };
  const second: WatchProgressRecord = {
    ...first,
    mediaId: 'provider-b:episode:3',
    externalIds: { tmdb: '1399' },
    positionSeconds: 600,
    updatedAt: '2026-09-23T08:01:00.000Z',
  };

  await controller.save(first);
  await controller.save(second);

  expect(uploaded).toEqual(['provider-a:episode:1']);
  expect(maxActive).toBe(1);

  firstUpload.resolve();
  await settled(controller);

  expect(uploaded).toEqual([
    'provider-a:episode:1',
    'provider-b:episode:3',
  ]);
  expect(maxActive).toBe(1);
});

test('serializes cross-provider episode aliases by external series identity', async () => {
  const local = repository();
  const firstUpload = deferred<void>();
  const uploaded: string[] = [];
  let active = 0;
  let maxActive = 0;
  const controller = new WatchProgressController(local, remote({
    upsert: async (_id, record) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      uploaded.push(record.mediaId);
      if (uploaded.length === 1) await firstUpload.promise;
      active -= 1;
    },
    remove: async () => true,
  }));
  await controller.restore('a');

  const first: WatchProgressRecord = {
    mediaId: 'provider-a:episode:1',
    kind: 'episode',
    title: 'Series · S2E3',
    externalIds: { imdb: 'tt0944947', tmdb: '1399' },
    seriesId: 'provider-a:series:1399',
    seasonNumber: 2,
    episodeNumber: 3,
    positionSeconds: 300,
    durationSeconds: 1800,
    completed: false,
    updatedAt: '2026-09-23T08:00:00.000Z',
  };
  const second: WatchProgressRecord = {
    ...first,
    mediaId: 'provider-b:episode:3',
    seriesId: 'provider-b:series:1399',
    positionSeconds: 600,
    updatedAt: '2026-09-23T08:01:00.000Z',
  };

  await controller.save(first);
  await controller.save(second);

  expect(uploaded).toEqual(['provider-a:episode:1']);
  expect(maxActive).toBe(1);

  firstUpload.resolve();
  await settled(controller);

  expect(uploaded).toEqual([
    'provider-a:episode:1',
    'provider-b:episode:3',
  ]);
  expect(maxActive).toBe(1);
});

test('serializes native episode aliases in one remote lane and removes the stale alias after the new ID uploads', async () => {
  const local = repository();
  const firstUpload = deferred<void>();
  const uploaded: string[] = [];
  let active = 0;
  let maxActive = 0;
  const remove = jest.fn(async () => true);
  const controller = new WatchProgressController(local, remote({
    upsert: async (_id, record) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      uploaded.push(record.mediaId);
      if (uploaded.length === 1) await firstUpload.promise;
      active -= 1;
    },
    remove,
  }));
  await controller.restore('a');

  const first: WatchProgressRecord = {
    mediaId: 'custom:episode:old',
    kind: 'episode',
    title: 'Native Series · S1E2 · Old',
    externalIds: {},
    seriesId: 'stremio-custom:series:custom%3Ashow-42',
    seasonNumber: 1,
    episodeNumber: 2,
    positionSeconds: 300,
    durationSeconds: 1800,
    completed: false,
    updatedAt: '2026-09-23T08:00:00.000Z',
  };
  const second: WatchProgressRecord = {
    ...first,
    mediaId: 'custom:episode:new',
    title: 'Native Series · S1E2 · New',
    positionSeconds: 600,
    updatedAt: '2026-09-23T08:01:00.000Z',
  };

  await controller.save(first);
  await controller.save(second);

  expect(uploaded).toEqual(['custom:episode:old']);
  expect(maxActive).toBe(1);

  firstUpload.resolve();
  await settled(controller);

  expect(uploaded).toEqual([
    'custom:episode:old',
    'custom:episode:new',
  ]);
  expect(maxActive).toBe(1);
  expect(remove).toHaveBeenCalledWith(
    'a',
    'custom:episode:old',
    second.updatedAt,
  );
  expect(controller.getSnapshot().records).toEqual([
    expect.objectContaining({
      mediaId: 'custom:episode:new',
      positionSeconds: 600,
    }),
  ]);
});

test('serializes and coalesces per-media remote writes to the latest durable record', async () => {
  const local = repository();
  const first = deferred<void>();
  const uploaded: number[] = [];
  let active = 0;
  let maxActive = 0;
  const controller = new WatchProgressController(local, remote({
    upsert: async (_id, record) => {
      active += 1; maxActive = Math.max(maxActive, active);
      uploaded.push(record.positionSeconds);
      if (uploaded.length === 1) await first.promise;
      active -= 1;
    },
  }));
  await controller.restore('a');
  await controller.save(progress(100));
  await controller.save(progress(200));
  await controller.save(progress(300));
  expect(uploaded).toEqual([100]);
  expect((await local.list(user))[0].positionSeconds).toBe(300);
  first.resolve();
  await settled(controller);
  expect(uploaded).toEqual([100, 300]);
  expect(maxActive).toBe(1);
});



test('new saves do not hide an unreconciled remote failure', async () => {
  const local = repository();
  const retryUpload = deferred<void>();
  let attempts = 0;
  const controller = new WatchProgressController(local, remote({
    upsert: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('temporary remote failure');
      }
      await retryUpload.promise;
    },
  }));
  await controller.restore('a');

  await controller.save(progress(100, 'one'));
  await settled(controller);
  expect(controller.getSnapshot().status).toBe('offline');

  await controller.save(progress(200, 'two'));

  expect(controller.getSnapshot().status).toBe('offline');

  retryUpload.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(controller.getSnapshot().status).toBe('offline');
});

test('a successful media upload cannot hide another media sync failure', async () => {
  const local = repository();
  const secondUpload = deferred<void>();
  const secondStarted = deferred<void>();
  const secondFinished = deferred<void>();
  const controller = new WatchProgressController(local, remote({
    upsert: async (_id, record) => {
      if (record.mediaId === 'one') {
        throw new Error('temporary remote failure');
      }
      if (record.mediaId === 'two') {
        secondStarted.resolve();
        await secondUpload.promise;
        secondFinished.resolve();
      }
    },
  }));
  await controller.restore('a');

  await Promise.all([
    controller.save(progress(100, 'one')),
    controller.save(progress(200, 'two')),
  ]);
  await secondStarted.promise;

  if (controller.getSnapshot().status !== 'offline') {
    await new Promise<void>((resolve) => {
      const unsubscribe = controller.subscribe(() => {
        if (controller.getSnapshot().status === 'offline') {
          unsubscribe();
          resolve();
        }
      });
    });
  }

  secondUpload.resolve();
  await secondFinished.promise;
  await Promise.resolve();

  expect(controller.getSnapshot().status).toBe('offline');
  expect((await local.list(user)).map((record) => record.mediaId).sort())
    .toEqual(['one', 'two']);
});

test('concurrent saves to different media do not lose local records', async () => {
  const local = repository();
  const controller = new WatchProgressController(local);
  await controller.restore(null);
  await Promise.all([controller.save(progress(100, 'one')), controller.save(progress(200, 'two'))]);
  expect((await local.list(guest)).map((record) => record.mediaId).sort()).toEqual(['one', 'two']);
});

test('remote restore cannot overwrite a save made while its request was pending', async () => {
  const local = repository();
  const response = deferred<WatchProgressRecord[]>();
  const started = deferred<void>();
  const controller = new WatchProgressController(local, remote({
    list: () => { started.resolve(); return response.promise; },
  }));
  const restoring = controller.restore('a');
  await started.promise;
  await controller.save(progress(400));
  response.resolve([progress(200)]);
  await restoring;
  await settled(controller);
  expect((await local.list(user))[0].positionSeconds).toBe(400);
  expect(controller.getSnapshot().records[0].positionSeconds).toBe(400);
});

test('restart persists a new reset epoch and clears completion', async () => {
  const local = repository();
  const controller = new WatchProgressController(local, null, () => Date.parse(time));
  await controller.restore(null);
  await controller.save({ ...progress(1000), completed: true });
  await controller.restart(progress(), 1000);
  expect(controller.getSnapshot().records[0]).toMatchObject({
    positionSeconds: 0,
    durationSeconds: 1000,
    completed: false,
    resetAt: '2026-09-18T12:00:00.001Z',
    updatedAt: '2026-09-18T12:00:00.001Z',
  });
  expect((await local.list(guest))[0].resetAt)
    .toBe('2026-09-18T12:00:00.001Z');
});

test('local watch progress timestamps never move backwards with the device clock', async () => {
  const local = repository();
  const controller = new WatchProgressController(
    local,
    null,
    () => Date.parse('2026-09-18T11:00:00.000Z'),
  );
  await controller.restore(null);
  await controller.save({
    ...progress(100),
    updatedAt: '2026-09-18T12:00:00.000Z',
  });

  await controller.save({
    ...progress(200),
    updatedAt: '2026-09-18T11:00:00.000Z',
  });

  expect(controller.getSnapshot().records[0]).toMatchObject({
    positionSeconds: 200,
    updatedAt: '2026-09-18T12:00:00.001Z',
  });
  expect((await local.list(guest))[0]).toMatchObject({
    positionSeconds: 200,
    updatedAt: '2026-09-18T12:00:00.001Z',
  });
});

test('restart reset epoch stays newer after a device clock rollback', async () => {
  const local = repository();
  const previous = {
    ...progress(1000),
    completed: true,
    resetAt: '2026-09-18T12:30:00.000Z',
    updatedAt: '2026-09-18T12:30:00.000Z',
  };
  await local.put(guest, previous);
  const controller = new WatchProgressController(
    local,
    null,
    () => Date.parse('2026-09-18T11:00:00.000Z'),
  );
  await controller.restore(null);

  await controller.restart(previous, 1000);

  expect(controller.getSnapshot().records[0]).toMatchObject({
    positionSeconds: 0,
    completed: false,
    resetAt: '2026-09-18T12:30:00.001Z',
    updatedAt: '2026-09-18T12:30:00.001Z',
  });
});

test('markCompleted persists completion and the current timestamp', async () => {
  const local = repository();
  const controller = new WatchProgressController(local, null, () => Date.parse(time));
  await controller.restore(null);
  await controller.markCompleted({ ...progress(), updatedAt: '2026-09-17T00:00:00.000Z' });
  expect((await local.list(guest))[0]).toMatchObject({ completed: true, updatedAt: time });
});

test('local save failure rejects without publishing or uploading undurable data', async () => {
  const local = repository();
  const uploads: string[] = [];
  const controller = new WatchProgressController(local, remote({
    upsert: async (_id, record) => { uploads.push(record.mediaId); },
  }));
  await controller.restore('a');
  local.put = async () => { throw new Error('disk full'); };
  await expect(controller.save(progress())).rejects.toThrow('disk full');
  expect(controller.getSnapshot()).toMatchObject({ records: [], status: 'error' });
  expect(uploads).toEqual([]);
});


test('signing in promotes guest progress into the user scope and uploads it', async () => {
  const local = repository();
  await local.put(guest, progress(240, 'guest-movie'));
  const uploaded: string[] = [];
  const controller = new WatchProgressController(local, remote({
    list: async () => [],
    upsert: async (id, record) => {
      expect(id).toBe('a');
      uploaded.push(record.mediaId);
    },
  }));

  await controller.restore('a');
  await settled(controller);

  expect(controller.getSnapshot().records.map((record) => record.mediaId))
    .toEqual(['guest-movie']);
  expect((await local.list(user)).map((record) => record.mediaId))
    .toEqual(['guest-movie']);
  expect(await local.list(guest)).toEqual([]);
  expect(uploaded).toEqual(['guest-movie']);
});

test('guest promotion resolves same-media conflicts using the newer progress record', async () => {
  const local = repository();
  await local.put(user, {
    ...progress(100, 'shared'),
    updatedAt: '2026-09-18T11:00:00.000Z',
  });
  await local.put(guest, {
    ...progress(700, 'shared'),
    updatedAt: '2026-09-18T13:00:00.000Z',
  });
  const controller = new WatchProgressController(local, remote());

  await controller.restore('a');
  await settled(controller);

  expect(controller.getSnapshot().records).toHaveLength(1);
  expect(controller.getSnapshot().records[0]?.positionSeconds).toBe(700);
  expect((await local.list(user))[0]?.positionSeconds).toBe(700);
  expect(await local.list(guest)).toEqual([]);
});

test('promoted guest progress is not inherited by a later different account', async () => {
  const local = repository();
  await local.put(guest, progress(300, 'guest-movie'));
  const controller = new WatchProgressController(local, remote());

  await controller.restore('a');
  await settled(controller);
  expect(await local.list(guest)).toEqual([]);

  await controller.restore('b');
  await settled(controller);

  expect(controller.getSnapshot()).toMatchObject({
    userId: 'b',
    records: [],
    status: 'ready',
  });
});


test('normalizes watch progress media identity before persistence', async () => {
  const local = repository();
  const controller = new WatchProgressController(local);
  await controller.restore(null);
  await controller.save({ ...progress(), mediaId: ' movie-1 ', title: ' Movie ' });
  await expect(local.list(guest)).resolves.toEqual([
    expect.objectContaining({ mediaId: 'movie-1', title: 'Movie' }),
  ]);
});

test('rejects pathological watch progress durations', async () => {
  const local = repository();
  const controller = new WatchProgressController(local);
  await controller.restore(null);
  await expect(controller.save({ ...progress(), durationSeconds: 315576001 })).rejects.toThrow(TypeError);
});


test('uses the shared one-year playback time safety bound', async () => {
  const local = repository();
  const controller = new WatchProgressController(local);
  await controller.restore(null);

  await expect(controller.save({
    ...progress(),
    positionSeconds: 31_536_001,
    durationSeconds: 31_536_001,
  })).rejects.toThrow(TypeError);

  await expect(controller.save({
    ...progress(),
    positionSeconds: 31_536_000,
    durationSeconds: 31_536_000,
  })).resolves.toBeUndefined();

  expect(controller.getSnapshot().records[0]).toEqual(
    expect.objectContaining({
      positionSeconds: 31_536_000,
      durationSeconds: 31_536_000,
    }),
  );
});

describe('deleting history', () => {
  test('removes one record locally and deletes its remote row', async () => {
    const local = repository();
    await local.replaceAll(user, [progress(), progress(90, 'other')]);
    const removed: string[] = [];
    const controller = new WatchProgressController(local, remote({
      remove: async (_userId, mediaId) => { removed.push(mediaId); },
    }));

    await controller.restore('a');
    await controller.forget(progress());

    expect(controller.getSnapshot().records.map((record) => record.mediaId))
      .toEqual(['other']);
    expect((await local.list(user)).map((record) => record.mediaId))
      .toEqual(['other']);
    expect(removed).toEqual(['movie']);
  });

  test('clears every record and deletes each remote row', async () => {
    const local = repository();
    await local.replaceAll(user, [progress(), progress(90, 'other')]);
    const removed: string[] = [];
    const controller = new WatchProgressController(local, remote({
      remove: async (_userId, mediaId) => { removed.push(mediaId); },
    }));

    await controller.restore('a');
    await controller.forgetAll();

    expect(controller.getSnapshot()).toMatchObject({ records: [], status: 'ready' });
    expect(await local.list(user)).toEqual([]);
    expect(removed.sort()).toEqual(['movie', 'other']);
  });

  test('never touches the remote for a guest', async () => {
    const local = repository();
    await local.replaceAll(guest, [progress()]);
    const calls: string[] = [];
    const controller = new WatchProgressController(local, remote({
      list: async () => { calls.push('list'); return []; },
      upsert: async () => { calls.push('upsert'); },
      remove: async () => { calls.push('remove'); },
    }));

    await controller.restore(null);
    await controller.forget(progress());

    expect(controller.getSnapshot().records).toEqual([]);
    expect(await local.list(guest)).toEqual([]);
    expect(calls).toEqual([]);
  });

  test('cancels a pending upload so the row is not re-created after the delete', async () => {
    const local = repository();
    const events: string[] = [];
    const upload = deferred<void>();
    const controller = new WatchProgressController(local, remote({
      upsert: async () => { events.push('upsert'); await upload.promise; },
      remove: async (_userId, mediaId) => { events.push(`remove:${mediaId}`); },
    }));

    await controller.restore('a');
    await controller.save(progress());
    // The upload is still in flight while the delete is requested.
    const forgetting = controller.forget(progress());
    upload.resolve();
    await forgetting;

    expect(events).toEqual(['upsert', 'remove:movie']);
    expect(controller.getSnapshot().records).toEqual([]);
    expect(await local.list(user)).toEqual([]);
  });

  test('keeps the local delete and reports offline when the remote delete fails', async () => {
    const local = repository();
    await local.replaceAll(user, [progress()]);
    const controller = new WatchProgressController(local, remote({
      remove: async () => { throw new Error('network down'); },
    }));

    await controller.restore('a');
    await controller.forget(progress());

    expect(controller.getSnapshot()).toMatchObject({
      records: [],
      status: 'offline',
    });
    expect(await local.list(user)).toEqual([]);
  });

  test('is a no-op when nothing matches', async () => {
    const local = repository();
    await local.replaceAll(user, [progress()]);
    const removed: string[] = [];
    const controller = new WatchProgressController(local, remote({
      remove: async (_userId, mediaId) => { removed.push(mediaId); },
    }));

    await controller.restore('a');
    await controller.forget(progress(120, 'missing'));

    expect(controller.getSnapshot().records).toHaveLength(1);
    expect(removed).toEqual([]);
  });

  test('notifies subscribers so an open history screen updates', async () => {
    const local = repository();
    await local.replaceAll(user, [progress()]);
    const controller = new WatchProgressController(local);

    await controller.restore('a');
    const listener = jest.fn();
    controller.subscribe(listener);
    listener.mockClear();
    await controller.forget(progress());

    expect(listener).toHaveBeenCalled();
    expect(controller.getSnapshot().records).toEqual([]);
  });
});

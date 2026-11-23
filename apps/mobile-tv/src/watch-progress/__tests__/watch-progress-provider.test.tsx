import React, { useEffect } from 'react';
import { Text } from 'react-native';
import {
  act,
  cleanupAsync,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AsyncStorageWatchProgressRepository } from '../AsyncStorageWatchProgressRepository';
import { WatchProgressProvider } from '../WatchProgressProvider';
import {
  useWatchProgress,
  type WatchProgressContextValue,
} from '../useWatchProgress';

function Probe({
  onApi,
}: {
  onApi?: (api: WatchProgressContextValue) => void;
} = {}) {
  const api = useWatchProgress();
  useEffect(() => {
    onApi?.(api);
  }, [api, onApi]);
  return (
    <Text testID="progress">
      {api.status}:{api.records.map((record) => record.title).join(',')}
    </Text>
  );
}

test('useWatchProgress requires its provider', () => {
  const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try { expect(() => render(<Probe />)).toThrow('WatchProgressProvider'); }
  finally { error.mockRestore(); }
});

test('callback captured from a previous account cannot write into the current account history', async () => {
  const values = new Map<string, string>();
  const repository = new AsyncStorageWatchProgressRepository({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  });

  let api: WatchProgressContextValue | undefined;
  const view = render(
    <WatchProgressProvider repository={repository} userId="account-a">
      <Probe onApi={(value) => { api = value; }} />
    </WatchProgressProvider>,
  );

  await waitFor(() => expect(api?.status).toBe('ready'));
  const accountAApi = api!;

  view.rerender(
    <WatchProgressProvider repository={repository} userId="account-b">
      <Probe onApi={(value) => { api = value; }} />
    </WatchProgressProvider>,
  );

  await waitFor(() => expect(api?.status).toBe('ready'));

  await act(async () => {
    await accountAApi.save({
      mediaId: 'movie-from-a',
      kind: 'movie',
      title: 'Account A Movie',
      positionSeconds: 300,
      durationSeconds: 3600,
      completed: false,
      updatedAt: '2026-09-20T14:00:00.000Z',
    });
  });

  await expect(repository.list({
    type: 'user',
    userId: 'account-a',
  })).resolves.toEqual([]);
  await expect(repository.list({
    type: 'user',
    userId: 'account-b',
  })).resolves.toEqual([]);
  expect(api?.records).toEqual([]);
});

test('replacing the watch-progress runtime hides the previous snapshot for the same account', async () => {
  const firstValues = new Map<string, string>();
  const firstRepository = new AsyncStorageWatchProgressRepository({
    getItem: async (key) => firstValues.get(key) ?? null,
    setItem: async (key, value) => { firstValues.set(key, value); },
  });
  await firstRepository.put(
    { type: 'user', userId: 'same-user' },
    {
      mediaId: 'old-movie',
      kind: 'movie',
      title: 'Old runtime movie',
      positionSeconds: 120,
      durationSeconds: 1000,
      completed: false,
      updatedAt: '2026-09-20T20:00:00.000Z',
    },
  );

  let releaseSecond!: () => void;
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const secondRepository = new AsyncStorageWatchProgressRepository({
    getItem: async () => {
      await secondGate;
      return null;
    },
    setItem: async () => undefined,
  });

  let api: WatchProgressContextValue | undefined;
  const view = render(
    <WatchProgressProvider
      repository={firstRepository}
      userId="same-user"
    >
      <Probe onApi={(value) => { api = value; }} />
    </WatchProgressProvider>,
  );

  await waitFor(() => {
    expect(api?.status).toBe('ready');
    expect(api?.records[0]?.title).toBe('Old runtime movie');
  });

  view.rerender(
    <WatchProgressProvider
      repository={secondRepository}
      userId="same-user"
    >
      <Probe onApi={(value) => { api = value; }} />
    </WatchProgressProvider>,
  );

  await waitFor(() => {
    expect(api?.status).toBe('syncing');
    expect(api?.records).toEqual([]);
  });

  releaseSecond();

  await waitFor(() => {
    expect(api?.status).toBe('ready');
    expect(api?.records).toEqual([]);
  });
});

test('provider promotes guest progress when identity changes to the first signed-in account', async () => {
  const values = new Map<string, string>();
  const repository = new AsyncStorageWatchProgressRepository({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  });
  await repository.put({ type: 'guest' }, {
    mediaId: 'movie', kind: 'movie', title: 'Guest movie', positionSeconds: 100,
    durationSeconds: 1000, completed: false, updatedAt: '2026-09-18T12:00:00.000Z',
  });
  const view = render(<WatchProgressProvider repository={repository}><Probe /></WatchProgressProvider>);
  await waitFor(() => expect(screen.getByTestId('progress').props.children.join('')).toBe('ready:Guest movie'));
  view.rerender(<WatchProgressProvider repository={repository} userId="other"><Probe /></WatchProgressProvider>);
  await waitFor(() => expect(screen.getByTestId('progress').props.children.join('')).toBe('ready:Guest movie'));
  await expect(repository.list({ type: 'guest' })).resolves.toEqual([]);
  await expect(repository.list({ type: 'user', userId: 'other' })).resolves.toEqual([
    expect.objectContaining({ mediaId: 'movie', title: 'Guest movie' }),
  ]);
});


test('retries remote watch progress synchronization after a browser reconnect event', async () => {
  const listeners = new Map<string, () => void>();
  const originalAdd = (globalThis as any).addEventListener;
  const originalRemove = (globalThis as any).removeEventListener;
  const originalNavigator = (globalThis as any).navigator;
  Object.defineProperty(globalThis, 'addEventListener', {
    configurable: true,
    value: jest.fn((type: string, listener: () => void) => {
      listeners.set(type, listener);
    }),
  });
  Object.defineProperty(globalThis, 'removeEventListener', {
    configurable: true,
    value: jest.fn((type: string) => {
      listeners.delete(type);
    }),
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { ...(originalNavigator ?? {}), onLine: true },
  });

  const repository = new AsyncStorageWatchProgressRepository({
    getItem: async () => null,
    setItem: async () => undefined,
  });
  let attempts = 0;
  const remoteGateway = {
    list: jest.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
      return [];
    }),
    upsert: jest.fn(async () => undefined),
  };

  try {
    let api: WatchProgressContextValue | undefined;
    render(
      <WatchProgressProvider
        repository={repository}
        remoteGateway={remoteGateway}
        userId="account-a"
      >
        <Probe onApi={(value) => { api = value; }} />
      </WatchProgressProvider>,
    );

    await waitFor(() => {
      expect(api?.status).toBe('offline');
      expect(listeners.get('online')).toEqual(expect.any(Function));
    });
    expect(remoteGateway.list).toHaveBeenCalledTimes(1);

    await act(async () => {
      listeners.get('online')!();
      await Promise.resolve();
    });

    await waitFor(() => expect(api?.status).toBe('ready'));
    expect(remoteGateway.list).toHaveBeenCalledTimes(2);
  } finally {
    await cleanupAsync();
    Object.defineProperty(globalThis, 'addEventListener', {
      configurable: true,
      value: originalAdd,
    });
    Object.defineProperty(globalThis, 'removeEventListener', {
      configurable: true,
      value: originalRemove,
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  }
});

test('a previous account callback cannot clear the current account history', async () => {
  const values = new Map<string, string>();
  const repository = new AsyncStorageWatchProgressRepository({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  });
  const record = (mediaId: string) => ({
    mediaId,
    kind: 'movie' as const,
    title: mediaId,
    positionSeconds: 60,
    durationSeconds: 600,
    completed: false,
    updatedAt: '2026-09-20T14:00:00.000Z',
  });
  await repository.put({ type: 'user', userId: 'account-a' }, record('from-a'));
  await repository.put({ type: 'user', userId: 'account-b' }, record('from-b'));

  let api: WatchProgressContextValue | undefined;
  const view = render(
    <WatchProgressProvider repository={repository} userId="account-a">
      <Probe onApi={(value) => { api = value; }} />
    </WatchProgressProvider>,
  );

  await waitFor(() => expect(api?.status).toBe('ready'));
  const accountAApi = api!;

  view.rerender(
    <WatchProgressProvider repository={repository} userId="account-b">
      <Probe onApi={(value) => { api = value; }} />
    </WatchProgressProvider>,
  );
  await waitFor(() => {
    expect(api?.status).toBe('ready');
    expect(api?.records.map((item) => item.mediaId)).toEqual(['from-b']);
  });

  await act(async () => {
    await accountAApi.forgetAll();
  });
  await expect(repository.list({ type: 'user', userId: 'account-b' }))
    .resolves.toHaveLength(1);
  expect(api?.records.map((item) => item.mediaId)).toEqual(['from-b']);

  await act(async () => {
    await api!.forgetAll();
  });
  await expect(repository.list({ type: 'user', userId: 'account-b' }))
    .resolves.toEqual([]);
  expect(api?.records).toEqual([]);
});

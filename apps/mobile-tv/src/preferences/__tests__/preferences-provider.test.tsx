import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { MemoryStore } from '@moviestv/storage';
import type { PreferenceRemoteStore, TimestampedPreferences } from '@moviestv/sync';
import {
  PreferencesProvider,
  preferenceCacheKeyForUser,
} from '../PreferencesProvider';
import { usePreferences, type PreferencesApi } from '../usePreferences';

const timestamp = '2026-09-15T08:00:00.000Z';

function cachedPreferences(overrides: Partial<TimestampedPreferences> = {}): TimestampedPreferences {
  return {
    appLocale: { value: 'fr', updatedAt: timestamp },
    preferredAudioLanguages: { value: ['fr', 'en'], updatedAt: timestamp },
    preferredSubtitleLanguages: { value: ['sq', 'fr'], updatedAt: timestamp },
    subtitlesEnabled: { value: true, updatedAt: timestamp },
    autoplay: { value: true, updatedAt: timestamp },
    favoriteChannelIds: { value: [], updatedAt: timestamp },
    myListItems: { value: [], updatedAt: timestamp },
    ...overrides,
  };
}

function Probe({ onApi }: { onApi?: (api: PreferencesApi) => void }) {
  const api = usePreferences();
  useEffect(() => { onApi?.(api); }, [api, onApi]);
  return (
    <Text testID="preference-probe">
      {`${api.ready}:${api.preferences.appLocale}:${api.preferences.preferredAudioLanguages.join(',')}`}
    </Text>
  );
}

test('cached app locale is available before remote sync finishes', async () => {
  const store = new MemoryStore();
  await store.set('user-preferences', cachedPreferences());
  const remote: PreferenceRemoteStore = {
    read: async () => new Promise<TimestampedPreferences | null>(() => undefined),
    write: async () => undefined,
  };

  render(
    <PreferencesProvider store={store} userId="u1" remoteStore={remote}>
      <Probe />
    </PreferencesProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId('preference-probe').props.children).toBe('true:fr:fr,en');
  });
});

test('a slow remote sync cannot overwrite a newer local preference edit', async () => {
  const store = new MemoryStore();
  const initial = cachedPreferences({
    favoriteChannelIds: {
      value: [],
      updatedAt: '2026-09-15T08:00:00.000Z',
    },
  });
  await store.set(preferenceCacheKeyForUser('u1'), initial);

  let releaseFirstRead!: () => void;
  const firstReadGate = new Promise<void>((resolve) => {
    releaseFirstRead = resolve;
  });
  let reads = 0;
  const writes: TimestampedPreferences[] = [];
  const remote: PreferenceRemoteStore = {
    read: async () => {
      reads += 1;
      if (reads === 1) await firstReadGate;
      return initial;
    },
    write: async (_userId, state) => {
      writes.push(state);
    },
  };

  let api: PreferencesApi | undefined;
  render(
    <PreferencesProvider
      store={store}
      userId="u1"
      remoteStore={remote}
      now={() => Date.parse('2026-09-15T10:00:00.000Z')}
    >
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(reads).toBe(1);
  });

  await act(async () => {
    await api!.setFavoriteChannelIds(['local-new']);
  });
  expect(api?.preferences.favoriteChannelIds).toEqual(['local-new']);

  releaseFirstRead();

  await waitFor(() => {
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(api?.preferences.favoriteChannelIds).toEqual(['local-new']);
    expect(writes.some((state) => (
      state.favoriteChannelIds.value[0] === 'local-new'
    ))).toBe(true);
  });

  expect(
    (await store.get<TimestampedPreferences>(
      preferenceCacheKeyForUser('u1'),
    ))?.favoriteChannelIds.value,
  ).toEqual(['local-new']);
});

test('signed-in remote sync preserves a newer ordered audio list', async () => {
  const store = new MemoryStore();
  await store.set('user-preferences', cachedPreferences());
  const remote: PreferenceRemoteStore = {
    read: async () => cachedPreferences({
      preferredAudioLanguages: {
        value: ['sq', 'fr', 'en'],
        updatedAt: '2026-09-15T09:00:00.000Z',
      },
    }),
    write: async () => undefined,
  };

  render(
    <PreferencesProvider store={store} userId="u1" remoteStore={remote}>
      <Probe />
    </PreferencesProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId('preference-probe').props.children).toBe('true:fr:sq,fr,en');
  });
});

test('rolls back queued preference failures to the last durable snapshot', async () => {
  const store = new MemoryStore();
  await store.set(
    preferenceCacheKeyForUser(null),
    cachedPreferences({
      favoriteChannelIds: {
        value: ['durable'],
        updatedAt: '2026-09-15T09:00:00.000Z',
      },
    }),
  );
  let api: PreferencesApi | undefined;

  render(
    <PreferencesProvider store={store}>
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));
  jest.spyOn(store, 'set').mockRejectedValue(
    new Error('disk unavailable'),
  );

  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = api!.setFavoriteChannelIds(['optimistic-a']);
    second = api!.setFavoriteChannelIds(['optimistic-b']);
  });

  await expect(first).rejects.toThrow('disk unavailable');
  await expect(second).rejects.toThrow('disk unavailable');

  await waitFor(() => {
    expect(api?.preferences.favoriteChannelIds).toEqual(['durable']);
  });
});

test('a later successful queued preference write survives an earlier local failure', async () => {
  const store = new MemoryStore();
  let api: PreferencesApi | undefined;

  render(
    <PreferencesProvider store={store}>
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));
  const realSet = store.set.bind(store);
  let favoriteWrites = 0;
  jest.spyOn(store, 'set').mockImplementation(async (key, value: any) => {
    if (value?.favoriteChannelIds?.value?.length) {
      favoriteWrites += 1;
      if (favoriteWrites === 1) {
        throw new Error('first write failed');
      }
    }
    await realSet(key, value);
  });

  let first!: Promise<void>;
  let second!: Promise<void>;
  act(() => {
    first = api!.setFavoriteChannelIds(['channel-a']);
    second = api!.setFavoriteChannelIds([
      'channel-a',
      'channel-b',
    ]);
  });

  await expect(first).rejects.toThrow('first write failed');
  await expect(second).resolves.toBeUndefined();

  await waitFor(() => {
    expect(api?.preferences.favoriteChannelIds).toEqual([
      'channel-a',
      'channel-b',
    ]);
  });
  expect(
    (await store.get<TimestampedPreferences>(
      preferenceCacheKeyForUser(null),
    ))?.favoriteChannelIds.value,
  ).toEqual(['channel-a', 'channel-b']);
});

test('rolls back the latest optimistic preference update when local persistence fails', async () => {
  const store = new MemoryStore();
  await store.set(
    preferenceCacheKeyForUser(null),
    cachedPreferences({
      favoriteChannelIds: {
        value: ['old-channel'],
        updatedAt: '2026-09-15T09:00:00.000Z',
      },
    }),
  );
  let api: PreferencesApi | undefined;

  render(
    <PreferencesProvider store={store}>
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));
  const realSet = store.set.bind(store);
  jest.spyOn(store, 'set').mockImplementation(async (key, value: any) => {
    if (value?.favoriteChannelIds?.value?.includes('new-channel')) {
      throw new Error('disk full');
    }
    await realSet(key, value);
  });

  let update!: Promise<void>;
  act(() => {
    update = api!.setFavoriteChannelIds(['new-channel']);
  });

  await expect(update).rejects.toThrow('disk full');

  await waitFor(() => {
    expect(api?.preferences.favoriteChannelIds).toEqual([
      'old-channel',
    ]);
  });
  expect(
    (await store.get<TimestampedPreferences>(
      preferenceCacheKeyForUser(null),
    ))?.favoriteChannelIds.value,
  ).toEqual(['old-channel']);
});

test('serializes local preference writes so an older save cannot finish last', async () => {
  const store = new MemoryStore();
  let api: PreferencesApi | undefined;

  render(
    <PreferencesProvider store={store}>
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));

  const realSet = store.set.bind(store);
  let releaseFirstWrite!: () => void;
  const firstWriteGate = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  let favoriteWrites = 0;
  jest.spyOn(store, 'set').mockImplementation(async (key, value: any) => {
    if (value?.favoriteChannelIds?.value?.length) {
      favoriteWrites += 1;
      if (value.favoriteChannelIds.value.length === 1) {
        await firstWriteGate;
      }
    }
    await realSet(key, value);
  });

  let firstUpdate!: Promise<void>;
  act(() => {
    firstUpdate = api!.setFavoriteChannelIds(['channel-a']);
  });
  await waitFor(() => expect(favoriteWrites).toBe(1));

  let secondUpdate!: Promise<void>;
  act(() => {
    secondUpdate = api!.setFavoriteChannelIds([
      'channel-a',
      'channel-b',
    ]);
  });

  await act(async () => {
    await Promise.resolve();
  });
  expect(favoriteWrites).toBe(1);

  releaseFirstWrite();
  await act(async () => {
    await Promise.all([firstUpdate, secondUpdate]);
  });

  expect(favoriteWrites).toBe(2);
  const cached = await store.get<TimestampedPreferences>(
    preferenceCacheKeyForUser(null),
  );
  expect(cached?.favoriteChannelIds.value).toEqual([
    'channel-a',
    'channel-b',
  ]);
});

test('serializes remote preference sync so an older write cannot finish last', async () => {
  const store = new MemoryStore();
  const initial = cachedPreferences();
  await store.set(preferenceCacheKeyForUser('u1'), initial);

  let remoteState = initial;
  let remoteReads = 0;
  let releaseFirstWrite!: () => void;
  const firstWriteGate = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  const writes: TimestampedPreferences[] = [];
  const remote: PreferenceRemoteStore = {
    read: async () => {
      remoteReads += 1;
      return remoteState;
    },
    write: async (_userId, state) => {
      writes.push(state);
      if (state.favoriteChannelIds.value.length === 1) {
        await firstWriteGate;
      }
      remoteState = state;
    },
  };

  let nowMs = Date.parse('2026-09-15T10:00:00.000Z');
  let api: PreferencesApi | undefined;
  render(
    <PreferencesProvider
      store={store}
      userId="u1"
      remoteStore={remote}
      now={() => nowMs}
    >
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(remoteReads).toBeGreaterThan(0);
  });

  await act(async () => {
    await api!.setFavoriteChannelIds(['channel-a']);
  });
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]?.favoriteChannelIds.value).toEqual(['channel-a']);

  nowMs = Date.parse('2026-09-15T10:01:00.000Z');
  await act(async () => {
    await api!.setFavoriteChannelIds(['channel-a', 'channel-b']);
    await Promise.resolve();
  });

  expect(writes).toHaveLength(1);

  releaseFirstWrite();

  await waitFor(() => {
    expect(writes).toHaveLength(2);
    expect(remoteState.favoriteChannelIds.value).toEqual([
      'channel-a',
      'channel-b',
    ]);
  });
});

test('local preference timestamps never move backwards with the device clock', async () => {
  const store = new MemoryStore();
  await store.set(
    preferenceCacheKeyForUser(null),
    cachedPreferences({
      favoriteChannelIds: {
        value: ['old'],
        updatedAt: '2026-09-15T12:00:00.000Z',
      },
    }),
  );
  let api: PreferencesApi | undefined;

  render(
    <PreferencesProvider
      store={store}
      now={() => Date.parse('2026-09-15T11:00:00.000Z')}
    >
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));
  await act(async () => {
    await api!.setFavoriteChannelIds(['new']);
  });

  const cached = await store.get<TimestampedPreferences>(
    preferenceCacheKeyForUser(null),
  );
  expect(cached?.favoriteChannelIds.value).toEqual(['new']);
  expect(Date.parse(cached!.favoriteChannelIds.updatedAt))
    .toBeGreaterThan(Date.parse('2026-09-15T12:00:00.000Z'));
});

test('preference updates write normalized values to cache immediately', async () => {
  const store = new MemoryStore();
  let api: PreferencesApi | undefined;
  render(
    <PreferencesProvider store={store} now={() => Date.parse('2026-09-15T10:00:00.000Z')}>
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));
  await act(async () => {
    await api!.setPreferredAudioLanguages(['FRE', 'en', 'fra']);
  });

  const cached = await store.get<TimestampedPreferences>(preferenceCacheKeyForUser(null));
  expect(cached?.preferredAudioLanguages.value).toEqual(['fr', 'en']);
  expect(cached?.preferredAudioLanguages.updatedAt).toBe('2026-09-15T10:00:00.000Z');
});


test('My List updates persist normalized media snapshots immediately', async () => {
  const store = new MemoryStore();
  let api: PreferencesApi | undefined;
  render(
    <PreferencesProvider store={store} now={() => Date.parse('2026-09-15T11:00:00.000Z')}>
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));
  await act(async () => {
    await api!.setMyListItems([{
      mediaId: 'movie:550',
      kind: 'movie',
      title: 'Fight Club',
      providerId: 'cinemeta',
      externalIds: { imdb: 'tt0137523', tmdb: '550' },
      year: 1999,
    }]);
  });

  const cached = await store.get<TimestampedPreferences>(preferenceCacheKeyForUser(null));
  expect(cached?.myListItems.value).toEqual([
    expect.objectContaining({ mediaId: 'movie:550', title: 'Fight Club' }),
  ]);
  expect(cached?.myListItems.updatedAt).toBe('2026-09-15T11:00:00.000Z');
});


test('guest preferences are promoted to the next signed-in account and guest cache is cleared', async () => {
  const store = new MemoryStore();
  const guestState = cachedPreferences({
    myListItems: {
      value: [{
        mediaId: 'movie:guest',
        kind: 'movie',
        title: 'Guest Movie',
        providerId: 'cinemeta',
        externalIds: { imdb: 'tt0000001' },
      }],
      updatedAt: '2026-09-15T12:00:00.000Z',
    },
  });
  await store.set(preferenceCacheKeyForUser(null), guestState);

  const writes: Array<{ userId: string; state: TimestampedPreferences }> = [];
  const remote: PreferenceRemoteStore = {
    read: async () => null,
    write: async (userId, state) => {
      writes.push({ userId, state });
    },
  };
  let api: PreferencesApi | undefined;

  render(
    <PreferencesProvider
      store={store}
      userId="u1"
      remoteStore={remote}
    >
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(api?.preferences.myListItems[0]?.title).toBe('Guest Movie');
  });

  await waitFor(() => {
    expect(writes.some((entry) => (
      entry.userId === 'u1'
      && entry.state.myListItems.value[0]?.title === 'Guest Movie'
    ))).toBe(true);
  });

  expect(await store.get(preferenceCacheKeyForUser(null))).toBeNull();
  expect(
    (await store.get<TimestampedPreferences>(
      preferenceCacheKeyForUser('u1'),
    ))?.myListItems.value[0]?.title,
  ).toBe('Guest Movie');
});

test('switching accounts never exposes another users local preferences', async () => {
  const store = new MemoryStore();
  await store.set(
    preferenceCacheKeyForUser('a'),
    cachedPreferences({
      myListItems: {
        value: [{
          mediaId: 'movie:a',
          kind: 'movie',
          title: 'Account A',
          providerId: 'cinemeta',
          externalIds: { imdb: 'tt0000002' },
        }],
        updatedAt: '2026-09-15T09:00:00.000Z',
      },
    }),
  );
  await store.set(
    preferenceCacheKeyForUser('b'),
    cachedPreferences({
      myListItems: {
        value: [{
          mediaId: 'movie:b',
          kind: 'movie',
          title: 'Account B',
          providerId: 'cinemeta',
          externalIds: { imdb: 'tt0000003' },
        }],
        updatedAt: '2026-09-15T10:00:00.000Z',
      },
    }),
  );

  let api: PreferencesApi | undefined;
  const view = render(
    <PreferencesProvider store={store} userId="a">
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(api?.preferences.myListItems[0]?.title).toBe('Account A');
  });

  view.rerender(
    <PreferencesProvider store={store} userId="b">
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(api?.preferences.myListItems[0]?.title).toBe('Account B');
  });
  expect(api?.preferences.myListItems.some(
    (item) => item.title === 'Account A',
  )).toBe(false);
});

test('callback captured from a previous account cannot mutate the current account', async () => {
  const store = new MemoryStore();
  await store.set(
    preferenceCacheKeyForUser('a'),
    cachedPreferences({
      favoriteChannelIds: {
        value: ['account-a-channel'],
        updatedAt: '2026-09-15T09:00:00.000Z',
      },
    }),
  );
  await store.set(
    preferenceCacheKeyForUser('b'),
    cachedPreferences({
      favoriteChannelIds: {
        value: ['account-b-channel'],
        updatedAt: '2026-09-15T10:00:00.000Z',
      },
    }),
  );

  let api: PreferencesApi | undefined;
  const view = render(
    <PreferencesProvider store={store} userId="a">
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(api?.preferences.favoriteChannelIds).toEqual([
      'account-a-channel',
    ]);
  });
  const accountAApi = api!;

  view.rerender(
    <PreferencesProvider store={store} userId="b">
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(api?.preferences.favoriteChannelIds).toEqual([
      'account-b-channel',
    ]);
  });

  await act(async () => {
    await accountAApi.setFavoriteChannelIds(['stale-account-a-change']);
  });

  expect(api?.preferences.favoriteChannelIds).toEqual([
    'account-b-channel',
  ]);
  expect(
    (await store.get<TimestampedPreferences>(
      preferenceCacheKeyForUser('a'),
    ))?.favoriteChannelIds.value,
  ).toEqual(['account-a-channel']);
  expect(
    (await store.get<TimestampedPreferences>(
      preferenceCacheKeyForUser('b'),
    ))?.favoriteChannelIds.value,
  ).toEqual(['account-b-channel']);
});

test('account handoff hides stale preferences and blocks writes until the new cache loads', async () => {
  const store = new MemoryStore();
  await store.set(
    preferenceCacheKeyForUser('a'),
    cachedPreferences({
      preferredAudioLanguages: {
        value: ['sq'],
        updatedAt: '2026-09-20T14:00:00.000Z',
      },
      favoriteChannelIds: {
        value: ['account-a-channel'],
        updatedAt: '2026-09-20T14:00:00.000Z',
      },
    }),
  );
  await store.set(
    preferenceCacheKeyForUser('b'),
    cachedPreferences({
      preferredAudioLanguages: {
        value: ['de'],
        updatedAt: '2026-09-20T15:00:00.000Z',
      },
      favoriteChannelIds: {
        value: ['account-b-channel'],
        updatedAt: '2026-09-20T15:00:00.000Z',
      },
    }),
  );

  let api: PreferencesApi | undefined;
  const view = render(
    <PreferencesProvider store={store} userId="a">
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(api?.preferences.preferredAudioLanguages).toEqual(['sq']);
  });

  const realGet = store.get.bind(store);
  let releaseB!: () => void;
  const bGate = new Promise<void>((resolve) => {
    releaseB = resolve;
  });
  let bReadStarted = false;
  jest.spyOn(store, 'get').mockImplementation(async (key: string) => {
    if (key === preferenceCacheKeyForUser('b')) {
      bReadStarted = true;
      await bGate;
    }
    return realGet(key);
  });

  view.rerender(
    <PreferencesProvider store={store} userId="b">
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => expect(bReadStarted).toBe(true));
  await waitFor(() => {
    expect(api?.ready).toBe(false);
    expect(api?.preferences.preferredAudioLanguages).not.toEqual(['sq']);
    expect(api?.preferences.favoriteChannelIds).not.toContain(
      'account-a-channel',
    );
  });

  await act(async () => {
    await api!.setFavoriteChannelIds(['too-early']);
  });

  releaseB();

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(api?.preferences.preferredAudioLanguages).toEqual(['de']);
    expect(api?.preferences.favoriteChannelIds).toEqual([
      'account-b-channel',
    ]);
  });

  expect(
    (await store.get<TimestampedPreferences>(
      preferenceCacheKeyForUser('b'),
    ))?.favoriteChannelIds.value,
  ).toEqual(['account-b-channel']);
});

test('fresh local defaults do not overwrite an existing remote account', async () => {
  const store = new MemoryStore();
  const remoteState = cachedPreferences({
    appLocale: {
      value: 'sq',
      updatedAt: '2026-09-15T07:00:00.000Z',
    },
    myListItems: {
      value: [{
        mediaId: 'movie:remote',
        kind: 'movie',
        title: 'Remote Movie',
        providerId: 'cinemeta',
        externalIds: { imdb: 'tt0000004' },
      }],
      updatedAt: '2026-09-15T07:00:00.000Z',
    },
  });
  const write = jest.fn(async () => undefined);
  const remote: PreferenceRemoteStore = {
    read: async () => remoteState,
    write,
  };
  let api: PreferencesApi | undefined;

  render(
    <PreferencesProvider
      store={store}
      userId="u1"
      remoteStore={remote}
    >
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(api?.preferences.appLocale).toBe('sq');
    expect(api?.preferences.myListItems[0]?.title).toBe('Remote Movie');
  });

  expect(write).not.toHaveBeenCalled();
});


test('late remote sync from a previous account cannot replace the current account', async () => {
  const store = new MemoryStore();
  await store.set(
    preferenceCacheKeyForUser('a'),
    cachedPreferences({
      appLocale: {
        value: 'fr',
        updatedAt: '2026-09-15T08:00:00.000Z',
      },
    }),
  );
  await store.set(
    preferenceCacheKeyForUser('b'),
    cachedPreferences({
      appLocale: {
        value: 'sq',
        updatedAt: '2026-09-15T09:00:00.000Z',
      },
    }),
  );

  let resolveA!: (value: TimestampedPreferences | null) => void;
  const pendingA = new Promise<TimestampedPreferences | null>((resolve) => {
    resolveA = resolve;
  });
  const remote: PreferenceRemoteStore = {
    read: async (userId) => (
      userId === 'a' ? pendingA : null
    ),
    write: async () => undefined,
  };
  let api: PreferencesApi | undefined;

  const view = render(
    <PreferencesProvider
      store={store}
      userId="a"
      remoteStore={remote}
    >
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(api?.preferences.appLocale).toBe('fr');
  });

  view.rerender(
    <PreferencesProvider
      store={store}
      userId="b"
      remoteStore={remote}
    >
      <Probe onApi={(value) => { api = value; }} />
    </PreferencesProvider>,
  );

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(api?.preferences.appLocale).toBe('sq');
  });

  resolveA(cachedPreferences({
    appLocale: {
      value: 'en',
      updatedAt: '2026-09-15T12:00:00.000Z',
    },
  }));

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(api?.preferences.appLocale).toBe('sq');
});


test('normalizes preference cache user ids', () => {
  expect(preferenceCacheKeyForUser(' user-1 ')).toBe(preferenceCacheKeyForUser('user-1'));
  expect(preferenceCacheKeyForUser('   ')).toBe(preferenceCacheKeyForUser(null));
});

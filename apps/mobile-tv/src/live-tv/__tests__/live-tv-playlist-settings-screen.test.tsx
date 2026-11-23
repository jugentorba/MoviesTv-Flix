import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccountContext } from '../../auth/useAccount';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { I18nContext } from '../../i18n/useI18n';
import { LiveTvPlaylistSettingsScreen } from '../LiveTvPlaylistSettingsScreen';

jest.mock('../m3u-playlist-runtime', () => {
  const values = new Map<string, string>();
  const secure = {
    getItemAsync: async (key: string) => values.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { values.set(key, value); },
    deleteItemAsync: async (key: string) => { values.delete(key); },
  };
  const { M3uPlaylistStore } = jest.requireActual('../M3uPlaylistStore');
  const store = new M3uPlaylistStore(secure, undefined, 'test');
  return {
    __values: values,
    __store: store,
    m3uPlaylistStoreFor: () => store,
  };
});

const runtime = jest.requireMock('../m3u-playlist-runtime') as {
  __values: Map<string, string>;
  __store: { list(): Promise<unknown[]> };
};

const i18n = {
  locale: 'en',
  direction: 'ltr' as const,
  t: (key: string, params?: Record<string, string | number>) => translateFrom(
    APP_RESOURCES.en,
    APP_RESOURCES.en,
    key,
    params,
  ),
  formatNumber: String,
  formatDate: String,
  languageName: String,
};

const account = {
  backendAvailable: false,
  userId: null,
  loading: false,
  signIn: async () => undefined,
  signUp: async () => undefined,
  signOut: async () => undefined,
};

function renderScreen() {
  return render(
    <AccountContext.Provider value={account}>
      <I18nContext.Provider value={i18n}>
        <LiveTvPlaylistSettingsScreen onBack={jest.fn()} />
      </I18nContext.Provider>
    </AccountContext.Provider>,
  );
}

async function addPlaylist(name: string, url: string) {
  fireEvent.changeText(screen.getByTestId('live-tv-playlist-name'), name);
  fireEvent.changeText(screen.getByTestId('live-tv-playlist-url'), url);
  await act(async () => {
    fireEvent.press(screen.getByTestId('live-tv-playlist-add'));
  });
}

beforeEach(async () => {
  runtime.__values.clear();
  await runtime.__store.list();
});

test('starts empty and adds a playlist by URL', async () => {
  renderScreen();

  await waitFor(() => {
    expect(screen.getByText('No M3U playlist on this device.')).toBeTruthy();
  });

  await addPlaylist('My IPTV', 'http://iptv.example:8080/get.php?user=u&pass=p');

  await waitFor(() => {
    expect(screen.getByText('Playlist added.')).toBeTruthy();
  });
  expect(screen.getByText('My IPTV')).toBeTruthy();
  expect(screen.getByText('iptv.example:8080')).toBeTruthy();
});

test('never renders the stored playlist URL or its credentials', async () => {
  renderScreen();
  await waitFor(() => {
    expect(screen.getByText('No M3U playlist on this device.')).toBeTruthy();
  });

  await addPlaylist('Secret', 'http://iptv.example/live/user/SECRET-PASS/list.m3u');

  await waitFor(() => {
    expect(screen.getByText('Secret')).toBeTruthy();
  });
  expect(screen.queryByText(/SECRET-PASS/)).toBeNull();
  expect(screen.queryByText(/list\.m3u/)).toBeNull();
});

test('rejects a URL with embedded credentials', async () => {
  renderScreen();
  await waitFor(() => {
    expect(screen.getByText('No M3U playlist on this device.')).toBeTruthy();
  });

  await addPlaylist('Bad', 'https://user:pass@iptv.example/list.m3u');

  await waitFor(() => {
    expect(screen.getByText(
      'Use an HTTP or HTTPS URL without credentials in the address.',
    )).toBeTruthy();
  });
  expect(screen.queryByText('Bad')).toBeNull();
});

test('rejects an empty name', async () => {
  renderScreen();
  await waitFor(() => {
    expect(screen.getByText('No M3U playlist on this device.')).toBeTruthy();
  });

  await addPlaylist('   ', 'http://iptv.example/list.m3u');

  // The add button stays disabled without a name, so nothing is written.
  expect(runtime.__values.size).toBe(0);
});

test('toggles and removes a stored playlist', async () => {
  renderScreen();
  await waitFor(() => {
    expect(screen.getByText('No M3U playlist on this device.')).toBeTruthy();
  });

  await addPlaylist('Toggle me', 'http://iptv.example/list.m3u');
  await waitFor(() => {
    expect(screen.getByText('Enabled')).toBeTruthy();
  });

  const [record] = await runtime.__store.list() as { id: string }[];
  await act(async () => {
    fireEvent.press(screen.getByTestId(`live-tv-playlist-toggle-${record!.id}`));
  });

  await waitFor(() => {
    expect(screen.getByText('Disabled')).toBeTruthy();
  });

  await act(async () => {
    fireEvent.press(screen.getByTestId(`live-tv-playlist-remove-${record!.id}`));
  });

  await waitFor(() => {
    expect(screen.getByText('Playlist removed.')).toBeTruthy();
  });
  expect(screen.getByText('No M3U playlist on this device.')).toBeTruthy();
});

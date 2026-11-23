import React from 'react';
import { render, screen } from '@testing-library/react-native';
import AppRoot from '../app/AppRoot';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../auth/useAuthSession', () => ({
  useAuthSession: () => ({
    session: { userId: 'user-1', accessToken: 'access-token' },
    loading: false,
    message: undefined,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  }),
}));

jest.mock('../preferences/PreferencesProvider', () => {
  const ReactModule = require('react');
  return {
    PreferencesProvider: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('../i18n/I18nProvider', () => {
  const ReactModule = require('react');
  return {
    I18nProvider: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('../catalog/CatalogProvider', () => {
  const ReactModule = require('react');
  return {
    CatalogProvider: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('../watch-progress/WatchProgressProvider', () => {
  const ReactModule = require('react');
  return {
    WatchProgressProvider: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('../downloads/DownloadManagerProvider', () => {
  const ReactModule = require('react');
  return {
    DownloadManagerProvider: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('../playback/PlaybackProvider', () => {
  const ReactModule = require('react');
  return {
    PlaybackProvider: ({ children }: any) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  };
});

jest.mock('../playback/PlaybackOverlay', () => {
  const ReactModule = require('react');
  const { Text } = require('react-native');
  return {
    PlaybackOverlay: () => ReactModule.createElement(Text, null, 'playback-overlay'),
  };
});

jest.mock('../addons/SupabaseAddonSyncGateway', () => ({
  SupabaseAddonSyncGateway: class {
    async list() { return []; }
    async upsert() { return undefined; }
    async remove() { return undefined; }
  },
}));

jest.mock('../navigation/AppNavigator', () => {
  const ReactModule = require('react');
  const { Text } = require('react-native');
  const { useAddons } = require('../addons/useAddons');
  return {
    AppNavigator: () => {
      const addons = useAddons();
      return ReactModule.createElement(
        Text,
        null,
        addons.ready ? `addons:${addons.syncStatus}` : 'addons:loading',
      );
    },
  };
});

test('authenticated application content is inside the signed-in add-on runtime and mounts playback overlay', async () => {
  render(
    <AppRoot
      environment={{
        EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture12345678',
      }}
    />,
  );

  expect(await screen.findByText('addons:synced')).toBeTruthy();
  expect(screen.getByText('playback-overlay')).toBeTruthy();
});

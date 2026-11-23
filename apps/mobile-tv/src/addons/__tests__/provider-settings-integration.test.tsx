import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AddonsContext, type AddonsApi } from '../useAddons';
import { AccountContext } from '../../auth/useAccount';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { I18nContext } from '../../i18n/useI18n';
import { PreferencesContext, type PreferencesApi } from '../../preferences/usePreferences';
import { SettingsScreen } from '../../screens/SettingsScreen';

const preferences: PreferencesApi = {
  preferences: {
    appLocale: 'system',
    preferredAudioLanguages: ['en'],
    preferredSubtitleLanguages: ['en'],
    subtitlesEnabled: true,
    autoplay: true,
    favoriteChannelIds: [],
    myListItems: [],
  },
  ready: true,
  setAppLocale: jest.fn(async () => undefined),
  setPreferredAudioLanguages: jest.fn(async () => undefined),
  setPreferredSubtitleLanguages: jest.fn(async () => undefined),
  setSubtitlesEnabled: jest.fn(async () => undefined),
  setAutoplay: jest.fn(async () => undefined),
  setFavoriteChannelIds: jest.fn(async () => undefined),
  setMyListItems: jest.fn(async () => undefined),
};

const addons: AddonsApi = {
  installed: [],
  ready: true,
  syncStatus: 'local',
  error: null,
  refresh: jest.fn(async () => undefined),
  inspectManifest: jest.fn(),
  install: jest.fn(),
  configure: jest.fn(),
  setEnabled: jest.fn(),
  move: jest.fn(),
  remove: jest.fn(async () => undefined),
  hasSavedSecret: jest.fn(async () => false),
};

function renderSettings() {
  render(
    <AccountContext.Provider value={{
        backendAvailable: false,
        userId: null,
        loading: false,
        signIn: async () => undefined,
        signUp: async () => undefined,
        signOut: async () => undefined,
      }}>
      <AddonsContext.Provider value={addons}>
      <PreferencesContext.Provider value={preferences}>
        <I18nContext.Provider value={{
          locale: 'en',
          direction: 'ltr',
          t: (key: string, params?: Record<string, string | number>) => translateFrom(
            APP_RESOURCES.en,
            APP_RESOURCES.en,
            key,
            params,
          ),
          formatNumber: String,
          formatDate: (value) => String(value),
          languageName: (tag) => tag,
        }}>
          <SettingsScreen />
        </I18nContext.Provider>
      </PreferencesContext.Provider>
      </AddonsContext.Provider>
    </AccountContext.Provider>,
  );
}

test('Settings separates catalogs, playback providers and Live TV providers', () => {
  renderSettings();

  expect(screen.getByTestId('settings-catalog-providers')).toBeTruthy();
  expect(screen.getByTestId('settings-stream-providers')).toBeTruthy();
  expect(screen.getByTestId('settings-live-tv-providers')).toBeTruthy();

  fireEvent.press(screen.getByTestId('settings-catalog-providers'));
  expect(screen.getByTestId('providers-kind-catalog')).toBeTruthy();
  expect(screen.getByText('No catalogs installed.')).toBeTruthy();

  fireEvent.press(screen.getByTestId('providers-back'));
  fireEvent.press(screen.getByTestId('settings-stream-providers'));
  expect(screen.getByTestId('providers-kind-stream')).toBeTruthy();
  expect(screen.getByText('No Movies / Series playback providers installed.')).toBeTruthy();
});

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SettingsScreen } from '../../screens/SettingsScreen';
import { AccountContext } from '../../auth/useAccount';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { I18nContext } from '../../i18n/useI18n';
import { PreferencesContext, type PreferencesApi } from '../../preferences/usePreferences';

const labels: Record<string, string> = {
  'settings.title': 'Settings',
  'settings.appLanguage': 'App language',
  'settings.audioLanguages': 'Preferred audio languages',
  'settings.subtitleLanguages': 'Preferred subtitle languages',
  'settings.followDevice': 'Follow device language',
  'settings.languageSearch': 'Search languages',
  'settings.moveUp': 'Move up',
  'settings.moveDown': 'Move down',
  'settings.remove': 'Remove',
  'settings.subtitlesEnabled': 'Subtitles enabled',
  'common.back': 'Back',
};

function renderSettings(overrides: Partial<PreferencesApi> = {}, locale = 'en') {
  const api: PreferencesApi = {
    preferences: {
      appLocale: 'system',
      preferredAudioLanguages: ['sq', 'fr', 'en'],
      preferredSubtitleLanguages: ['sq', 'en'],
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
    ...overrides,
  };

  render(
    <AccountContext.Provider value={{
        backendAvailable: false,
        userId: null,
        loading: false,
        signIn: async () => undefined,
        signUp: async () => undefined,
        signOut: async () => undefined,
      }}>
      <PreferencesContext.Provider value={api}>
      <I18nContext.Provider value={{
        locale,
        direction: 'ltr',
        t: (key: string, params?: Record<string, string | number>) => labels[key]
          ?? translateFrom(
            APP_RESOURCES[locale.toLowerCase().split('-')[0] as keyof typeof APP_RESOURCES]
              ?? APP_RESOURCES.en,
            APP_RESOURCES.en,
            key,
            params,
          ),
        formatNumber: String,
        formatDate: (value) => String(value),
        languageName: (tag) => ({ sq: 'Albanian', fr: 'French', en: 'English' }[tag] ?? tag),
      }}>
        <SettingsScreen />
      </I18nContext.Provider>
      </PreferencesContext.Provider>
    </AccountContext.Provider>,
  );

  return api;
}

test('Settings exposes independent app, audio and subtitle language entries', () => {
  renderSettings();
  expect(screen.getByText('App language')).toBeTruthy();
  expect(screen.getByText('Preferred audio languages')).toBeTruthy();
  expect(screen.getByText('Preferred subtitle languages')).toBeTruthy();
  expect(screen.getByTestId('settings-library')).toBeTruthy();
});

test('app-language selection writes only the app locale preference', () => {
  const api = renderSettings();
  fireEvent.press(screen.getByTestId('settings-app-language'));
  fireEvent.changeText(screen.getByLabelText('Search languages'), 'Albanian');
  fireEvent.press(screen.getByTestId('app-language-sq'));
  expect(api.setAppLocale).toHaveBeenCalledWith('sq');
  expect(api.setPreferredAudioLanguages).not.toHaveBeenCalled();
});

test('audio ordering writes the ordered audio preference', () => {
  const api = renderSettings();
  fireEvent.press(screen.getByTestId('settings-audio-languages'));
  fireEvent.press(screen.getByTestId('language-move-up-en'));
  expect(api.setPreferredAudioLanguages).toHaveBeenCalledWith(['sq', 'en', 'fr']);
});

test('subtitle toggle writes the independent subtitle enabled preference', () => {
  const api = renderSettings();
  fireEvent.press(screen.getByTestId('settings-subtitle-languages'));
  fireEvent.press(screen.getByTestId('subtitles-enabled-toggle'));
  expect(api.setSubtitlesEnabled).toHaveBeenCalledWith(false);
});


test('autoplay toggle writes the synchronized autoplay preference', () => {
  const api = renderSettings();
  fireEvent.press(screen.getByTestId('settings-autoplay'));
  expect(api.setAutoplay).toHaveBeenCalledWith(false);
});


test('Settings opens the Live TV programme guide configuration', () => {
  renderSettings();
  fireEvent.press(screen.getByTestId('settings-live-tv-guide'));
  expect(screen.getByTestId('live-tv-guide-settings')).toBeTruthy();
  expect(screen.getByTestId('live-tv-guide-url')).toBeTruthy();
});


test('German Live TV guide setup copy is localized', () => {
  renderSettings({}, 'de');
  fireEvent.press(screen.getByTestId('settings-live-tv-guide'));
  expect(screen.getByText('Programmübersicht')).toBeTruthy();
  expect(screen.getByText('XMLTV-Guide-URL')).toBeTruthy();
});

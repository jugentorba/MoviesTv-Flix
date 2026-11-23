import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppNavigator } from '../../navigation/AppNavigator';

// The phone tab bar collapses itself while a film is playing, so the navigator
// reads playback state. These tests render the navigator alone.
jest.mock('../../playback/usePlayback', () => ({
  usePlayback: () => ({ selectedSource: null }),
}));
import { SettingsScreen } from '../../screens/SettingsScreen';
import { I18nProvider } from '../I18nProvider';
import { PreferencesContext, type PreferencesApi } from '../../preferences/usePreferences';

jest.mock('../../catalog/CatalogScreen', () => ({
  CatalogScreen: () => null,
}));

jest.mock('../../catalog/MediaDetailsScreen', () => ({
  MediaDetailsScreen: () => null,
}));

jest.mock('../../catalog/SearchScreen', () => ({
  SearchScreen: () => null,
}));

jest.mock('../../live-tv/LiveTvScreen', () => ({
  LiveTvScreen: () => null,
}));

jest.mock('../../screens/LibraryScreen', () => {
  const ReactModule = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    LibraryScreen: ({
      onOpenDownloads,
    }: {
      onOpenDownloads(): void;
    }) => {
      const [count, setCount] = ReactModule.useState(0);
      return ReactModule.createElement(
        View,
        null,
        ReactModule.createElement(
          Pressable,
          {
            testID: 'mock-library-state',
            onPress: () => setCount((value: number) => value + 1),
          },
          ReactModule.createElement(Text, null, `library-state-${count}`),
        ),
        ReactModule.createElement(
          Pressable,
          {
            testID: 'mock-library-downloads',
            onPress: onOpenDownloads,
          },
          ReactModule.createElement(Text, null, 'Open downloads'),
        ),
      );
    },
  };
});

jest.mock('../../downloads/DownloadsScreen', () => {
  const ReactModule = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    DownloadsScreen: ({
      onBack,
    }: {
      onBack(): void;
    }) => ReactModule.createElement(
      Pressable,
      { testID: 'mock-downloads-back', onPress: onBack },
      ReactModule.createElement(Text, null, 'Back to library'),
    ),
  };
});

function preferences(appLocale: string): PreferencesApi {
  return {
    preferences: {
      appLocale,
      preferredAudioLanguages: ['sq', 'en'],
      preferredSubtitleLanguages: ['fr'],
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
}

function Localized({ api, children }: { api: PreferencesApi; children: React.ReactNode }) {
  return (
    <PreferencesContext.Provider value={api}>
      <I18nProvider deviceLocale="en-US">{children}</I18nProvider>
    </PreferencesContext.Provider>
  );
}

test('switching app locale translates navigation without changing content-language order', () => {
  const api = preferences('fr');
  render(
    <Localized api={api}>
        <AppNavigator formFactor="phone" />
    </Localized>,
  );

  expect(screen.getAllByText('Accueil').length).toBeGreaterThan(0);
  expect(screen.getByText('TV en direct')).toBeTruthy();
  expect(api.preferences.preferredAudioLanguages).toEqual(['sq', 'en']);
  expect(api.preferences.preferredSubtitleLanguages).toEqual(['fr']);
});

test('Arabic app locale exposes RTL direction on app-owned settings layout', () => {
  const api = preferences('ar');
  render(
    <Localized api={api}>
      <SettingsScreen />
    </Localized>,
  );

  expect(screen.getByTestId('settings-screen')).toHaveStyle({ direction: 'rtl' });
});


test('German settings surface uses priority-language section copy', () => {
  const api = preferences('de');
  render(
    <Localized api={api}>
      <SettingsScreen />
    </Localized>,
  );

  expect(screen.getByText('Konto & Mediathek')).toBeTruthy();
  expect(screen.getByText('Wiedergabe')).toBeTruthy();
  expect(screen.getByText('Quellen')).toBeTruthy();
  expect(
    screen.getByText('Geräteübergreifende Synchronisierung'),
  ).toBeTruthy();
});

test('Settings keeps Library mounted while Downloads is open', () => {
  const api = preferences('en');
  render(
    <Localized api={api}>
      <SettingsScreen initialPage="library" />
    </Localized>,
  );

  fireEvent.press(screen.getByTestId('mock-library-state'));
  expect(screen.getByText('library-state-1')).toBeTruthy();

  fireEvent.press(screen.getByTestId('mock-library-downloads'));
  expect(screen.getByTestId('mock-downloads-back')).toBeTruthy();
  expect(screen.queryByText('library-state-1')).toBeNull();
  expect(screen.getByText('library-state-1', { includeHiddenElements: true })).toBeTruthy();

  fireEvent.press(screen.getByTestId('mock-downloads-back'));
  expect(screen.queryByTestId('mock-downloads-back')).toBeNull();
  expect(screen.getByText('library-state-1')).toBeTruthy();
});


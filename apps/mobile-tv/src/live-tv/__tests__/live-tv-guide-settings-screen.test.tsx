import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccountContext } from '../../auth/useAccount';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { I18nContext } from '../../i18n/useI18n';
import { LiveTvGuideSettingsScreen } from '../LiveTvGuideSettingsScreen';
import { liveTvGuideStorageKeysForUser } from '../LiveTvGuideRepository';

const mockValidateAndSaveLiveTvGuide = jest.fn();

jest.mock('../live-tv-guide-setup', () => ({
  validateAndSaveLiveTvGuide: (...args: unknown[]) =>
    mockValidateAndSaveLiveTvGuide(...args),
}));

function account(userId: string) {
  return {
    backendAvailable: true,
    userId,
    loading: false,
    signIn: async () => undefined,
    signUp: async () => undefined,
    signOut: async () => undefined,
  };
}

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

function config(publicUrl: string) {
  return JSON.stringify({
    configured: true,
    sourceRevision: 1,
    secure: false,
    publicUrl,
  });
}

test('late guide save from the previous account cannot replace the current account UI', async () => {
  const accountAKeys = liveTvGuideStorageKeysForUser('a');
  const accountBKeys = liveTvGuideStorageKeysForUser('b');

  await AsyncStorage.setItem(
    accountAKeys.config,
    config('https://a.example/original.xml'),
  );
  await AsyncStorage.setItem(
    accountBKeys.config,
    config('https://b.example/epg.xml'),
  );

  let resolveSave!: (value: {
    configured: boolean;
    sourceRevision: number;
    secure: boolean;
    publicUrl?: string;
  }) => void;
  mockValidateAndSaveLiveTvGuide.mockImplementationOnce(
    () => new Promise((resolve) => {
      resolveSave = resolve;
    }),
  );

  const renderScreen = (userId: string) => (
    <AccountContext.Provider value={account(userId)}>
      <I18nContext.Provider value={i18n}>
        <LiveTvGuideSettingsScreen onBack={jest.fn()} />
      </I18nContext.Provider>
    </AccountContext.Provider>
  );
  const view = render(renderScreen('a'));

  await waitFor(() => {
    expect(screen.getByTestId('live-tv-guide-url').props.value)
      .toBe('https://a.example/original.xml');
  });

  fireEvent.changeText(
    screen.getByTestId('live-tv-guide-url'),
    'https://a.example/new.xml',
  );
  fireEvent.press(screen.getByTestId('live-tv-guide-save'));

  await waitFor(() => {
    expect(mockValidateAndSaveLiveTvGuide).toHaveBeenCalledTimes(1);
  });

  view.rerender(renderScreen('b'));

  await waitFor(() => {
    expect(screen.getByTestId('live-tv-guide-url').props.value)
      .toBe('https://b.example/epg.xml');
  });

  await act(async () => {
    resolveSave({
      configured: true,
      sourceRevision: 2,
      secure: false,
      publicUrl: 'https://a.example/new.xml',
    });
    await Promise.resolve();
  });

  expect(screen.getByTestId('live-tv-guide-url').props.value)
    .toBe('https://b.example/epg.xml');
  expect(screen.queryByText('Guide source validated and saved.'))
    .toBeNull();

  await AsyncStorage.removeItem(accountAKeys.config);
  await AsyncStorage.removeItem(accountBKeys.config);
});

test('guide settings reloads the active account scope without leaking the previous account', async () => {
  const accountAKeys = liveTvGuideStorageKeysForUser('a');
  const accountBKeys = liveTvGuideStorageKeysForUser('b');

  await AsyncStorage.setItem(
    accountAKeys.config,
    config('https://a.example/epg.xml'),
  );
  await AsyncStorage.setItem(
    accountBKeys.config,
    config('https://b.example/epg.xml'),
  );

  const view = render(
    <AccountContext.Provider value={account('a')}>
      <I18nContext.Provider value={i18n}>
        <LiveTvGuideSettingsScreen onBack={jest.fn()} />
      </I18nContext.Provider>
    </AccountContext.Provider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId('live-tv-guide-url').props.value)
      .toBe('https://a.example/epg.xml');
  });

  view.rerender(
    <AccountContext.Provider value={account('b')}>
      <I18nContext.Provider value={i18n}>
        <LiveTvGuideSettingsScreen onBack={jest.fn()} />
      </I18nContext.Provider>
    </AccountContext.Provider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId('live-tv-guide-url').props.value)
      .toBe('https://b.example/epg.xml');
  });

  expect(screen.queryByDisplayValue('https://a.example/epg.xml'))
    .toBeNull();

  await AsyncStorage.removeItem(accountAKeys.config);
  await AsyncStorage.removeItem(accountBKeys.config);
});

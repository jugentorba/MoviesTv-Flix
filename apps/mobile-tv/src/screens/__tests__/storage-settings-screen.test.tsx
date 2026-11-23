import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { I18nContext } from '../../i18n/useI18n';
import { StorageSettingsScreen } from '../StorageSettingsScreen';

function copy(key: string, params: Record<string, string> = {}) {
  return translateFrom(APP_RESOURCES.en, APP_RESOURCES.en, key, params);
}

function renderScreen() {
  return render(
    <I18nContext.Provider
      value={{
        locale: 'en',
        direction: 'ltr',
        t: (key: string, params?: Record<string, string>) => copy(key, params),
        setLocale: jest.fn(),
      } as never}
    >
      <StorageSettingsScreen onBack={jest.fn()} />
    </I18nContext.Provider>,
  );
}

const CACHE_KEY = '@moviestv/catalog/v1/home';
const USER_KEY = 'moviestv.addons';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('StorageSettingsScreen', () => {
  it('separates cache from saved data', async () => {
    await AsyncStorage.setItem(CACHE_KEY, 'x'.repeat(2048));
    await AsyncStorage.setItem(USER_KEY, 'y'.repeat(1024));

    renderScreen();

    await waitFor(() => expect(screen.getByText('2.0 KB')).toBeTruthy());
    expect(screen.getByText('1.0 KB')).toBeTruthy();
    // Total is cache + saved data.
    expect(screen.getByText('3.0 KB')).toBeTruthy();
  });

  it('disables clearing when there is no cache to clear', async () => {
    await AsyncStorage.setItem(USER_KEY, 'y'.repeat(64));
    renderScreen();
    await waitFor(() => expect(screen.getByText('0 B')).toBeTruthy());
    const button = screen.getByTestId('storage-clear-cache');
    expect(button.props.accessibilityState?.disabled).toBe(true);
  });

  it('clears only the cache and reports the freed size', async () => {
    await AsyncStorage.setItem(CACHE_KEY, 'x'.repeat(1024));
    await AsyncStorage.setItem(USER_KEY, 'must-survive');

    renderScreen();
    await waitFor(() => expect(screen.getByTestId('storage-clear-cache')).toBeTruthy());

    fireEvent.press(screen.getByTestId('storage-clear-cache'));
    fireEvent.press(screen.getByTestId('storage-clear-confirm'));

    await waitFor(() => expect(screen.getByTestId('storage-result')).toBeTruthy());
    expect(screen.getByText(copy('storage.cleared', { size: '1.0 KB' }))).toBeTruthy();

    // The cache entry is gone; the add-on repository entry is untouched.
    expect(await AsyncStorage.getItem(CACHE_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(USER_KEY)).toBe('must-survive');
  });

  it('lets the user back out of a clear without deleting anything', async () => {
    await AsyncStorage.setItem(CACHE_KEY, 'x'.repeat(1024));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('storage-clear-cache')).toBeTruthy());

    fireEvent.press(screen.getByTestId('storage-clear-cache'));
    fireEvent.press(screen.getByTestId('storage-clear-cancel'));

    expect(screen.queryByTestId('storage-clear-confirm')).toBeNull();
    expect(await AsyncStorage.getItem(CACHE_KEY)).not.toBeNull();
  });
});

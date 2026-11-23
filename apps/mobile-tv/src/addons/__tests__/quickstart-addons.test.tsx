import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QuickstartAddons } from '../AddonQuickstart';
import { quickstartFor } from '../quickstartAddons';
import { AddonsContext, type AddonsApi } from '../useAddons';
import { I18nContext } from '../../i18n/useI18n';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { ThemeProvider } from '../../theme/ThemeProvider';

test('each provider kind gets its own quickstart entry', () => {
  expect(quickstartFor('catalog').map((addon) => addon.id)).toEqual(['com.linvo.cinemeta']);
  expect(quickstartFor('stream').map((addon) => addon.id)).toEqual(['org.stremio.opensubtitlesv3']);
  expect(quickstartFor('live-tv')).toEqual([]);
});

function setup(overrides: Partial<AddonsApi> = {}) {
  const api = {
    installed: [],
    ready: true,
    syncStatus: 'synced' as const,
    error: null,
    refresh: jest.fn(async () => undefined),
    inspectManifest: jest.fn(async () => ({ manifest: { id: 'com.linvo.cinemeta' } })),
    install: jest.fn(async () => ({ installed: { addonId: 'com.linvo.cinemeta' } })),
    configure: jest.fn(),
    setEnabled: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(),
    hasSavedSecret: jest.fn(async () => false),
    ...overrides,
  } as unknown as AddonsApi;

  render(
    <ThemeProvider>
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
        <AddonsContext.Provider value={api}>
          <QuickstartAddons kind="catalog" />
        </AddonsContext.Provider>
      </I18nContext.Provider>
    </ThemeProvider>,
  );

  return api;
}

test('installing goes through the same inspect step as a pasted link', async () => {
  const api = setup();

  fireEvent.press(screen.getByTestId('quickstart-com.linvo.cinemeta-install'));

  await waitFor(() => {
    expect(api.inspectManifest).toHaveBeenCalledWith('https://v3-cinemeta.strem.io/manifest.json');
  });
  await waitFor(() => {
    expect(api.install).toHaveBeenCalledTimes(1);
  });
  await waitFor(() => {
    expect(screen.getByTestId('quickstart-com.linvo.cinemeta-installed')).toBeTruthy();
  });
});

test('an add-on that is already installed shows a check instead of a button', () => {
  setup({
    installed: [{
      installed: { addonId: 'com.linvo.cinemeta' },
      safeConfig: {},
    }] as unknown as AddonsApi['installed'],
  });

  expect(screen.getByTestId('quickstart-com.linvo.cinemeta-installed')).toBeTruthy();
  expect(screen.queryByTestId('quickstart-com.linvo.cinemeta-install')).toBeNull();
});

test('a failed install offers a retry instead of lying', async () => {
  setup({
    inspectManifest: jest.fn(async () => { throw new Error('offline'); }),
  });

  fireEvent.press(screen.getByTestId('quickstart-com.linvo.cinemeta-install'));

  await waitFor(() => {
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});

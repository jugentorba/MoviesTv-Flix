import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { I18nContext } from '../../i18n/useI18n';
import {
  getPwaInstallSnapshot,
  requestPwaInstall,
  subscribePwaInstall,
} from '../../web/pwaInstall';
import { PwaInstallScreen } from '../PwaInstallScreen';

jest.mock('../../web/pwaInstall', () => ({
  getPwaInstallSnapshot: jest.fn(),
  requestPwaInstall: jest.fn(),
  subscribePwaInstall: jest.fn(() => () => undefined),
}));

const mockedSnapshot = getPwaInstallSnapshot as jest.MockedFunction<
  typeof getPwaInstallSnapshot
>;
const mockedRequest = requestPwaInstall as jest.MockedFunction<
  typeof requestPwaInstall
>;
const mockedSubscribe = subscribePwaInstall as jest.MockedFunction<
  typeof subscribePwaInstall
>;

function renderScreen(locale = 'fr') {
  return render(
    <I18nContext.Provider value={{
      locale,
      direction: 'ltr',
      t: (key: string, params?: Record<string, string | number>) => translateFrom(
        APP_RESOURCES[locale as keyof typeof APP_RESOURCES] ?? APP_RESOURCES.en,
        APP_RESOURCES.en,
        key,
        params,
      ),
      formatNumber: String,
      formatDate: String,
      languageName: String,
    }}>
      <PwaInstallScreen onBack={jest.fn()} />
    </I18nContext.Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedSubscribe.mockImplementation(() => () => undefined);
});

test('shows the browser install action when a prompt is available', () => {
  mockedSnapshot.mockReturnValue({
    installed: false,
    promptAvailable: true,
    ios: false,
  });
  mockedRequest.mockResolvedValue('accepted');

  renderScreen();

  expect(screen.getByText(
    'Le navigateur peut installer MoviesTv-Flix comme une application.',
  )).toBeTruthy();

  fireEvent.press(screen.getByTestId('pwa-install-action'));
  expect(mockedRequest).toHaveBeenCalledTimes(1);
});

test('hides the install action when the PWA is already installed', () => {
  mockedSnapshot.mockReturnValue({
    installed: true,
    promptAvailable: false,
    ios: false,
  });

  renderScreen();

  expect(screen.getByText(
    'MoviesTv-Flix est déjà installé sur cet appareil.',
  )).toBeTruthy();
  expect(screen.queryByTestId('pwa-install-action')).toBeNull();
});


test('German install instructions are localized', () => {
  mockedSnapshot.mockReturnValue({
    installed: false,
    promptAvailable: false,
    ios: true,
  });

  renderScreen('de');

  expect(screen.getByText('MoviesTv-Flix installieren')).toBeTruthy();
  expect(screen.getByText(
    'Auf iPhone oder iPad: Öffnen Sie diese Seite in Safari, tippen Sie auf Teilen und wählen Sie dann „Zum Home-Bildschirm“.',
  )).toBeTruthy();
});

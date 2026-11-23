import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { I18nContext } from '../../i18n/useI18n';
import { AddProviderScreen } from '../AddProviderScreen';

jest.mock('../useAddons', () => ({
  useAddons: () => ({
    inspectManifest: jest.fn(),
    install: jest.fn(),
  }),
}));

test('German provider installation copy is localized', () => {
  render(
    <I18nContext.Provider value={{
      locale: 'de',
      direction: 'ltr',
      t: (key: string, params?: Record<string, string | number>) => translateFrom(
        APP_RESOURCES.de,
        APP_RESOURCES.en,
        key,
        params,
      ),
      formatNumber: String,
      formatDate: String,
      languageName: String,
    }}>
      <AddProviderScreen
        kind="catalog"
        onBack={jest.fn()}
        onInstalled={jest.fn()}
      />
    </I18nContext.Provider>,
  );

  expect(screen.getByText('Katalog hinzufügen')).toBeTruthy();
  expect(screen.getByText(
    'Fügen Sie eine Manifest-URL oder einen stremio://-Link ein. MoviesTv-Flix prüft die Funktionen vor der Installation.',
  )).toBeTruthy();
  expect(screen.getByText('Quelle prüfen')).toBeTruthy();
});

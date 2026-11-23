import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { AddonStateRecord } from '@moviestv/addons';
import { ProvidersScreen } from '../ProvidersScreen';
import { AddonsContext, type AddonsApi } from '../useAddons';
import { I18nContext } from '../../i18n/useI18n';

const record: AddonStateRecord = {
  installed: {
    addonId: 'org.example.configured',
    manifestUrl: 'https://example.com/manifest.json',
    sourceType: 'stremio-manifest',
    enabled: true,
    priority: 100,
    installedAt: '2026-09-15T12:00:00.000Z',
    updatedAt: '2026-09-15T12:00:00.000Z',
    setupIncomplete: false,
  },
  safeConfig: { region: 'fr' },
  descriptor: {
    id: 'org.example.configured',
    name: 'Configured Streams',
    version: '1.0.0',
    sourceType: 'stremio-manifest',
    capabilities: ['stream'],
    requiresConfiguration: true,
    configurationFields: [
      { key: 'token', label: 'API token', type: 'secret', required: true, secret: true },
      { key: 'region', label: 'Region', type: 'text', required: false, secret: false },
    ],
    supportedMediaKinds: ['movie'],
    manifestUrl: 'https://example.com/manifest.json',
  },
};

const labels: Record<string, string> = {
  'common.provider': 'Providers',
  'common.back': 'Back',
  'common.loading': 'Loading',
  'common.noResults': 'No results',
  'common.details': 'Details',
  'common.save': 'Save',
  'settings.moveUp': 'Move up',
  'settings.moveDown': 'Move down',
  'settings.remove': 'Remove',
};

test('installed configurable provider can reopen configuration without exposing its saved secret', async () => {
  const api: AddonsApi = {
    installed: [record],
    ready: true,
    syncStatus: 'synced',
    error: null,
    refresh: jest.fn(async () => undefined),
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(async () => record),
    setEnabled: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(async () => undefined),
    hasSavedSecret: jest.fn(async () => true),
  };

  render(
    <AddonsContext.Provider value={api}>
      <I18nContext.Provider value={{
        locale: 'en',
        direction: 'ltr',
        t: (key) => labels[key] ?? key,
        formatNumber: String,
        formatDate: (value) => String(value),
        languageName: (tag) => tag,
      }}>
        <ProvidersScreen onBack={jest.fn()} />
      </I18nContext.Provider>
    </AddonsContext.Provider>,
  );

  fireEvent.press(screen.getByTestId('provider-configure-org.example.configured'));
  await waitFor(() => expect(screen.getByTestId('provider-config-screen')).toBeTruthy());
  await waitFor(() => {
    expect(api.hasSavedSecret).toHaveBeenCalledWith('org.example.configured', 'token');
  });

  expect(screen.getByTestId('provider-config-token').props.value).toBe('');
  expect(screen.getByTestId('provider-config-region').props.value).toBe('fr');
});


test('provider configuration stays usable when saved-secret lookup fails', async () => {
  const api: AddonsApi = {
    installed: [record],
    ready: true,
    syncStatus: 'synced',
    error: null,
    refresh: jest.fn(async () => undefined),
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(async () => record),
    setEnabled: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(async () => undefined),
    hasSavedSecret: jest.fn(async () => {
      throw new Error('secure storage unavailable');
    }),
  };

  render(
    <AddonsContext.Provider value={api}>
      <I18nContext.Provider value={{
        locale: 'en',
        direction: 'ltr',
        t: (key) => labels[key] ?? key,
        formatNumber: String,
        formatDate: (value) => String(value),
        languageName: (tag) => tag,
      }}>
        <ProvidersScreen onBack={jest.fn()} />
      </I18nContext.Provider>
    </AddonsContext.Provider>,
  );

  fireEvent.press(
    screen.getByTestId('provider-configure-org.example.configured'),
  );

  await waitFor(() => {
    expect(api.hasSavedSecret).toHaveBeenCalledWith(
      'org.example.configured',
      'token',
    );
  });

  expect(screen.getByTestId('provider-config-screen')).toBeTruthy();
  expect(screen.getByTestId('provider-config-token').props.value).toBe('');
  expect(screen.getByTestId('provider-config-region').props.value).toBe('fr');
});

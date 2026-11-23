import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { AddonStateRecord } from '@moviestv/addons';
import { ProvidersScreen } from '../ProvidersScreen';
import { AddonsContext, type AddonsApi } from '../useAddons';
import { I18nContext } from '../../i18n/useI18n';
import { dispatchWebTvBack } from '../../web/tvRemoteNavigation';

const inspected = {
  descriptor: {
    id: 'org.example.secure',
    name: 'Secure Streams',
    version: '1.0.0',
    sourceType: 'stremio-manifest' as const,
    capabilities: ['stream' as const],
    requiresConfiguration: true,
    configurationFields: [
      {
        key: 'token',
        label: 'API token',
        type: 'secret' as const,
        required: true,
        secret: true,
      },
    ],
    supportedMediaKinds: ['movie' as const],
    manifestUrl: 'https://secure.example/manifest.json',
  },
  manifestUrl: 'https://secure.example/manifest.json',
  origin: 'manual' as const,
};

const incomplete: AddonStateRecord = {
  installed: {
    addonId: inspected.descriptor.id,
    manifestUrl: inspected.manifestUrl,
    sourceType: 'stremio-manifest',
    enabled: false,
    priority: 100,
    installedAt: '2026-09-15T12:00:00.000Z',
    updatedAt: '2026-09-15T12:00:00.000Z',
    setupIncomplete: true,
  },
  safeConfig: {},
  descriptor: inspected.descriptor,
};

const configured: AddonStateRecord = {
  ...incomplete,
  installed: { ...incomplete.installed, enabled: true, setupIncomplete: false },
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

function setup() {
  const api: AddonsApi = {
    installed: [],
    ready: true,
    syncStatus: 'synced',
    error: null,
    refresh: jest.fn(async () => undefined),
    inspectManifest: jest.fn(async () => inspected),
    install: jest.fn(async () => incomplete),
    configure: jest.fn(async () => configured),
    setEnabled: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(async () => undefined),
    hasSavedSecret: jest.fn(async () => false),
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

  return api;
}

test('incomplete provider install opens secure configuration and saves through the runtime API', async () => {
  const api = setup();

  fireEvent.press(screen.getByTestId('provider-add'));
  fireEvent.changeText(screen.getByTestId('provider-manifest-url'), inspected.manifestUrl);
  fireEvent.press(screen.getByTestId('provider-inspect'));
  await waitFor(() => expect(screen.getByText('Secure Streams')).toBeTruthy());

  fireEvent.press(screen.getByTestId('provider-confirm-install'));
  await waitFor(() => expect(screen.getByTestId('provider-config-screen')).toBeTruthy());

  await waitFor(() => {
    expect(api.hasSavedSecret).toHaveBeenCalledWith('org.example.secure', 'token');
  });
  const secretInput = screen.getByTestId('provider-config-token');
  expect(secretInput.props.secureTextEntry).toBe(true);
  expect(secretInput.props.value).toBe('');

  fireEvent.changeText(secretInput, 'local-secret-value');
  fireEvent.press(screen.getByTestId('provider-config-save'));

  await waitFor(() => {
    expect(api.configure).toHaveBeenCalledWith('org.example.secure', {
      token: 'local-secret-value',
    });
  });
});


test('TV back closes nested provider setup before leaving the provider list', () => {
  setup();

  fireEvent.press(screen.getByTestId('provider-add'));
  expect(screen.getByTestId('provider-manifest-url')).toBeTruthy();

  act(() => {
    expect(dispatchWebTvBack()).toBe(true);
  });
  expect(screen.getByTestId('provider-add')).toBeTruthy();
  expect(screen.queryByTestId('provider-manifest-url')).toBeNull();
});

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { AddonStateRecord } from '@moviestv/addons';
import { ProviderConfigScreen } from '../ProviderConfigScreen';
import { AddonsContext, type AddonsApi } from '../useAddons';
import { I18nContext } from '../../i18n/useI18n';

const record: AddonStateRecord = {
  installed: {
    addonId: 'org.example.fields',
    manifestUrl: 'https://example.com/manifest.json',
    sourceType: 'stremio-manifest',
    enabled: true,
    priority: 100,
    installedAt: '2026-09-15T12:00:00.000Z',
    updatedAt: '2026-09-15T12:00:00.000Z',
    setupIncomplete: false,
  },
  safeConfig: { feature: false, region: 'fr' },
  descriptor: {
    id: 'org.example.fields',
    name: 'Field Types',
    version: '1.0.0',
    sourceType: 'stremio-manifest',
    capabilities: ['stream'],
    requiresConfiguration: true,
    configurationFields: [
      { key: 'feature', label: 'Feature', type: 'boolean', required: false, secret: false },
      {
        key: 'region',
        label: 'Region',
        type: 'select',
        required: true,
        secret: false,
        options: [
          { value: 'fr', label: 'France' },
          { value: 'al', label: 'Albania' },
        ],
      },
    ],
    supportedMediaKinds: ['movie'],
    manifestUrl: 'https://example.com/manifest.json',
  },
};

const labels: Record<string, string> = {
  'common.back': 'Back',
  'common.save': 'Save',
};

test('boolean and select configuration fields use remote-friendly controls and save typed values', async () => {
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
        <ProviderConfigScreen record={record} onBack={jest.fn()} onConfigured={jest.fn()} />
      </I18nContext.Provider>
    </AddonsContext.Provider>,
  );

  const booleanControl = screen.getByTestId('provider-config-feature');
  expect(booleanControl.props.accessibilityRole).toBe('switch');
  expect(booleanControl.props.accessibilityState.checked).toBe(false);
  fireEvent.press(booleanControl);

  fireEvent.press(screen.getByTestId('provider-config-region-option-al'));
  fireEvent.press(screen.getByTestId('provider-config-save'));

  await waitFor(() => {
    expect(api.configure).toHaveBeenCalledWith('org.example.fields', {
      feature: true,
      region: 'al',
    });
  });
});


test('backing out ignores a provider save that finishes later', async () => {
  let releaseSave!: () => void;
  const pendingSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const configure = jest.fn(async () => {
    await pendingSave;
    return record;
  });
  const onBack = jest.fn();
  const onConfigured = jest.fn();
  const api: AddonsApi = {
    installed: [record],
    ready: true,
    syncStatus: 'synced',
    error: null,
    refresh: jest.fn(async () => undefined),
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure,
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
        <ProviderConfigScreen
          record={record}
          onBack={onBack}
          onConfigured={onConfigured}
        />
      </I18nContext.Provider>
    </AddonsContext.Provider>,
  );

  fireEvent.press(screen.getByTestId('provider-config-save'));
  await waitFor(() => expect(configure).toHaveBeenCalledTimes(1));

  expect(
    screen.getByTestId('provider-config-feature').props.accessibilityState,
  ).toEqual({ checked: false, disabled: true });

  fireEvent.press(screen.getByTestId('provider-config-back'));
  expect(onBack).toHaveBeenCalledTimes(1);

  await act(async () => {
    releaseSave();
    await pendingSave;
  });

  expect(onConfigured).not.toHaveBeenCalled();
});

test('shows the configured link so it can be carried to another device by hand', async () => {
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
    hasSavedSecret: jest.fn(async () => false),
    getRuntimeManifestUrl: jest.fn(async () => 'https://example.com/abc123/manifest.json'),
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
        <ProviderConfigScreen record={record} onBack={jest.fn()} onConfigured={jest.fn()} />
      </I18nContext.Provider>
    </AddonsContext.Provider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId('provider-current-link')).toBeTruthy();
  });
  expect(screen.getByText('https://example.com/abc123/manifest.json')).toBeTruthy();
  expect(api.getRuntimeManifestUrl).toHaveBeenCalledWith('org.example.fields');
});

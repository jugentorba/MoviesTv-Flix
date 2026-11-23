import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { AddonStateRecord } from '@moviestv/addons';
import { ProvidersScreen } from '../ProvidersScreen';
import { AddonsContext, type AddonsApi } from '../useAddons';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { I18nContext } from '../../i18n/useI18n';

function makeRecord(addonId: string, name: string, priority: number, enabled: boolean, liveTv = false): AddonStateRecord {
  return {
    installed: {
      addonId,
      manifestUrl: `https://example.com/${addonId}/manifest.json`,
      sourceType: 'stremio-manifest',
      enabled,
      priority,
      installedAt: '2026-09-15T12:00:00.000Z',
      updatedAt: '2026-09-15T12:00:00.000Z',
      setupIncomplete: false,
    },
    safeConfig: {},
    descriptor: {
      id: addonId,
      name,
      version: '1.0.0',
      sourceType: 'stremio-manifest',
      capabilities: liveTv ? ['stream', 'live-tv'] : ['stream'],
      requiresConfiguration: false,
      configurationFields: [],
      supportedMediaKinds: ['movie'],
      ...(liveTv ? { liveTv: { catalogs: [{ type: 'channel' as const, id: 'all', name: 'All' }], streamTypes: ['channel' as const] } } : {}),
      manifestUrl: `https://example.com/${addonId}/manifest.json`,
    },
  };
}

function setup(
  kind: 'stream' | 'live-tv' = 'stream',
  overrides: Partial<AddonsApi> = {},
) {
  const installed = [
    makeRecord('org.example.alpha', 'Alpha Streams', 20, true, true),
    makeRecord('org.example.beta', 'Beta Streams', 10, false),
  ];
  const api: AddonsApi = {
    installed,
    ready: true,
    syncStatus: 'synced',
    error: null,
    refresh: jest.fn(async () => undefined),
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(),
    setEnabled: jest.fn(async () => installed[0]),
    move: jest.fn(async () => installed),
    remove: jest.fn(async () => undefined),
    hasSavedSecret: jest.fn(async () => false),
    ...overrides,
  };

  render(
    <AddonsContext.Provider value={api}>
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
        <ProvidersScreen kind={kind} onBack={jest.fn()} />
      </I18nContext.Provider>
    </AddonsContext.Provider>,
  );

  return api;
}

test('installed provider rows expose remote-friendly management controls', () => {
  const api = setup();

  expect(screen.getByText('Alpha Streams')).toBeTruthy();
  expect(screen.getByText('Beta Streams')).toBeTruthy();
  expect(screen.queryByTestId('provider-capability-live-tv-org.example.alpha')).toBeNull();

  fireEvent.press(screen.getByTestId('provider-toggle-org.example.alpha'));
  expect(api.setEnabled).toHaveBeenCalledWith('org.example.alpha', false);

  fireEvent.press(screen.getByTestId('provider-move-down-org.example.alpha'));
  expect(api.move).toHaveBeenCalledWith('org.example.alpha', 'down');

  fireEvent.press(screen.getByTestId('provider-move-up-org.example.beta'));
  expect(api.move).toHaveBeenCalledWith('org.example.beta', 'up');

  fireEvent.press(screen.getByTestId('provider-remove-org.example.beta'));
  expect(api.remove).toHaveBeenCalledWith('org.example.beta');
});


test('provider mutation failures are surfaced without hiding the list', async () => {
  const setEnabled = jest.fn(async () => {
    throw new Error('Unable to save provider state');
  });
  const api = setup('stream', { setEnabled });

  fireEvent.press(screen.getByTestId('provider-toggle-org.example.alpha'));

  await waitFor(() => {
    expect(screen.getByTestId('provider-mutation-error').props.children)
      .toBe('Unable to save provider state');
  });
  expect(api.setEnabled).toHaveBeenCalledWith('org.example.alpha', false);
  expect(screen.getByText('Alpha Streams')).toBeTruthy();
  expect(screen.getByText('Beta Streams')).toBeTruthy();
});


test('older provider mutation failures do not overwrite a newer successful action', async () => {
  let rejectToggle!: (error: Error) => void;
  const pendingToggle = new Promise<AddonStateRecord>((_resolve, reject) => {
    rejectToggle = reject;
  });
  const setEnabled = jest.fn(() => pendingToggle);
  const move = jest.fn(async () => []);
  setup('stream', { setEnabled, move });

  fireEvent.press(screen.getByTestId('provider-toggle-org.example.alpha'));
  fireEvent.press(screen.getByTestId('provider-move-down-org.example.alpha'));

  await waitFor(() => {
    expect(setEnabled).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledTimes(1);
  });

  await act(async () => {
    rejectToggle(new Error('Old toggle failed'));
    try {
      await pendingToggle;
    } catch {
      // The screen owns and handles the rejected mutation.
    }
  });

  expect(screen.queryByTestId('provider-mutation-error')).toBeNull();
});


test('Live TV provider screen hides stream-only providers', () => {
  setup('live-tv');

  expect(screen.getByText('Alpha Streams')).toBeTruthy();
  expect(screen.queryByText('Beta Streams')).toBeNull();
  expect(screen.getByTestId('provider-capability-live-tv-org.example.alpha')).toBeTruthy();
  expect(screen.getAllByText('Live TV').length).toBeGreaterThan(0);
});

test('setup-incomplete provider cannot be enabled from the provider list', () => {
  const installed = [
    {
      ...makeRecord('org.example.incomplete', 'Incomplete Provider', 20, false),
      installed: {
        ...makeRecord('org.example.incomplete', 'Incomplete Provider', 20, false).installed,
        setupIncomplete: true,
      },
    },
  ];
  const api: AddonsApi = {
    installed,
    ready: true,
    syncStatus: 'synced',
    error: null,
    refresh: jest.fn(async () => undefined),
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(),
    setEnabled: jest.fn(async () => installed[0]),
    move: jest.fn(async () => installed),
    remove: jest.fn(async () => undefined),
    hasSavedSecret: jest.fn(async () => false),
  };

  render(
    <AddonsContext.Provider value={api}>
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
        <ProvidersScreen kind="stream" onBack={jest.fn()} />
      </I18nContext.Provider>
    </AddonsContext.Provider>,
  );

  expect(screen.getByText('Setup required')).toBeTruthy();
  expect(
    screen.getByTestId('provider-setup-detail-org.example.incomplete')
      .props.children,
  ).toContain('Private links and credentials are never synced');
  const toggle = screen.getByTestId('provider-toggle-org.example.incomplete');
  expect(toggle.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  fireEvent.press(toggle);
  expect(api.setEnabled).not.toHaveBeenCalled();
});



test('German provider management uses first-party setup copy', () => {
  const installed = [
    {
      ...makeRecord('org.example.incomplete', 'Incomplete Provider', 20, false),
      installed: {
        ...makeRecord('org.example.incomplete', 'Incomplete Provider', 20, false).installed,
        setupIncomplete: true,
      },
    },
  ];
  const api: AddonsApi = {
    installed,
    ready: true,
    syncStatus: 'synced',
    error: null,
    refresh: jest.fn(async () => undefined),
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(),
    setEnabled: jest.fn(async () => installed[0]),
    move: jest.fn(async () => installed),
    remove: jest.fn(async () => undefined),
    hasSavedSecret: jest.fn(async () => false),
  };

  render(
    <AddonsContext.Provider value={api}>
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
        formatDate: (value) => String(value),
        languageName: (tag) => tag,
      }}>
        <ProvidersScreen kind="stream" onBack={jest.fn()} />
      </I18nContext.Provider>
    </AddonsContext.Provider>,
  );

  expect(screen.getByText('Einrichtung erforderlich')).toBeTruthy();
  expect(screen.getByText('Deaktiviert')).toBeTruthy();
  expect(screen.getByText('Wiedergabe')).toBeTruthy();
});

test('a provider synced from another device explains how to finish its setup', () => {
  // This is what the second device holds: identity and safe config, but no
  // manifest URL, because the private link is never synchronized.
  const synced: AddonStateRecord = {
    installed: {
      addonId: 'org.example.synced',
      sourceType: 'stremio-manifest',
      enabled: true,
      priority: 5,
      installedAt: '2026-09-15T12:00:00.000Z',
      updatedAt: '2026-09-15T12:00:00.000Z',
      setupIncomplete: true,
    },
    safeConfig: {},
    syncIdentity: {
      name: 'Synced Streams',
      capabilities: ['stream'],
      supportedMediaKinds: ['movie'],
      configurable: true,
    },
  };

  setup('stream', { installed: [synced] });

  expect(screen.getByTestId('providers-setup-banner')).toBeTruthy();
  expect(screen.getByText('Finish setup')).toBeTruthy();

  fireEvent.press(screen.getByTestId('provider-replace-manifest-org.example.synced'));
  expect(screen.getByText('Update provider manifest URL')).toBeTruthy();
});

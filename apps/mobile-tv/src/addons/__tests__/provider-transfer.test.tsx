import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { encodeProviderSetupCode } from '@moviestv/addons';

import { ProviderTransferScreen } from '../ProviderTransferScreen';
import { AddonsContext, type AddonsApi } from '../useAddons';
import { I18nContext } from '../../i18n/useI18n';

const entry = {
  addonId: 'stremio.comet.fast',
  manifestUrl: 'https://comet.example/abc/manifest.json',
  secrets: { debridApiKey: 'KEY' },
};

const labels: Record<string, string> = {
  'common.back': 'Back',
  'common.loading': 'Loading',
  'common.unavailable': 'Unavailable',
  'providers.transferTitle': 'Move providers between devices',
  'providers.transferHint': 'Copy the code.',
  'providers.transferExport': 'Code for this device',
  'providers.transferEmpty': 'No configured providers to transfer yet.',
  'providers.transferPaste': 'Paste a setup code',
  'providers.transferApply': 'Apply code',
  'providers.transferResult': 'Applied {count} provider(s).',
  'providers.transferSkipped': 'Skipped {count} provider(s) not installed on this device.',
};

function renderScreen(api: Partial<AddonsApi>) {
  const value = {
    installed: [],
    ready: true,
    syncStatus: 'synced',
    error: null,
    refresh: jest.fn(async () => undefined),
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(),
    setEnabled: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(async () => undefined),
    hasSavedSecret: jest.fn(async () => false),
    ...api,
  } as AddonsApi;

  render(
    <AddonsContext.Provider value={value}>
      <I18nContext.Provider value={{
        locale: 'en',
        direction: 'ltr',
        t: (key, params) => (labels[key] ?? key).replace(
          '{count}',
          String((params as { count?: number } | undefined)?.count ?? ''),
        ),
        formatNumber: String,
        formatDate: (value) => String(value),
        languageName: (tag) => tag,
      }}>
        <ProviderTransferScreen onBack={jest.fn()} />
      </I18nContext.Provider>
    </AddonsContext.Provider>,
  );

  return value;
}

test('shows a setup code built from this device', async () => {
  renderScreen({ exportProviderSetup: jest.fn(async () => [entry]) });

  await waitFor(() => {
    expect(screen.getByTestId('provider-transfer-code')).toBeTruthy();
  });
  expect(screen.getByTestId('provider-transfer-code').props.children)
    .toBe(encodeProviderSetupCode([entry]));
});

test('explains when there is nothing to transfer', async () => {
  renderScreen({ exportProviderSetup: jest.fn(async () => []) });

  await waitFor(() => {
    expect(screen.getByTestId('provider-transfer-empty')).toBeTruthy();
  });
});

test('applies a pasted code through the runtime API', async () => {
  const applyProviderSetup = jest.fn(async () => ({ applied: 1, skipped: 0 }));
  renderScreen({
    exportProviderSetup: jest.fn(async () => [entry]),
    applyProviderSetup,
  });

  fireEvent.changeText(
    screen.getByTestId('provider-transfer-input'),
    encodeProviderSetupCode([entry]),
  );
  fireEvent.press(screen.getByTestId('provider-transfer-apply'));

  await waitFor(() => {
    expect(applyProviderSetup).toHaveBeenCalledWith([entry]);
  });
  expect(screen.getByText('Applied 1 provider(s).')).toBeTruthy();
});

test('rejects a code that is not ours without calling the API', async () => {
  const applyProviderSetup = jest.fn();
  renderScreen({
    exportProviderSetup: jest.fn(async () => [entry]),
    applyProviderSetup,
  });

  fireEvent.changeText(screen.getByTestId('provider-transfer-input'), 'not-a-code');
  fireEvent.press(screen.getByTestId('provider-transfer-apply'));

  await waitFor(() => {
    expect(screen.getByText('That is not a MoviesTv-Flix setup code.')).toBeTruthy();
  });
  expect(applyProviderSetup).not.toHaveBeenCalled();
});

import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import type { AddonDescriptor, AddonStateRecord } from '@moviestv/addons';
import { AddonsProvider } from '../AddonsProvider';
import { useAddons, type AddonsApi } from '../useAddons';

const descriptor: AddonDescriptor = {
  id: 'org.example.one',
  name: 'Example',
  version: '1.0.0',
  sourceType: 'stremio-manifest',
  capabilities: ['stream'],
  requiresConfiguration: false,
  configurationFields: [],
  supportedMediaKinds: ['movie'],
  manifestUrl: 'https://example.com/manifest.json',
};

function record(enabled = true): AddonStateRecord {
  return {
    installed: {
      addonId: descriptor.id,
      manifestUrl: descriptor.manifestUrl,
      sourceType: 'stremio-manifest',
      enabled,
      priority: 100,
      installedAt: '2026-09-15T12:00:00.000Z',
      updatedAt: '2026-09-15T12:00:00.000Z',
      setupIncomplete: false,
    },
    safeConfig: {},
    descriptor,
  };
}

function Probe({ onApi }: { onApi?: (api: AddonsApi) => void }) {
  const api = useAddons();
  useEffect(() => { onApi?.(api); }, [api, onApi]);
  return (
    <Text testID="addons-probe">
      {`${api.ready}:${api.syncStatus}:${api.installed.map((item) => item.installed.addonId).join(',')}`}
    </Text>
  );
}

test('loads reconciled provider state for the active user', async () => {
  const installed = record();
  const coordinator = {
    load: jest.fn(async () => ({ records: [installed], syncStatus: 'synced' as const, error: null })),
    push: jest.fn(),
    remove: jest.fn(),
  };
  const service = {
    inspectManifest: jest.fn(), install: jest.fn(), configure: jest.fn(),
    setEnabled: jest.fn(), move: jest.fn(), remove: jest.fn(),
  };
  const secrets = { get: jest.fn(async () => null) };

  render(
    <AddonsProvider userId="user-1" coordinator={coordinator} service={service} secrets={secrets}>
      <Probe />
    </AddonsProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId('addons-probe').props.children).toBe('true:synced:org.example.one');
  });
  expect(coordinator.load).toHaveBeenCalledWith('user-1');
});

test('hydrates descriptor metadata restored from cloud without pushing it back as synced user state', async () => {
  const synchronized: AddonStateRecord = {
    ...record(false),
    descriptor: undefined,
    installed: {
      ...record(false).installed,
      setupIncomplete: true,
    },
  };
  const hydrated: AddonStateRecord = { ...synchronized, descriptor };
  const coordinator = {
    load: jest.fn(async () => ({ records: [synchronized], syncStatus: 'synced' as const, error: null })),
    push: jest.fn(),
    remove: jest.fn(),
  };
  const service = {
    hydrate: jest.fn(async () => hydrated),
    inspectManifest: jest.fn(), install: jest.fn(), configure: jest.fn(),
    setEnabled: jest.fn(), move: jest.fn(), remove: jest.fn(),
  };
  const secrets = { get: jest.fn(async () => null) };
  let api: AddonsApi | undefined;

  render(
    <AddonsProvider userId="user-1" coordinator={coordinator} service={service} secrets={secrets}>
      <Probe onApi={(value) => { api = value; }} />
    </AddonsProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));
  expect(service.hydrate).toHaveBeenCalledWith(synchronized);
  expect(api?.installed).toEqual([hydrated]);
  expect(coordinator.push).not.toHaveBeenCalled();
});

test('keeps a validated public provider enabled after cross-device hydration', async () => {
  const synchronized: AddonStateRecord = {
    ...record(true),
    descriptor: undefined,
    syncIdentity: {
      name: 'Example',
      capabilities: ['stream'],
      supportedMediaKinds: ['movie'],
      configurable: false,
    },
    installed: {
      ...record(true).installed,
      setupIncomplete: true,
    },
  };
  const hydrated: AddonStateRecord = {
    ...synchronized,
    descriptor,
    installed: {
      ...synchronized.installed,
      setupIncomplete: false,
    },
  };
  const coordinator = {
    load: jest.fn(async () => ({
      records: [synchronized],
      syncStatus: 'synced' as const,
      error: null,
    })),
    push: jest.fn(),
    remove: jest.fn(),
  };
  const service = {
    hydrate: jest.fn(async () => hydrated),
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(),
    setEnabled: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(),
  };
  const secrets = { get: jest.fn(async () => null) };
  let api: AddonsApi | undefined;

  render(
    <AddonsProvider
      userId="user-1"
      coordinator={coordinator}
      service={service}
      secrets={secrets}
    >
      <Probe onApi={(value) => { api = value; }} />
    </AddonsProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));
  expect(api?.installed[0]?.installed).toEqual(
    expect.objectContaining({
      enabled: true,
      setupIncomplete: false,
    }),
  );
  expect(coordinator.push).not.toHaveBeenCalled();
});

test('automatic safe provider restore preserves a synced disabled preference', async () => {
  const configurableDescriptor: AddonDescriptor = {
    ...descriptor,
    configurable: true,
    configurationFields: [
      {
        key: 'language',
        label: 'Language',
        type: 'text',
        required: true,
        secret: false,
      },
      {
        key: 'region',
        label: 'Region',
        type: 'text',
        required: true,
        secret: false,
      },
    ],
  };
  const synchronized: AddonStateRecord = {
    ...record(false),
    installed: {
      ...record(false).installed,
      enabled: false,
      setupIncomplete: true,
    },
    safeConfig: {
      language: 'fr-FR',
      region: 'FR',
    },
    descriptor: undefined,
    syncIdentity: {
      name: 'Example',
      capabilities: ['stream'],
      supportedMediaKinds: ['movie'],
      configurable: true,
    },
  };
  const hydrated: AddonStateRecord = {
    ...synchronized,
    descriptor: configurableDescriptor,
  };
  const configured: AddonStateRecord = {
    ...hydrated,
    installed: {
      ...hydrated.installed,
      enabled: true,
      setupIncomplete: false,
    },
  };
  const disabledAgain: AddonStateRecord = {
    ...configured,
    installed: {
      ...configured.installed,
      enabled: false,
    },
  };
  const coordinator = {
    load: jest.fn(async () => ({
      records: [synchronized],
      syncStatus: 'synced' as const,
      error: null,
    })),
    push: jest.fn(),
    remove: jest.fn(),
  };
  const service = {
    hydrate: jest.fn(async () => hydrated),
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(async () => configured),
    setEnabled: jest.fn(async () => disabledAgain),
    move: jest.fn(),
    remove: jest.fn(),
  };
  const secrets = { get: jest.fn(async () => null) };
  let api: AddonsApi | undefined;

  render(
    <AddonsProvider
      userId="user-1"
      coordinator={coordinator}
      service={service}
      secrets={secrets}
    >
      <Probe onApi={(value) => { api = value; }} />
    </AddonsProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));

  expect(service.configure).toHaveBeenCalledWith(
    descriptor.id,
    {
      language: 'fr-FR',
      region: 'FR',
    },
  );
  expect(service.setEnabled).toHaveBeenCalledWith(
    descriptor.id,
    false,
  );
  expect(api?.installed[0]?.installed).toEqual(
    expect.objectContaining({
      enabled: false,
      setupIncomplete: false,
    }),
  );
  expect(coordinator.push).not.toHaveBeenCalled();
});

test('automatic safe provider restore keeps a synced enabled preference without a redundant toggle', async () => {
  const configurableDescriptor: AddonDescriptor = {
    ...descriptor,
    configurable: true,
    configurationFields: [{
      key: 'region',
      label: 'Region',
      type: 'text',
      required: true,
      secret: false,
    }],
  };
  const synchronized: AddonStateRecord = {
    ...record(true),
    installed: {
      ...record(true).installed,
      enabled: true,
      setupIncomplete: true,
    },
    safeConfig: { region: 'FR' },
    descriptor: undefined,
    syncIdentity: {
      name: 'Example',
      capabilities: ['stream'],
      supportedMediaKinds: ['movie'],
      configurable: true,
    },
  };
  const hydrated: AddonStateRecord = {
    ...synchronized,
    installed: {
      ...synchronized.installed,
      enabled: false,
    },
    descriptor: configurableDescriptor,
  };
  const configured: AddonStateRecord = {
    ...hydrated,
    installed: {
      ...hydrated.installed,
      enabled: true,
      setupIncomplete: false,
    },
  };
  const coordinator = {
    load: jest.fn(async () => ({
      records: [synchronized],
      syncStatus: 'synced' as const,
      error: null,
    })),
    push: jest.fn(),
    remove: jest.fn(),
  };
  const service = {
    hydrate: jest.fn(async () => hydrated),
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(async () => configured),
    setEnabled: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(),
  };
  const secrets = { get: jest.fn(async () => null) };
  let api: AddonsApi | undefined;

  render(
    <AddonsProvider
      userId="user-1"
      coordinator={coordinator}
      service={service}
      secrets={secrets}
    >
      <Probe onApi={(value) => { api = value; }} />
    </AddonsProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));

  expect(service.configure).toHaveBeenCalledTimes(1);
  expect(service.setEnabled).not.toHaveBeenCalled();
  expect(api?.installed[0]?.installed).toEqual(
    expect.objectContaining({
      enabled: true,
      setupIncomplete: false,
    }),
  );
});

test('installs locally, pushes only through the coordinator, and updates provider state immediately', async () => {
  const installed = record();
  const coordinator = {
    load: jest.fn(async () => ({ records: [], syncStatus: 'synced' as const, error: null })),
    push: jest.fn(async () => 'synced' as const),
    remove: jest.fn(),
  };
  const service = {
    inspectManifest: jest.fn(),
    install: jest.fn(async () => installed),
    configure: jest.fn(), setEnabled: jest.fn(), move: jest.fn(), remove: jest.fn(),
  };
  const secrets = { get: jest.fn(async () => null) };
  let api: AddonsApi | undefined;

  render(
    <AddonsProvider userId="user-1" coordinator={coordinator} service={service} secrets={secrets}>
      <Probe onApi={(value) => { api = value; }} />
    </AddonsProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));
  await act(async () => {
    await api!.install({ descriptor, manifestUrl: descriptor.manifestUrl!, origin: 'manual' }, {});
  });

  expect(service.install).toHaveBeenCalledTimes(1);
  expect(coordinator.push).toHaveBeenCalledWith('user-1', installed);
  expect(api?.installed).toEqual([installed]);
  expect(api?.syncStatus).toBe('synced');
});

test('reads secret presence through the injected secure boundary', async () => {
  const coordinator = {
    load: jest.fn(async () => ({ records: [], syncStatus: 'local' as const, error: null })),
    push: jest.fn(),
    remove: jest.fn(),
  };
  const service = {
    inspectManifest: jest.fn(), install: jest.fn(), configure: jest.fn(),
    setEnabled: jest.fn(), move: jest.fn(), remove: jest.fn(),
  };
  const secrets = {
    get: jest.fn(async (providerId: string, fieldKey: string) =>
      providerId === 'org.example.one' && fieldKey === 'token' ? 'saved-token' : null),
  };
  let api: AddonsApi | undefined;

  render(
    <AddonsProvider coordinator={coordinator} service={service} secrets={secrets}>
      <Probe onApi={(value) => { api = value; }} />
    </AddonsProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));
  await expect(api!.hasSavedSecret('org.example.one', 'token')).resolves.toBe(true);
  expect(secrets.get).toHaveBeenCalledWith('org.example.one', 'token');
});


test('secret-presence checks cannot complete across an account switch', async () => {
  let resolveSecret!: (value: string | null) => void;
  const pendingSecret = new Promise<string | null>((resolve) => {
    resolveSecret = resolve;
  });
  const coordinator = {
    load: jest.fn(async () => ({
      records: [],
      syncStatus: 'local' as const,
      error: null,
    })),
    push: jest.fn(),
    remove: jest.fn(),
  };
  const service = {
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(),
    setEnabled: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(),
  };
  const secrets = {
    get: jest.fn(() => pendingSecret),
  };
  let api: AddonsApi | undefined;

  const view = render(
    <AddonsProvider
      userId="user-1"
      coordinator={coordinator}
      service={service}
      secrets={secrets}
    >
      <Probe onApi={(value) => { api = value; }} />
    </AddonsProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));

  const oldIdentityCheck = api!.hasSavedSecret(
    'org.example.one',
    'token',
  );

  view.rerender(
    <AddonsProvider
      userId="user-2"
      coordinator={coordinator}
      service={service}
      secrets={secrets}
    >
      <Probe onApi={(value) => { api = value; }} />
    </AddonsProvider>,
  );

  resolveSecret('saved-token');

  await expect(oldIdentityCheck).resolves.toBe(false);
});

test('account switch clears old providers while the new identity loads', async () => {
  let resolveB!: (value: {
    records: AddonStateRecord[];
    syncStatus: 'synced';
    error: null;
  }) => void;
  const pendingB = new Promise<{
    records: AddonStateRecord[];
    syncStatus: 'synced';
    error: null;
  }>((resolve) => {
    resolveB = resolve;
  });
  const installed = record();
  const coordinator = {
    load: jest.fn(async (userId: string | null) => (
      userId === 'user-1'
        ? { records: [installed], syncStatus: 'synced' as const, error: null }
        : pendingB
    )),
    push: jest.fn(),
    remove: jest.fn(),
  };
  const service = {
    inspectManifest: jest.fn(), install: jest.fn(), configure: jest.fn(),
    setEnabled: jest.fn(), move: jest.fn(), remove: jest.fn(),
  };
  const secrets = { get: jest.fn(async () => null) };

  const view = render(
    <AddonsProvider
      userId="user-1"
      coordinator={coordinator}
      service={service}
      secrets={secrets}
    >
      <Probe />
    </AddonsProvider>,
  );

  await waitFor(() => {
    expect(screen.getByTestId('addons-probe').props.children)
      .toBe('true:synced:org.example.one');
  });

  view.rerender(
    <AddonsProvider
      userId="user-2"
      coordinator={coordinator}
      service={service}
      secrets={secrets}
    >
      <Probe />
    </AddonsProvider>,
  );

  expect(screen.getByTestId('addons-probe').props.children)
    .toBe('false:local:');

  resolveB({ records: [], syncStatus: 'synced', error: null });
  await waitFor(() => {
    expect(screen.getByTestId('addons-probe').props.children)
      .toBe('true:synced:');
  });
});


test('does not auto-configure a credential-url provider after its local runtime endpoint is lost', async () => {
  const credentialUrlDescriptor: AddonDescriptor = {
    ...descriptor,
    configurable: true,
    configurationFields: [],
    manifestUrl: undefined,
  };
  const incomplete: AddonStateRecord = {
    ...record(false),
    installed: {
      ...record(false).installed,
      manifestUrl: undefined,
      enabled: false,
      setupIncomplete: true,
    },
    descriptor: credentialUrlDescriptor,
    safeConfig: { region: 'fr' },
  };
  const coordinator = {
    load: jest.fn(async () => ({
      records: [incomplete],
      syncStatus: 'synced' as const,
      error: null,
    })),
    push: jest.fn(),
    remove: jest.fn(),
  };
  const service = {
    hydrate: jest.fn(async () => incomplete),
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(),
    setEnabled: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(),
  };
  const secrets = { get: jest.fn(async () => null) };
  let api: AddonsApi | undefined;

  render(
    <AddonsProvider
      userId="user-1"
      coordinator={coordinator}
      service={service}
      secrets={secrets}
    >
      <Probe onApi={(value) => { api = value; }} />
    </AddonsProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));

  expect(service.configure).not.toHaveBeenCalled();
  expect(api?.installed[0]?.installed).toEqual(expect.objectContaining({
    enabled: false,
    setupIncomplete: true,
  }));
});


test('bounds concurrent restored provider hydration', async () => {
  const records: AddonStateRecord[] = Array.from(
    { length: 20 },
    (_, index) => {
      const addonId = `org.example.${index}`;
      return {
        ...record(),
        installed: {
          ...record().installed,
          addonId,
          priority: 1_000 - index,
        },
        descriptor: {
          ...descriptor,
          id: addonId,
        },
      };
    },
  );
  let active = 0;
  let maxActive = 0;
  const coordinator = {
    load: jest.fn(async () => ({
      records,
      syncStatus: 'synced' as const,
      error: null,
    })),
    push: jest.fn(),
    remove: jest.fn(),
  };
  const service = {
    hydrate: jest.fn(async (value: AddonStateRecord) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return value;
    }),
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(),
    setEnabled: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(),
  };
  const secrets = { get: jest.fn(async () => null) };
  let api: AddonsApi | undefined;

  render(
    <AddonsProvider
      userId="user-1"
      coordinator={coordinator}
      service={service}
      secrets={secrets}
    >
      <Probe onApi={(value) => { api = value; }} />
    </AddonsProvider>,
  );

  await waitFor(() => expect(api?.ready).toBe(true));

  expect(service.hydrate).toHaveBeenCalledTimes(20);
  expect(maxActive).toBeLessThanOrEqual(8);
  expect(api?.installed.map((item) => item.installed.addonId)).toEqual(
    records.map((item) => item.installed.addonId),
  );
});

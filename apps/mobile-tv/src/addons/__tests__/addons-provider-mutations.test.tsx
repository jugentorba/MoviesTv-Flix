import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, render, waitFor } from '@testing-library/react-native';
import type { AddonDescriptor, AddonStateRecord } from '@moviestv/addons';
import { AddonsProvider } from '../AddonsProvider';
import { useAddons, type AddonsApi } from '../useAddons';

function makeRecord(addonId: string, priority: number, enabled = true): AddonStateRecord {
  const descriptor: AddonDescriptor = {
    id: addonId,
    name: addonId,
    version: '1.0.0',
    sourceType: 'stremio-manifest',
    capabilities: ['stream'],
    requiresConfiguration: false,
    configurationFields: [],
    supportedMediaKinds: ['movie'],
    manifestUrl: `https://example.com/${addonId}/manifest.json`,
  };
  return {
    installed: {
      addonId,
      manifestUrl: descriptor.manifestUrl,
      sourceType: 'stremio-manifest',
      enabled,
      priority,
      installedAt: '2026-09-15T12:00:00.000Z',
      updatedAt: '2026-09-15T12:00:00.000Z',
      setupIncomplete: false,
    },
    safeConfig: {},
    descriptor,
  };
}

function Probe({ onApi }: { onApi: (api: AddonsApi) => void }) {
  const api = useAddons();
  useEffect(() => { onApi(api); }, [api, onApi]);
  return <Text>{api.installed.length}</Text>;
}

function setup(initial: AddonStateRecord[], serviceOverrides: Record<string, unknown> = {}) {
  const coordinator = {
    load: jest.fn(async () => ({ records: initial, syncStatus: 'synced' as const, error: null })),
    push: jest.fn(async () => 'synced' as const),
    remove: jest.fn(async () => 'synced' as const),
  };
  const service = {
    inspectManifest: jest.fn(), install: jest.fn(), configure: jest.fn(),
    setEnabled: jest.fn(), move: jest.fn(), remove: jest.fn(),
    ...serviceOverrides,
  };
  const secrets = { get: jest.fn(async () => null) };
  let api: AddonsApi | undefined;

  render(
    <AddonsProvider userId="user-1" coordinator={coordinator} service={service} secrets={secrets}>
      <Probe onApi={(value) => { api = value; }} />
    </AddonsProvider>,
  );

  return { coordinator, service, getApi: () => api };
}

test('configure updates local state and safely pushes the resulting provider record', async () => {
  const before = makeRecord('org.example.one', 100, false);
  const after = { ...before, safeConfig: { region: 'al' }, installed: { ...before.installed, enabled: true } };
  const { coordinator, service, getApi } = setup([before], {
    configure: jest.fn(async () => after),
  });

  await waitFor(() => expect(getApi()?.ready).toBe(true));
  await act(async () => {
    await getApi()!.configure('org.example.one', { region: 'al' });
  });

  expect(service.configure).toHaveBeenCalledWith('org.example.one', { region: 'al' });
  expect(coordinator.push).toHaveBeenCalledWith('user-1', after);
  expect(getApi()?.installed).toEqual([after]);
});

test('setEnabled persists the returned provider state through the coordinator', async () => {
  const before = makeRecord('org.example.one', 100, true);
  const after = { ...before, installed: { ...before.installed, enabled: false } };
  const { coordinator, service, getApi } = setup([before], {
    setEnabled: jest.fn(async () => after),
  });

  await waitFor(() => expect(getApi()?.ready).toBe(true));
  await act(async () => {
    await getApi()!.setEnabled('org.example.one', false);
  });

  expect(service.setEnabled).toHaveBeenCalledWith('org.example.one', false);
  expect(coordinator.push).toHaveBeenCalledWith('user-1', after);
  expect(getApi()?.installed[0]?.installed.enabled).toBe(false);
});

test('serializes rapid provider mutations so the newest state is applied last', async () => {
  const before = makeRecord('org.example.one', 100, true);
  const disabled = {
    ...before,
    installed: {
      ...before.installed,
      enabled: false,
      updatedAt: '2026-09-15T12:01:00.000Z',
    },
  };
  const enabledAgain = {
    ...before,
    installed: {
      ...before.installed,
      enabled: true,
      updatedAt: '2026-09-15T12:02:00.000Z',
    },
  };

  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let callCount = 0;
  const setEnabled = jest.fn(async (_addonId: string, enabled: boolean) => {
    callCount += 1;
    if (callCount === 1) await firstGate;
    return enabled ? enabledAgain : disabled;
  });

  const { coordinator, getApi } = setup([before], { setEnabled });
  await waitFor(() => expect(getApi()?.ready).toBe(true));

  let first!: Promise<AddonStateRecord>;
  act(() => {
    first = getApi()!.setEnabled('org.example.one', false);
  });
  await waitFor(() => expect(setEnabled).toHaveBeenCalledTimes(1));

  let second!: Promise<AddonStateRecord>;
  act(() => {
    second = getApi()!.setEnabled('org.example.one', true);
  });

  await act(async () => {
    await Promise.resolve();
  });
  expect(setEnabled).toHaveBeenCalledTimes(1);

  releaseFirst();
  await act(async () => {
    await Promise.all([first, second]);
  });

  expect(setEnabled).toHaveBeenNthCalledWith(
    1,
    'org.example.one',
    false,
  );
  expect(setEnabled).toHaveBeenNthCalledWith(
    2,
    'org.example.one',
    true,
  );
  expect(coordinator.push).toHaveBeenNthCalledWith(
    1,
    'user-1',
    disabled,
  );
  expect(coordinator.push).toHaveBeenNthCalledWith(
    2,
    'user-1',
    enabledAgain,
  );
  expect(getApi()?.installed[0]?.installed.enabled).toBe(true);
});

test('provider refresh waits for an in-flight mutation', async () => {
  const before = makeRecord('org.example.one', 100, true);
  const disabled = {
    ...before,
    installed: {
      ...before.installed,
      enabled: false,
      updatedAt: '2026-09-15T12:01:00.000Z',
    },
  };

  let releaseToggle!: () => void;
  const toggleGate = new Promise<void>((resolve) => {
    releaseToggle = resolve;
  });
  const setEnabled = jest.fn(async () => {
    await toggleGate;
    return disabled;
  });

  const { coordinator, getApi } = setup([before], { setEnabled });
  await waitFor(() => expect(getApi()?.ready).toBe(true));
  expect(coordinator.load).toHaveBeenCalledTimes(1);

  coordinator.load.mockResolvedValue({
    records: [disabled],
    syncStatus: 'synced' as const,
    error: null,
  });

  let toggle!: Promise<AddonStateRecord>;
  act(() => {
    toggle = getApi()!.setEnabled('org.example.one', false);
  });
  await waitFor(() => expect(setEnabled).toHaveBeenCalledTimes(1));

  let refresh!: Promise<void>;
  act(() => {
    refresh = getApi()!.refresh();
  });

  await act(async () => {
    await Promise.resolve();
  });
  expect(coordinator.load).toHaveBeenCalledTimes(1);

  releaseToggle();
  await act(async () => {
    await Promise.all([toggle, refresh]);
  });

  expect(coordinator.load).toHaveBeenCalledTimes(2);
  expect(getApi()?.installed[0]?.installed.enabled).toBe(false);
});

test('account handoff hides old providers and rejects callbacks captured by the previous account', async () => {
  const accountARecord = makeRecord('org.example.a', 100, true);
  const accountBRecord = makeRecord('org.example.b', 100, true);

  let releaseB!: () => void;
  const bGate = new Promise<void>((resolve) => {
    releaseB = resolve;
  });

  const coordinatorA = {
    load: jest.fn(async () => ({
      records: [accountARecord],
      syncStatus: 'synced' as const,
      error: null,
    })),
    push: jest.fn(async () => 'synced' as const),
    remove: jest.fn(async () => 'synced' as const),
  };
  const coordinatorB = {
    load: jest.fn(async () => {
      await bGate;
      return {
        records: [accountBRecord],
        syncStatus: 'synced' as const,
        error: null,
      };
    }),
    push: jest.fn(async () => 'synced' as const),
    remove: jest.fn(async () => 'synced' as const),
  };
  const serviceA = {
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(),
    setEnabled: jest.fn(async () => ({
      ...accountARecord,
      installed: {
        ...accountARecord.installed,
        enabled: false,
      },
    })),
    move: jest.fn(),
    remove: jest.fn(),
  };
  const serviceB = {
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(),
    setEnabled: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(),
  };
  const secrets = { get: jest.fn(async () => null) };
  let api: AddonsApi | undefined;

  const view = render(
    <AddonsProvider
      userId="account-a"
      coordinator={coordinatorA}
      service={serviceA}
      secrets={secrets}
    >
      <Probe onApi={(value) => { api = value; }} />
    </AddonsProvider>,
  );

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(api?.installed).toEqual([accountARecord]);
  });
  const accountAApi = api!;

  view.rerender(
    <AddonsProvider
      userId="account-b"
      coordinator={coordinatorB}
      service={serviceB}
      secrets={secrets}
    >
      <Probe onApi={(value) => { api = value; }} />
    </AddonsProvider>,
  );

  await waitFor(() => {
    expect(coordinatorB.load).toHaveBeenCalledTimes(1);
    expect(api?.ready).toBe(false);
    expect(api?.installed).toEqual([]);
  });

  await expect(
    accountAApi.setEnabled('org.example.a', false),
  ).rejects.toThrow('Provider context changed');
  expect(serviceA.setEnabled).not.toHaveBeenCalled();
  expect(serviceB.setEnabled).not.toHaveBeenCalled();

  releaseB();

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(api?.installed).toEqual([accountBRecord]);
  });
});

test('new account delete cannot reuse hidden metadata from the previous account', async () => {
  const sharedRecord = makeRecord('org.example.shared', 100, true);

  let releaseB!: () => void;
  const bGate = new Promise<void>((resolve) => {
    releaseB = resolve;
  });

  const coordinatorA = {
    load: jest.fn(async () => ({
      records: [sharedRecord],
      syncStatus: 'synced' as const,
      error: null,
    })),
    push: jest.fn(async () => 'synced' as const),
    remove: jest.fn(async () => 'synced' as const),
  };
  const coordinatorB = {
    load: jest.fn(async () => {
      await bGate;
      return {
        records: [],
        syncStatus: 'synced' as const,
        error: null,
      };
    }),
    push: jest.fn(async () => 'synced' as const),
    remove: jest.fn(async () => 'synced' as const),
  };
  const serviceA = {
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(),
    setEnabled: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(),
  };
  const serviceB = {
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(),
    setEnabled: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(async () => undefined),
  };
  const secrets = { get: jest.fn(async () => null) };
  let api: AddonsApi | undefined;

  const view = render(
    <AddonsProvider
      userId="account-a"
      coordinator={coordinatorA}
      service={serviceA}
      secrets={secrets}
    >
      <Probe onApi={(value) => { api = value; }} />
    </AddonsProvider>,
  );

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(api?.installed).toEqual([sharedRecord]);
  });

  view.rerender(
    <AddonsProvider
      userId="account-b"
      coordinator={coordinatorB}
      service={serviceB}
      secrets={secrets}
    >
      <Probe onApi={(value) => { api = value; }} />
    </AddonsProvider>,
  );

  await waitFor(() => {
    expect(coordinatorB.load).toHaveBeenCalledTimes(1);
    expect(api?.ready).toBe(false);
    expect(api?.installed).toEqual([]);
  });

  let removing!: Promise<void>;
  act(() => {
    removing = api!.remove('org.example.shared');
  });

  await waitFor(() => {
    expect(coordinatorB.remove).toHaveBeenCalledWith(
      'account-b',
      'org.example.shared',
      undefined,
    );
  });

  releaseB();
  await act(async () => {
    await removing;
  });
});

test('late provider mutation from a previous account cannot replace the current account state', async () => {
  const accountARecord = makeRecord('org.example.a', 100, true);
  const accountBRecord = makeRecord('org.example.b', 100, true);
  const disabledA = {
    ...accountARecord,
    installed: {
      ...accountARecord.installed,
      enabled: false,
      updatedAt: '2026-09-15T12:01:00.000Z',
    },
  };

  let releaseOldMutation!: () => void;
  const oldMutationGate = new Promise<void>((resolve) => {
    releaseOldMutation = resolve;
  });
  const oldSetEnabled = jest.fn(async () => {
    await oldMutationGate;
    return disabledA;
  });

  const coordinatorA = {
    load: jest.fn(async () => ({
      records: [accountARecord],
      syncStatus: 'synced' as const,
      error: null,
    })),
    push: jest.fn(async () => 'synced' as const),
    remove: jest.fn(async () => 'synced' as const),
  };
  const coordinatorB = {
    load: jest.fn(async () => ({
      records: [accountBRecord],
      syncStatus: 'synced' as const,
      error: null,
    })),
    push: jest.fn(async () => 'synced' as const),
    remove: jest.fn(async () => 'synced' as const),
  };
  const serviceA = {
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(),
    setEnabled: oldSetEnabled,
    move: jest.fn(),
    remove: jest.fn(),
  };
  const serviceB = {
    inspectManifest: jest.fn(),
    install: jest.fn(),
    configure: jest.fn(),
    setEnabled: jest.fn(),
    move: jest.fn(),
    remove: jest.fn(),
  };
  const secrets = { get: jest.fn(async () => null) };
  let api: AddonsApi | undefined;
  const probe = () => (
    <Probe onApi={(value) => { api = value; }} />
  );

  const view = render(
    <AddonsProvider
      userId="account-a"
      coordinator={coordinatorA}
      service={serviceA}
      secrets={secrets}
    >
      {probe()}
    </AddonsProvider>,
  );

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(api?.installed[0]?.installed.addonId).toBe('org.example.a');
  });

  let oldMutation!: Promise<AddonStateRecord>;
  act(() => {
    oldMutation = api!.setEnabled('org.example.a', false);
  });
  await waitFor(() => expect(oldSetEnabled).toHaveBeenCalledTimes(1));

  view.rerender(
    <AddonsProvider
      userId="account-b"
      coordinator={coordinatorB}
      service={serviceB}
      secrets={secrets}
    >
      {probe()}
    </AddonsProvider>,
  );

  await waitFor(() => {
    expect(api?.ready).toBe(true);
    expect(api?.installed[0]?.installed.addonId).toBe('org.example.b');
  });

  releaseOldMutation();
  await act(async () => {
    await oldMutation;
  });

  expect(api?.installed).toEqual([accountBRecord]);
  expect(coordinatorA.push).toHaveBeenCalledWith(
    'account-a',
    disabledA,
  );
  expect(coordinatorB.push).not.toHaveBeenCalled();
});

test('move replaces the ordered state and pushes every changed priority', async () => {
  const first = makeRecord('org.example.one', 20);
  const second = makeRecord('org.example.two', 10);
  const movedSecond = { ...second, installed: { ...second.installed, priority: 20 } };
  const movedFirst = { ...first, installed: { ...first.installed, priority: 10 } };
  const { coordinator, service, getApi } = setup([first, second], {
    move: jest.fn(async () => [movedSecond, movedFirst]),
  });

  await waitFor(() => expect(getApi()?.ready).toBe(true));
  await act(async () => {
    await getApi()!.move('org.example.two', 'up');
  });

  expect(service.move).toHaveBeenCalledWith('org.example.two', 'up');
  expect(coordinator.push).toHaveBeenNthCalledWith(1, 'user-1', movedSecond);
  expect(coordinator.push).toHaveBeenNthCalledWith(2, 'user-1', movedFirst);
  expect(getApi()?.installed.map((item) => item.installed.addonId)).toEqual([
    'org.example.two', 'org.example.one',
  ]);
});

test('remove deletes locally, removes safe cloud metadata, and confirms the item is gone', async () => {
  const before = makeRecord('org.example.one', 100);
  const { coordinator, service, getApi } = setup([before], {
    remove: jest.fn(async () => undefined),
  });

  await waitFor(() => expect(getApi()?.ready).toBe(true));
  coordinator.load.mockResolvedValue({
    records: [],
    syncStatus: 'synced' as const,
    error: null,
  });

  await act(async () => {
    await getApi()!.remove('org.example.one');
  });

  expect(service.remove).toHaveBeenCalledWith('org.example.one');
  expect(coordinator.remove).toHaveBeenCalledWith(
    'user-1',
    'org.example.one',
    before.installed.updatedAt,
  );
  expect(coordinator.load).toHaveBeenCalledTimes(2);
  expect(getApi()?.installed).toEqual([]);
});

test('remove restores a newer cloud provider when the stale delete loses the conflict', async () => {
  const before = makeRecord('org.example.one', 100);
  const newer = {
    ...before,
    safeConfig: { region: 'al' },
    installed: {
      ...before.installed,
      enabled: true,
      priority: 150,
      updatedAt: '2026-09-20T14:05:00.000Z',
    },
  };
  const { coordinator, getApi } = setup([before], {
    remove: jest.fn(async () => undefined),
  });

  await waitFor(() => expect(getApi()?.ready).toBe(true));
  coordinator.load.mockResolvedValue({
    records: [newer],
    syncStatus: 'synced' as const,
    error: null,
  });

  await act(async () => {
    await getApi()!.remove('org.example.one');
  });

  expect(coordinator.remove).toHaveBeenCalledWith(
    'user-1',
    'org.example.one',
    before.installed.updatedAt,
  );
  expect(getApi()?.installed).toEqual([newer]);
  expect(getApi()?.syncStatus).toBe('synced');
});

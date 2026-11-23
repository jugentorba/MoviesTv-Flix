import { stableTextCompare } from '@moviestv/core';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import {
  isSensitiveAddonConfigField,
  type AddonInstallOrigin,
  type AddonStateRecord,
  type ProviderSetupEntry,
} from '@moviestv/addons';
import type { AddonStateSnapshot, AddonSyncStatus } from './AddonStateCoordinator';
import type { InspectedAddon } from './AddonInstallationService';
import { safeProviderErrorMessage } from './providerError';
import { RUNTIME_MANIFEST_URL_SECRET_KEY } from './SecureAddonSecretStore';
import { AddonsContext, type AddonsApi } from './useAddons';

interface AddonCoordinator {
  load(userId: string | null): Promise<AddonStateSnapshot>;
  push(userId: string | null, record: AddonStateRecord): Promise<AddonSyncStatus>;
  remove(
    userId: string | null,
    addonId: string,
    previousUpdatedAt?: string,
  ): Promise<AddonSyncStatus>;
}

interface AddonService {
  hydrate?(record: AddonStateRecord): Promise<AddonStateRecord>;
  inspectManifest(input: string, origin?: AddonInstallOrigin): Promise<InspectedAddon>;
  install(inspected: InspectedAddon, values: Record<string, unknown>): Promise<AddonStateRecord>;
  configure(addonId: string, values: Record<string, unknown>): Promise<AddonStateRecord>;
  setEnabled(addonId: string, enabled: boolean): Promise<AddonStateRecord>;
  move(addonId: string, direction: 'up' | 'down'): Promise<AddonStateRecord[]>;
  remove(addonId: string): Promise<void>;
}

interface AddonSecretReader {
  get(providerId: string, fieldKey: string): Promise<string | null>;
}

const MAX_RESTORED_PROVIDER_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]!, index);
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );

  return results;
}

export interface AddonsProviderProps {
  children: ReactNode;
  userId?: string | null;
  coordinator: AddonCoordinator;
  service: AddonService;
  secrets: AddonSecretReader;
}

function enqueueMutation<T>(
  queue: MutableRefObject<Promise<void>>,
  operation: () => Promise<T>,
): Promise<T> {
  const run = queue.current
    .catch(() => undefined)
    .then(operation);
  queue.current = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function upsertRecord(records: readonly AddonStateRecord[], next: AddonStateRecord): AddonStateRecord[] {
  const result = records.filter((record) => record.installed.addonId !== next.installed.addonId);
  result.push(next);
  return result.sort((left, right) =>
    right.installed.priority - left.installed.priority
    || stableTextCompare(left.installed.addonId, right.installed.addonId));
}

async function hydrateRestoredRecords(
  records: readonly AddonStateRecord[],
  service: AddonService,
): Promise<AddonStateRecord[]> {
  return mapWithConcurrency(
    records,
    MAX_RESTORED_PROVIDER_CONCURRENCY,
    async (record) => {
    const desiredEnabled = record.installed.enabled;
    let hydrated = record;
    if (service.hydrate) {
      try {
        hydrated = await service.hydrate(record);
      } catch {
        return record;
      }
    }

    if (
      hydrated.installed.setupIncomplete
      && hydrated.descriptor?.configurable
      && hydrated.descriptor.configurationFields.length > 0
      && Object.keys(hydrated.safeConfig).length > 0
    ) {
      try {
        const configured = await service.configure(
          hydrated.installed.addonId,
          hydrated.safeConfig,
        );
        if (
          !configured.installed.setupIncomplete
          && configured.installed.enabled !== desiredEnabled
        ) {
          return await service.setEnabled(
            configured.installed.addonId,
            desiredEnabled,
          );
        }
        return configured;
      } catch {
        return hydrated;
      }
    }

    return hydrated;
  },
  );
}

export function AddonsProvider({
  children,
  userId = null,
  coordinator,
  service,
  secrets,
}: AddonsProviderProps) {
  const [installed, setInstalled] = useState<AddonStateRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<AddonSyncStatus>('local');
  const [error, setError] = useState<string | null>(null);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const identityGenerationRef = useRef(1);
  const loadedGenerationRef = useRef<number | null>(null);
  const runtimeIdentityRef = useRef({
    userId,
    coordinator,
    service,
    secrets,
  });

  const runtimeChanged = (
    runtimeIdentityRef.current.userId !== userId
    || runtimeIdentityRef.current.coordinator !== coordinator
    || runtimeIdentityRef.current.service !== service
    || runtimeIdentityRef.current.secrets !== secrets
  );
  if (runtimeChanged) {
    runtimeIdentityRef.current = {
      userId,
      coordinator,
      service,
      secrets,
    };
    identityGenerationRef.current += 1;
    loadedGenerationRef.current = null;
    mutationQueueRef.current = Promise.resolve();
  }

  const renderGeneration = identityGenerationRef.current;
  const identityLoaded = (
    loadedGenerationRef.current === renderGeneration
  );
  const visibleInstalled = identityLoaded ? installed : [];
  const visibleReady = identityLoaded && ready;
  const visibleSyncStatus = identityLoaded ? syncStatus : 'local';
  const visibleError = identityLoaded ? error : null;

  const loadSnapshot = useCallback(async () => {
    const snapshot = await coordinator.load(userId);
    return {
      ...snapshot,
      records: await hydrateRestoredRecords(snapshot.records, service),
    };
  }, [coordinator, service, userId]);

  const refresh = useCallback(() => {
    const generation = renderGeneration;
    if (generation !== identityGenerationRef.current) {
      return Promise.resolve();
    }
    return enqueueMutation(mutationQueueRef, async () => {
      if (generation !== identityGenerationRef.current) return;
      const snapshot = await loadSnapshot();
      if (generation !== identityGenerationRef.current) return;
      setInstalled(snapshot.records);
      setSyncStatus(snapshot.syncStatus);
      setError(snapshot.error);
      loadedGenerationRef.current = generation;
      setReady(true);
    });
  }, [loadSnapshot, renderGeneration]);

  useEffect(() => {
    const generation = identityGenerationRef.current;
    let active = true;
    setInstalled([]);
    setReady(false);
    setSyncStatus('local');
    setError(null);
    void loadSnapshot().then((snapshot) => {
      if (
        !active
        || generation !== identityGenerationRef.current
      ) return;
      setInstalled(snapshot.records);
      setSyncStatus(snapshot.syncStatus);
      setError(snapshot.error);
      loadedGenerationRef.current = generation;
      setReady(true);
    }).catch((cause) => {
      if (
        !active
        || generation !== identityGenerationRef.current
      ) return;
      // A failed restore must not leave provider setup stuck on a spinner.
      // Keep the error visible so the user can retry loading providers.
      setInstalled([]);
      setSyncStatus('error');
      setError(safeProviderErrorMessage(
        cause,
        'Could not load providers. Please retry.',
      ));
      loadedGenerationRef.current = generation;
      setReady(true);
    });
    return () => { active = false; };
  }, [loadSnapshot, renderGeneration]);

  const pushRecord = useCallback(async (
    record: AddonStateRecord,
    generation: number,
  ) => {
    try {
      const status = await coordinator.push(userId, record);
      if (generation !== identityGenerationRef.current) return;
      setSyncStatus(status);
      setError(null);
    } catch (cause) {
      if (generation !== identityGenerationRef.current) return;
      setSyncStatus('error');
      setError(safeProviderErrorMessage(
        cause,
        'Could not synchronize provider.',
      ));
    }
  }, [coordinator, userId]);

  const inspectManifest = useCallback((
    input: string,
    origin: AddonInstallOrigin = 'manual',
  ) => {
    if (renderGeneration !== identityGenerationRef.current) {
      return Promise.reject(
        new Error('Provider context changed'),
      );
    }
    return service.inspectManifest(input, origin);
  }, [renderGeneration, service]);

  const install = useCallback((
    inspected: InspectedAddon,
    values: Record<string, unknown>,
  ) => {
    const generation = renderGeneration;
    if (generation !== identityGenerationRef.current) {
      return Promise.reject(
        new Error('Provider context changed'),
      );
    }
    return enqueueMutation(mutationQueueRef, async () => {
      if (generation !== identityGenerationRef.current) {
        throw new Error('Provider context changed');
      }
      const record = await service.install(inspected, values);
      if (generation === identityGenerationRef.current) {
        setInstalled((current) => upsertRecord(current, record));
      }
      await pushRecord(record, generation);
      return record;
    });
  }, [pushRecord, renderGeneration, service]);

  const configure = useCallback((
    addonId: string,
    values: Record<string, unknown>,
  ) => {
    const generation = renderGeneration;
    if (generation !== identityGenerationRef.current) {
      return Promise.reject(
        new Error('Provider context changed'),
      );
    }
    return enqueueMutation(mutationQueueRef, async () => {
      if (generation !== identityGenerationRef.current) {
        throw new Error('Provider context changed');
      }
      const record = await service.configure(addonId, values);
      if (generation === identityGenerationRef.current) {
        setInstalled((current) => upsertRecord(current, record));
      }
      await pushRecord(record, generation);
      return record;
    });
  }, [pushRecord, renderGeneration, service]);

  const setEnabled = useCallback((
    addonId: string,
    enabled: boolean,
  ) => {
    const generation = renderGeneration;
    if (generation !== identityGenerationRef.current) {
      return Promise.reject(
        new Error('Provider context changed'),
      );
    }
    return enqueueMutation(mutationQueueRef, async () => {
      if (generation !== identityGenerationRef.current) {
        throw new Error('Provider context changed');
      }
      const record = await service.setEnabled(addonId, enabled);
      if (generation === identityGenerationRef.current) {
        setInstalled((current) => upsertRecord(current, record));
      }
      await pushRecord(record, generation);
      return record;
    });
  }, [pushRecord, renderGeneration, service]);

  const move = useCallback((
    addonId: string,
    direction: 'up' | 'down',
  ) => {
    const generation = renderGeneration;
    if (generation !== identityGenerationRef.current) {
      return Promise.reject(
        new Error('Provider context changed'),
      );
    }
    return enqueueMutation(mutationQueueRef, async () => {
      if (generation !== identityGenerationRef.current) {
        throw new Error('Provider context changed');
      }
      const records = await service.move(addonId, direction);
      if (generation === identityGenerationRef.current) {
        setInstalled(records);
      }
      for (const record of records) {
        await pushRecord(record, generation);
      }
      return records;
    });
  }, [pushRecord, renderGeneration, service]);

  const remove = useCallback((
    addonId: string,
  ) => {
    const generation = renderGeneration;
    if (generation !== identityGenerationRef.current) {
      return Promise.resolve();
    }
    return enqueueMutation(mutationQueueRef, async () => {
      if (generation !== identityGenerationRef.current) return;
      const previousUpdatedAt = visibleInstalled.find(
        (record) => record.installed.addonId === addonId,
      )?.installed.updatedAt;
      await service.remove(addonId);
      if (generation === identityGenerationRef.current) {
        setInstalled((current) => current.filter(
          (record) => record.installed.addonId !== addonId,
        ));
      }
      try {
        await coordinator.remove(
          userId,
          addonId,
          previousUpdatedAt,
        );
        if (generation !== identityGenerationRef.current) return;

        const confirmed = await loadSnapshot();
        if (generation !== identityGenerationRef.current) return;

        setInstalled(confirmed.records);
        setSyncStatus(confirmed.syncStatus);
        setError(confirmed.error);
      } catch (cause) {
        if (generation !== identityGenerationRef.current) return;
        setSyncStatus('error');
        setError(safeProviderErrorMessage(
          cause,
          'Could not synchronize provider removal.',
        ));
      }
    });
  }, [
    coordinator,
    loadSnapshot,
    renderGeneration,
    service,
    userId,
    visibleInstalled,
  ]);

  const hasSavedSecret = useCallback(async (
    addonId: string,
    fieldKey: string,
  ) => {
    const generation = renderGeneration;
    if (generation !== identityGenerationRef.current) {
      return false;
    }

    const value = await secrets.get(addonId, fieldKey);
    if (generation !== identityGenerationRef.current) {
      return false;
    }
    return Boolean(value?.trim());
  }, [renderGeneration, secrets]);

  const getRuntimeManifestUrl = useCallback(async (addonId: string) => {
    const value = await secrets.get(addonId, RUNTIME_MANIFEST_URL_SECRET_KEY);
    return value?.trim() ? value : null;
  }, [secrets]);

  const exportProviderSetup = useCallback(async (): Promise<ProviderSetupEntry[]> => {
    const entries: ProviderSetupEntry[] = [];
    for (const record of visibleInstalled) {
      const descriptor = record.descriptor;
      if (!descriptor) continue;
      const manifestUrl = await secrets.get(
        record.installed.addonId,
        RUNTIME_MANIFEST_URL_SECRET_KEY,
      );
      if (!manifestUrl?.trim()) continue;

      const values: Record<string, string> = {};
      for (const field of descriptor.configurationFields) {
        if (!isSensitiveAddonConfigField(field)) continue;
        const value = await secrets.get(record.installed.addonId, field.key);
        if (value?.trim()) values[field.key] = value;
      }

      entries.push({
        addonId: record.installed.addonId,
        manifestUrl,
        secrets: values,
      });
    }
    return entries;
  }, [secrets, visibleInstalled]);

  const applyProviderSetup = useCallback(async (
    entries: readonly ProviderSetupEntry[],
  ): Promise<{ applied: number; skipped: number }> => {
    const writer = secrets as AddonSecretReader & {
      set?: (providerId: string, fieldKey: string, value: string) => Promise<void>;
    };
    if (!writer.set) return { applied: 0, skipped: entries.length };

    let applied = 0;
    let skipped = 0;
    for (const entry of entries) {
      const installed = visibleInstalled.some(
        (record) => record.installed.addonId === entry.addonId,
      );
      if (!installed) {
        skipped += 1;
        continue;
      }
      await writer.set(entry.addonId, RUNTIME_MANIFEST_URL_SECRET_KEY, entry.manifestUrl);
      for (const [key, value] of Object.entries(entry.secrets)) {
        await writer.set(entry.addonId, key, value);
      }
      applied += 1;
    }
    if (applied > 0) await refresh();
    return { applied, skipped };
  }, [refresh, secrets, visibleInstalled]);

  const api = useMemo<AddonsApi>(() => ({
    installed: visibleInstalled,
    ready: visibleReady,
    syncStatus: visibleSyncStatus,
    error: visibleError,
    refresh,
    inspectManifest,
    install,
    configure,
    setEnabled,
    move,
    remove,
    hasSavedSecret,
    getRuntimeManifestUrl,
    exportProviderSetup,
    applyProviderSetup,
  }), [
    configure,
    hasSavedSecret,
    getRuntimeManifestUrl,
    exportProviderSetup,
    applyProviderSetup,
    inspectManifest,
    install,
    move,
    refresh,
    remove,
    setEnabled,
    visibleError,
    visibleInstalled,
    visibleReady,
    visibleSyncStatus,
  ]);

  return <AddonsContext.Provider value={api}>{children}</AddonsContext.Provider>;
}

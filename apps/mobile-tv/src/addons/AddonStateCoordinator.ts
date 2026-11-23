import {
  isSensitiveAddonConfigField,
  reconcileInstalledAddons,
  toSafeAddonSyncRecord,
  type AddonStateRecord,
  type SafeAddonSyncRecord,
} from '@moviestv/addons';
import { RUNTIME_MANIFEST_URL_SECRET_KEY } from './SecureAddonSecretStore';
import { safeProviderErrorMessage } from './providerError';

export type AddonSyncStatus = 'local' | 'synced' | 'error';

export interface AddonStateSnapshot {
  records: AddonStateRecord[];
  syncStatus: AddonSyncStatus;
  error: string | null;
}

interface PendingAddonRemoval {
  addonId: string;
  removedAt: string;
}

const LEGACY_REMOVAL_TIMESTAMP = '1970-01-01T00:00:00.000Z';

interface AddonStateRepository {
  list(): Promise<AddonStateRecord[]>;
  save(record: AddonStateRecord): Promise<void>;
  remove?(addonId: string): Promise<void>;
  pendingUpsertIds?(): Promise<string[]>;
  pendingRemovalIds?(): Promise<string[]>;
  pendingRemovals?(): Promise<PendingAddonRemoval[]>;
  markPendingUpsert?(addonId: string): Promise<void>;
  clearPendingUpsert?(addonId: string): Promise<void>;
  markPendingRemoval?(
    addonId: string,
    removedAt?: string,
  ): Promise<void>;
  clearPendingRemoval?(addonId: string): Promise<void>;
}

interface AddonSecretReader {
  get(providerId: string, fieldKey: string): Promise<string | null>;
  deleteProvider?(
    providerId: string,
    fieldKeys: readonly string[],
  ): Promise<void>;
}

interface AddonCloudGateway {
  list(userId: string): Promise<SafeAddonSyncRecord[]>;
  upsert(userId: string, record: SafeAddonSyncRecord): Promise<void>;
  remove(
    userId: string,
    addonId: string,
    notNewerThan?: string,
  ): Promise<boolean | void>;
}

function syncRecord(record: AddonStateRecord): SafeAddonSyncRecord {
  const safe = toSafeAddonSyncRecord(
    record.installed,
    record.descriptor?.configurationFields ?? [],
    record.safeConfig,
    record.descriptor,
  );

  if (!safe.identity && record.syncIdentity) {
    safe.identity = {
      ...record.syncIdentity,
      capabilities: [...record.syncIdentity.capabilities],
      supportedMediaKinds: [...record.syncIdentity.supportedMediaKinds],
    };
  }

  return safe;
}


function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function monotonicTimestamp(
  current: string,
  previous?: string,
): string {
  const currentMs = Date.parse(current);
  const previousMs = previous
    ? Date.parse(previous)
    : Number.NEGATIVE_INFINITY;
  const baseMs = Number.isFinite(currentMs)
    ? currentMs
    : Date.now();
  const nextMs = Number.isFinite(previousMs)
    && baseMs <= previousMs
    ? Math.min(previousMs + 1, 8_640_000_000_000_000)
    : baseMs;
  return new Date(nextMs).toISOString();
}

function shouldUploadLocalRecord(
  local: AddonStateRecord,
  remote: SafeAddonSyncRecord | undefined,
  pendingUpsertIds: ReadonlySet<string>,
): boolean {
  if (!remote) {
    return pendingUpsertIds.has(local.installed.addonId);
  }

  const localUpdatedAt = timestampMs(local.installed.updatedAt);
  const remoteUpdatedAt = timestampMs(remote.updatedAt);
  if (localUpdatedAt <= remoteUpdatedAt) {
    return false;
  }

  const comparableLocal = syncRecord(local);
  if (
    local.installed.setupIncomplete
    && !remote.setupIncomplete
  ) {
    // A device-local setup/secret gate must never overwrite the cloud's
    // synchronized enabled state when both records represent the same edit.
    comparableLocal.enabled = remote.enabled;
    comparableLocal.setupIncomplete = remote.setupIncomplete;
  }

  return JSON.stringify(comparableLocal) !== JSON.stringify(remote);
}

async function locallyConfiguredIds(
  records: readonly AddonStateRecord[],
  secrets: AddonSecretReader,
): Promise<Set<string>> {
  const configured = new Set<string>();

  for (const record of records) {
    const requiredSecrets = record.descriptor?.configurationFields.filter(
      (field) => field.required && isSensitiveAddonConfigField(field),
    ) ?? [];
    const requiresRuntimeEndpoint = Boolean(
      record.descriptor?.configurable
      || record.syncIdentity?.configurable
      || (
        record.descriptor
        && !record.installed.manifestUrl
        && !record.descriptor.manifestUrl
      ),
    );
    if (requiredSecrets.length === 0 && !requiresRuntimeEndpoint) continue;

    const values = await Promise.all(
      requiredSecrets.map((field) => secrets.get(record.installed.addonId, field.key)),
    );
    const runtimeEndpoint = requiresRuntimeEndpoint
      ? await secrets.get(record.installed.addonId, RUNTIME_MANIFEST_URL_SECRET_KEY)
      : 'not-required';

    if (
      values.every((value) => Boolean(value?.trim()))
      && Boolean(runtimeEndpoint?.trim())
    ) {
      configured.add(record.installed.addonId);
    }
  }

  return configured;
}

export class AddonStateCoordinator {
  constructor(
    private readonly repository: AddonStateRepository,
    private readonly secrets: AddonSecretReader,
    private readonly cloud?: AddonCloudGateway,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async load(userId: string | null): Promise<AddonStateSnapshot> {
    const local = await this.repository.list();
    if (!this.cloud || !userId) {
      return { records: local, syncStatus: 'local', error: null };
    }

    let effectiveRecords = local;

    try {
      let remote = await this.cloud.list(userId);
      const pendingRemovals = this.repository.pendingRemovals
        ? await this.repository.pendingRemovals()
        : (
          await this.repository.pendingRemovalIds?.() ?? []
        ).map((addonId) => ({
          addonId,
          removedAt: LEGACY_REMOVAL_TIMESTAMP,
        }));

      for (const pending of pendingRemovals) {
        const removed = await this.cloud.remove(
          userId,
          pending.addonId,
          pending.removedAt,
        );

        if (removed === false) {
          // The row may have been changed by another device after this local
          // removal, or already disappeared. Re-read before reconciliation so
          // a stale snapshot is never used to resurrect or delete the wrong
          // provider state.
          remote = await this.cloud.list(userId);
        } else {
          remote = remote.filter(
            (record) => record.addonId !== pending.addonId,
          );
        }

        await this.repository.clearPendingRemoval?.(
          pending.addonId,
        );
      }

      const pendingUpsertIds = new Set(
        await this.repository.pendingUpsertIds?.() ?? [],
      );
      const remoteById = new Map(
        remote.map((record) => [record.addonId, record]),
      );

      const filteredLocal: AddonStateRecord[] = [];
      for (const record of local) {
        const addonId = record.installed.addonId;
        if (
          remoteById.has(addonId)
          || pendingUpsertIds.has(addonId)
        ) {
          filteredLocal.push(record);
          continue;
        }

        const fields = record.descriptor?.configurationFields
          .filter(isSensitiveAddonConfigField)
          .map((field) => field.key) ?? [];

        await this.repository.remove?.(addonId);
        try {
          await this.secrets.deleteProvider?.(
            addonId,
            [...fields, RUNTIME_MANIFEST_URL_SECRET_KEY],
          );
        } catch (error) {
          // Keep local provider state and its device-only runtime secrets as
          // one logical unit. If secure cleanup fails, restore the record so
          // the next sync can retry instead of leaving an unusable half-delete.
          await this.repository.save(record);
          throw error;
        }
      }

      const localToUpload = filteredLocal.filter((record) => (
        shouldUploadLocalRecord(
          record,
          remoteById.get(record.installed.addonId),
          pendingUpsertIds,
        )
      ));
      const uploadIds = new Set(
        localToUpload.map((record) => record.installed.addonId),
      );
      const localIds = new Set(
        filteredLocal.map((record) => record.installed.addonId),
      );

      for (const addonId of pendingUpsertIds) {
        if (uploadIds.has(addonId)) continue;
        if (remoteById.has(addonId) || !localIds.has(addonId)) {
          await this.repository.clearPendingUpsert?.(addonId);
        }
      }

      const configuredIds = await locallyConfiguredIds(
        filteredLocal,
        this.secrets,
      );
      const records = reconcileInstalledAddons(
        filteredLocal,
        remote,
        configuredIds,
      );
      for (const record of records) {
        await this.repository.save(record);
      }
      effectiveRecords = records;

      for (const record of localToUpload) {
        const addonId = record.installed.addonId;
        await this.repository.markPendingUpsert?.(addonId);
        await this.cloud.upsert(userId, syncRecord(record));
        await this.repository.clearPendingUpsert?.(addonId);
      }

      return { records, syncStatus: 'synced', error: null };
    } catch (cause) {
      return {
        records: effectiveRecords,
        syncStatus: 'error',
        error: safeProviderErrorMessage(
          cause,
          'Could not synchronize providers.',
        ),
      };
    }
  }

  async push(
    userId: string | null,
    record: AddonStateRecord,
  ): Promise<AddonSyncStatus> {
    if (!this.cloud || !userId) return 'local';

    const addonId = record.installed.addonId;
    await this.repository.markPendingUpsert?.(addonId);
    try {
      await this.cloud.upsert(userId, syncRecord(record));
      await this.repository.clearPendingUpsert?.(addonId);
      return 'synced';
    } catch (cause) {
      await this.repository.markPendingUpsert?.(addonId);
      throw cause;
    }
  }

  async remove(
    userId: string | null,
    addonId: string,
    previousUpdatedAt?: string,
  ): Promise<AddonSyncStatus> {
    if (!this.cloud || !userId) return 'local';

    const removedAt = monotonicTimestamp(
      this.now(),
      previousUpdatedAt,
    );
    await this.repository.markPendingRemoval?.(
      addonId,
      removedAt,
    );
    try {
      await this.cloud.remove(
        userId,
        addonId,
        removedAt,
      );
      await this.repository.clearPendingRemoval?.(addonId);
      return 'synced';
    } catch (cause) {
      await this.repository.markPendingRemoval?.(
        addonId,
        removedAt,
      );
      throw cause;
    }
  }
}

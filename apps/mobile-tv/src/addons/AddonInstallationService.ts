import { stableTextCompare } from '@moviestv/core';
import {
  buildStremioConfiguredManifestUrl,
  isSafePublicConfiguredManifestUrl,
  isSensitiveAddonConfigField,
  normalizeManifestUrl,
  parseStremioManifest,
  safeManifestUrlForSync,
  sanitizeAddonConfig,
  stremioPublicBaseManifestUrl,
  type AddonConfigField,
  type AddonDescriptor,
  type AddonInstallOrigin,
  type AddonStateRecord,
  type InstalledAddon,
  type SafeAddonConfigValue,
} from '@moviestv/addons';
import { RUNTIME_MANIFEST_URL_SECRET_KEY } from './SecureAddonSecretStore';

interface AddonMetadataRepository {
  list(): Promise<AddonStateRecord[]>;
  save(record: AddonStateRecord): Promise<void>;
  remove(addonId: string): Promise<void>;
  reorder(
    addonIds: readonly string[],
    updatedAt?: string,
  ): Promise<void>;
}

interface AddonSecretRepository {
  get(providerId: string, fieldKey: string): Promise<string | null>;
  set(providerId: string, fieldKey: string, value: string): Promise<void>;
  delete(providerId: string, fieldKey: string): Promise<void>;
  deleteProvider(providerId: string, fieldKeys: readonly string[]): Promise<void>;
}

interface ManifestReader {
  load(input: string, origin: AddonInstallOrigin): Promise<unknown>;
}

export interface InspectedAddon {
  descriptor: AddonDescriptor;
  manifestUrl: string;
  origin: AddonInstallOrigin;
}

function publicManifestUrl(
  descriptor: AddonDescriptor,
  manifestUrl: string,
): string | undefined {
  const stripped = stremioPublicBaseManifestUrl(manifestUrl);
  const candidate = stripped && stripped !== manifestUrl
    ? stripped
    : manifestUrl;
  const safe = safeManifestUrlForSync(candidate);
  if (!safe) return undefined;

  if (!descriptor.configurable) return safe;

  try {
    // Configurable providers normally keep runtime endpoints device-local.
    // TvVoo's country-only cfg-* presets are an explicit public exception;
    // MediaFlow/password-bearing paths do not satisfy the strict helper.
    return (
      new URL(safe).pathname === '/manifest.json'
      || isSafePublicConfiguredManifestUrl(safe)
    )
      ? safe
      : undefined;
  } catch {
    return undefined;
  }
}

function endpointMustStayLocal(_descriptor: AddonDescriptor, manifestUrl: string): boolean {
  return safeManifestUrlForSync(manifestUrl) === undefined;
}

function canApplyStandardConfigurationFromManifestUrl(
  manifestUrl: string,
): boolean {
  const safe = safeManifestUrlForSync(manifestUrl);
  if (safe) return true;

  // A standard Stremio configured URL contains one encoded JSON segment that
  // stremioPublicBaseManifestUrl can safely strip back to a public base.
  // Opaque provider-specific configured paths (for example Lumio/debrid links)
  // must be left untouched instead of appending a second JSON config segment.
  const publicBase = stremioPublicBaseManifestUrl(manifestUrl);
  return Boolean(
    publicBase
    && publicBase !== manifestUrl
    && safeManifestUrlForSync(publicBase),
  );
}

function omitManifestUrl<T extends { manifestUrl?: string }>(value: T): Omit<T, 'manifestUrl'> {
  const copy = { ...value };
  delete copy.manifestUrl;
  return copy;
}

function persistedRecord(record: AddonStateRecord): AddonStateRecord {
  const descriptor = record.descriptor;
  const runtimeUrl = descriptor?.manifestUrl ?? record.installed.manifestUrl;
  if (!descriptor || !runtimeUrl || !endpointMustStayLocal(descriptor, runtimeUrl)) {
    return record;
  }

  const baseManifestUrl = record.installed.manifestUrl
    ? safeManifestUrlForSync(record.installed.manifestUrl)
    : undefined;

  return {
    ...record,
    installed: baseManifestUrl
      ? { ...record.installed, manifestUrl: baseManifestUrl }
      : omitManifestUrl(record.installed),
    descriptor: omitManifestUrl(descriptor),
  };
}

function runtimeRecord(
  record: AddonStateRecord,
  manifestUrl: string | null | undefined,
): AddonStateRecord {
  if (!manifestUrl || !record.descriptor) return record;
  return {
    ...record,
    descriptor: {
      ...record.descriptor,
      manifestUrl,
    },
  };
}

function scalarPresent(value: SafeAddonConfigValue | undefined): boolean {
  return typeof value === 'boolean' || (typeof value === 'string' && value.trim().length > 0);
}

function secretValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function explicitlyClearsSecret(
  descriptor: AddonDescriptor,
  values: Record<string, unknown>,
): boolean {
  return descriptor.configurationFields.some((field) => (
    isSensitiveAddonConfigField(field)
    && Object.prototype.hasOwnProperty.call(values, field.key)
    && secretValue(values[field.key]) === null
  ));
}


function defaultConfigValues(descriptor: AddonDescriptor): Record<string, SafeAddonConfigValue> {
  return Object.fromEntries(
    descriptor.configurationFields
      .filter((field) => !isSensitiveAddonConfigField(field) && field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue as SafeAddonConfigValue]),
  );
}

async function persistSecrets(
  descriptor: AddonDescriptor,
  values: Record<string, unknown>,
  secrets: AddonSecretRepository,
): Promise<void> {
  for (const field of descriptor.configurationFields) {
    if (!isSensitiveAddonConfigField(field)) continue;
    if (!Object.prototype.hasOwnProperty.call(values, field.key)) continue;

    const value = secretValue(values[field.key]);
    if (value !== null) {
      await secrets.set(descriptor.id, field.key, value);
    } else {
      // Secret inputs are blank when a saved value is left untouched. In
      // that case the field is absent from values. An explicitly submitted
      // blank key therefore means the user wants the saved credential gone.
      await secrets.delete(descriptor.id, field.key);
    }
  }
}

async function requiredConfigurationComplete(
  descriptor: AddonDescriptor,
  safeConfig: Record<string, SafeAddonConfigValue>,
  secrets: AddonSecretRepository,
): Promise<boolean> {
  for (const field of descriptor.configurationFields) {
    if (!field.required) continue;
    if (isSensitiveAddonConfigField(field)) {
      const saved = await secrets.get(descriptor.id, field.key);
      if (!saved || !saved.trim()) return false;
      continue;
    }
    if (!scalarPresent(safeConfig[field.key])) return false;
  }
  return true;
}

async function runtimeConfigValues(
  descriptor: AddonDescriptor,
  safeConfig: Record<string, SafeAddonConfigValue>,
  secrets: AddonSecretRepository,
): Promise<Record<string, SafeAddonConfigValue | string>> {
  const values: Record<string, SafeAddonConfigValue | string> = {};

  for (const field of descriptor.configurationFields) {
    if (isSensitiveAddonConfigField(field)) {
      const secret = await secrets.get(descriptor.id, field.key);
      if (secret?.trim()) values[field.key] = secret.trim();
      continue;
    }

    const value = safeConfig[field.key];
    if (value !== undefined) values[field.key] = value;
  }

  return values;
}

function secretKeys(fields: readonly AddonConfigField[]): string[] {
  return fields
    .filter((field) => isSensitiveAddonConfigField(field))
    .map((field) => field.key);
}

async function snapshotProviderSecrets(
  providerId: string,
  fields: readonly AddonConfigField[],
  secrets: AddonSecretRepository,
): Promise<Map<string, string | null>> {
  const keys = [...new Set([
    RUNTIME_MANIFEST_URL_SECRET_KEY,
    ...secretKeys(fields),
  ])];
  const snapshot = new Map<string, string | null>();
  for (const key of keys) {
    snapshot.set(key, await secrets.get(providerId, key));
  }
  return snapshot;
}

async function restoreProviderSecrets(
  providerId: string,
  snapshot: ReadonlyMap<string, string | null>,
  secrets: AddonSecretRepository,
): Promise<void> {
  for (const [key, previous] of snapshot) {
    try {
      if (previous === null) {
        await secrets.delete(providerId, key);
      } else {
        await secrets.set(providerId, key, previous);
      }
    } catch {
      // Preserve the original installation error. A later provider edit or
      // removal can still clean up a secure-store implementation that failed
      // while rolling back.
    }
  }
}

const MAX_DATE_MS = 8_640_000_000_000_000;

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
    ? Math.min(previousMs + 1, MAX_DATE_MS)
    : baseMs;
  return new Date(nextMs).toISOString();
}

function newestInstalledTimestamp(
  records: readonly AddonStateRecord[],
): string | undefined {
  let newest: string | undefined;
  let newestMs = Number.NEGATIVE_INFINITY;
  for (const record of records) {
    const candidate = record.installed.updatedAt;
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed) && parsed > newestMs) {
      newest = candidate;
      newestMs = parsed;
    }
  }
  return newest;
}

function sortByPriority(records: readonly AddonStateRecord[]): AddonStateRecord[] {
  return [...records].sort((left, right) =>
    right.installed.priority - left.installed.priority
    || stableTextCompare(left.installed.addonId, right.installed.addonId));
}

export class AddonInstallationService {
  constructor(
    private readonly repository: AddonMetadataRepository,
    private readonly secrets: AddonSecretRepository,
    private readonly manifestLoader: ManifestReader,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async inspectManifest(
    input: string,
    origin: AddonInstallOrigin = 'manual',
  ): Promise<InspectedAddon> {
    const manifestUrl = normalizeManifestUrl(input, origin);
    const payload = await this.manifestLoader.load(manifestUrl, origin);
    return {
      descriptor: parseStremioManifest(payload, manifestUrl),
      manifestUrl,
      origin,
    };
  }

  async hydrate(record: AddonStateRecord): Promise<AddonStateRecord> {
    let secureManifestUrl: string | null = null;
    try {
      secureManifestUrl = await this.secrets.get(
        record.installed.addonId,
        RUNTIME_MANIFEST_URL_SECRET_KEY,
      );
    } catch {
      // Treat an unreadable secure store as unavailable local configuration.
      // This prevents stale public/base endpoints from remaining enabled.
    }

    const cachedDescriptor = record.descriptor;
    const publicBaseManifestUrl =
      record.installed.manifestUrl
      ?? cachedDescriptor?.manifestUrl;
    if (
      !secureManifestUrl
      && cachedDescriptor?.configurable
      && cachedDescriptor.configurationFields.length > 0
      && publicBaseManifestUrl
      && canApplyStandardConfigurationFromManifestUrl(publicBaseManifestUrl)
    ) {
      try {
        const safeConfig = record.safeConfig;
        if (await requiredConfigurationComplete(
          cachedDescriptor,
          safeConfig,
          this.secrets,
        )) {
          // Safe standard configuration (for example Nuvio language/region)
          // survives a web reload even though the runtime endpoint itself is
          // intentionally volatile. Rebuild and validate that endpoint through
          // the same path used by an explicit Configure action.
          const recovered = await this.applyStandardConfiguration(
            record,
            safeConfig,
          );
          const ready: AddonStateRecord = recovered.installed.setupIncomplete
            ? {
                ...recovered,
                installed: {
                  ...recovered.installed,
                  setupIncomplete: false,
                },
              }
            : recovered;
          await this.repository.save(persistedRecord(ready));
          return ready;
        }
      } catch {
        // If the provider rejects standard configuration or local secrets are
        // unavailable, keep the provider disabled below instead of guessing.
      }
    }

    const portableConfiguredEndpoint = isSafePublicConfiguredManifestUrl(
      publicBaseManifestUrl,
    );
    const cachedDescriptorNeedsLocalEndpoint = !portableConfiguredEndpoint && Boolean(
      record.descriptor
      && (
        record.descriptor.configurable
        || record.syncIdentity?.configurable
        || (
          !record.installed.manifestUrl
          && !record.descriptor.manifestUrl
        )
      ),
    );

    if (!secureManifestUrl && cachedDescriptorNeedsLocalEndpoint) {
      const incomplete: AddonStateRecord = {
        ...record,
        installed: {
          ...record.installed,
          enabled: false,
          setupIncomplete: true,
        },
      };
      await this.repository.save(persistedRecord(incomplete));
      return incomplete;
    }

    const manifestUrl =
      secureManifestUrl
      ?? record.descriptor?.manifestUrl
      ?? record.installed.manifestUrl;

    if (record.descriptor) {
      return runtimeRecord(record, manifestUrl);
    }
    if (!manifestUrl) throw new Error('Provider manifest URL is unavailable');

    const payload = await this.manifestLoader.load(manifestUrl, 'manual');
    const descriptor = parseStremioManifest(payload, manifestUrl);
    if (descriptor.id !== record.installed.addonId) {
      throw new Error('Provider manifest identity does not match synchronized metadata');
    }

    if (
      !secureManifestUrl
      && descriptor.configurable
      && descriptor.configurationFields.length > 0
      && canApplyStandardConfigurationFromManifestUrl(manifestUrl)
    ) {
      try {
        if (await requiredConfigurationComplete(
          descriptor,
          record.safeConfig,
          this.secrets,
        )) {
          const recovered = await this.applyStandardConfiguration(
            {
              ...record,
              descriptor,
            },
            record.safeConfig,
          );
          const ready: AddonStateRecord = {
            ...recovered,
            installed: {
              ...recovered.installed,
              setupIncomplete: false,
            },
          };
          await this.repository.save(persistedRecord(ready));
          return ready;
        }
      } catch {
        // A provider-specific configuration flow still needs local setup.
      }
    }

    const missingLocalRuntimeEndpoint = Boolean(
      !secureManifestUrl
      && !isSafePublicConfiguredManifestUrl(manifestUrl)
      && (
        descriptor.configurable
        || record.syncIdentity?.configurable
      ),
    );
    const hydrated: AddonStateRecord = {
      ...record,
      installed: missingLocalRuntimeEndpoint
        ? {
            ...record.installed,
            enabled: false,
            setupIncomplete: true,
          }
        : record.installed.setupIncomplete
          ? (
              !descriptor.configurable
              && !descriptor.requiresConfiguration
            )
            ? {
                ...record.installed,
                setupIncomplete: false,
              }
            : {
                ...record.installed,
                enabled: false,
              }
          : record.installed,
      descriptor,
    };
    await this.repository.save(persistedRecord(hydrated));
    return hydrated;
  }

  async install(
    inspected: InspectedAddon,
    values: Record<string, unknown>,
  ): Promise<AddonStateRecord> {
    const current = await this.repository.list();
    const existing = current.find(
      (record) => record.installed.addonId === inspected.descriptor.id,
    );

    const rollbackSecretFields = [
      ...(existing?.descriptor?.configurationFields ?? []),
      ...inspected.descriptor.configurationFields,
    ];
    const previousSecretValues = await snapshotProviderSecrets(
      inspected.descriptor.id,
      rollbackSecretFields,
      this.secrets,
    );

    try {
      const mergedValues = {
        ...defaultConfigValues(inspected.descriptor),
        ...(existing?.safeConfig ?? {}),
        ...values,
      };
      const localEndpoint = endpointMustStayLocal(
        inspected.descriptor,
        inspected.manifestUrl,
      );
      const baseManifestUrl = publicManifestUrl(
        inspected.descriptor,
        inspected.manifestUrl,
      );
      const secureRuntimeEndpoint = Boolean(inspected.descriptor.configurable) || localEndpoint;
      if (secureRuntimeEndpoint) {
        await this.secrets.set(
          inspected.descriptor.id,
          RUNTIME_MANIFEST_URL_SECRET_KEY,
          inspected.manifestUrl,
        );
      } else {
        await this.secrets.delete(
          inspected.descriptor.id,
          RUNTIME_MANIFEST_URL_SECRET_KEY,
        );
      }
      await persistSecrets(inspected.descriptor, values, this.secrets);

      const currentSecretKeys = new Set(
        secretKeys(inspected.descriptor.configurationFields),
      );
      for (const staleKey of secretKeys(
        existing?.descriptor?.configurationFields ?? [],
      )) {
        if (!currentSecretKeys.has(staleKey)) {
          await this.secrets.delete(
            inspected.descriptor.id,
            staleKey,
          );
        }
      }

      const safeConfig = sanitizeAddonConfig(
        inspected.descriptor.configurationFields,
        mergedValues,
      );
      const setupIncomplete = !(await requiredConfigurationComplete(
        inspected.descriptor,
        safeConfig,
        this.secrets,
      ));
      const timestamp = monotonicTimestamp(
        this.now(),
        existing?.installed.updatedAt,
      );
      const highestPriority = current.reduce(
        (highest, record) => Math.max(highest, record.installed.priority),
        0,
      );
      const installed: InstalledAddon = {
        addonId: inspected.descriptor.id,
        ...(baseManifestUrl ? { manifestUrl: baseManifestUrl } : {}),
        sourceType: inspected.descriptor.sourceType,
        enabled: !setupIncomplete,
        priority: existing?.installed.priority ?? highestPriority + 100,
        installedAt: existing?.installed.installedAt ?? timestamp,
        updatedAt: timestamp,
        lastValidatedAt: timestamp,
        setupIncomplete,
      };
      const record: AddonStateRecord = {
        installed,
        safeConfig,
        descriptor: inspected.descriptor,
      };

      // Installing a configurable provider with a complete configuration must
      // activate the configured endpoint immediately. Previously the values were
      // saved in safeConfig/secrets but the runtime descriptor still pointed at
      // the unconfigured base manifest until the user opened Configure and saved
      // again. This was especially visible with Nuvio language/region choices.
      const shouldApplyStandardConfiguration = Boolean(
        !setupIncomplete
        && inspected.descriptor.configurable
        && inspected.descriptor.configurationFields.length > 0
        && canApplyStandardConfigurationFromManifestUrl(
          inspected.manifestUrl,
        ),
      );
      const configuredRecord = shouldApplyStandardConfiguration
        ? await this.applyStandardConfiguration(record, safeConfig)
        : record;

      const finalRecord: AddonStateRecord = {
        ...configuredRecord,
        safeConfig,
        installed: {
          ...configuredRecord.installed,
          enabled: !setupIncomplete,
          setupIncomplete,
        },
      };
      await this.repository.save(persistedRecord(finalRecord));
      return finalRecord;
    } catch (error) {
      await restoreProviderSecrets(
        inspected.descriptor.id,
        previousSecretValues,
        this.secrets,
      );
      throw error;
    }
  }

  private async applyStandardConfiguration(
    record: AddonStateRecord,
    safeConfig: Record<string, SafeAddonConfigValue>,
  ): Promise<AddonStateRecord> {
    const descriptor = record.descriptor;
    if (
      !descriptor?.configurable
      || descriptor.configurationFields.length === 0
    ) {
      return record;
    }

    const manifestUrl = descriptor.manifestUrl ?? record.installed.manifestUrl;
    if (!manifestUrl) {
      throw new Error('Provider manifest URL is unavailable');
    }

    const config = await runtimeConfigValues(descriptor, safeConfig, this.secrets);
    const configuredManifestUrl = buildStremioConfiguredManifestUrl(
      manifestUrl,
      config,
    );

    let payload: unknown;
    try {
      payload = await this.manifestLoader.load(configuredManifestUrl, 'manual');
    } catch {
      throw new Error(
        'This provider uses a custom configuration page. Use “Update manifest URL” with the link generated by the provider.',
      );
    }

    const configuredDescriptor = parseStremioManifest(
      payload,
      configuredManifestUrl,
    );
    if (configuredDescriptor.id !== descriptor.id) {
      throw new Error('Configured provider identity does not match the installed provider');
    }

    const localEndpoint = endpointMustStayLocal(
      configuredDescriptor,
      configuredManifestUrl,
    );
    const secureRuntimeEndpoint = Boolean(configuredDescriptor.configurable) || localEndpoint;
    if (secureRuntimeEndpoint) {
      await this.secrets.set(
        descriptor.id,
        RUNTIME_MANIFEST_URL_SECRET_KEY,
        configuredManifestUrl,
      );
    } else {
      await this.secrets.delete(
        descriptor.id,
        RUNTIME_MANIFEST_URL_SECRET_KEY,
      );
    }

    const baseManifestUrl =
      (record.installed.manifestUrl
        ? safeManifestUrlForSync(record.installed.manifestUrl)
        : undefined)
      ?? publicManifestUrl(configuredDescriptor, configuredManifestUrl);

    return {
      ...record,
      installed: {
        ...record.installed,
        ...(baseManifestUrl ? { manifestUrl: baseManifestUrl } : {}),
      },
      descriptor: configuredDescriptor,
    };
  }

  async configure(addonId: string, values: Record<string, unknown>): Promise<AddonStateRecord> {
    const stored = (await this.repository.list()).find(
      (candidate) => candidate.installed.addonId === addonId,
    );
    if (!stored) throw new Error('Provider is not installed');
    const record = await this.hydrate(stored);
    if (!record.descriptor) {
      throw new Error('Provider metadata is unavailable; reinstall the provider');
    }

    const previousSecretValues = await snapshotProviderSecrets(
      addonId,
      record.descriptor.configurationFields,
      this.secrets,
    );

    try {
      await persistSecrets(record.descriptor, values, this.secrets);
      const safeConfig = sanitizeAddonConfig(
        record.descriptor.configurationFields,
        {
          ...defaultConfigValues(record.descriptor),
          ...record.safeConfig,
          ...values,
        },
      );
      const setupIncomplete = !(await requiredConfigurationComplete(
        record.descriptor,
        safeConfig,
        this.secrets,
      ));

      let baseRecord = record;
      if (setupIncomplete && explicitlyClearsSecret(record.descriptor, values)) {
        const publicBase = record.installed.manifestUrl
          ? safeManifestUrlForSync(record.installed.manifestUrl)
          : undefined;

        if (publicBase) {
          await this.secrets.set(
            addonId,
            RUNTIME_MANIFEST_URL_SECRET_KEY,
            publicBase,
          );
          baseRecord = runtimeRecord(record, publicBase);
        } else {
          await this.secrets.delete(
            addonId,
            RUNTIME_MANIFEST_URL_SECRET_KEY,
          );
          baseRecord = {
            ...record,
            descriptor: omitManifestUrl(record.descriptor),
          };
        }
      }

      const configuredRecord = setupIncomplete
        ? baseRecord
        : await this.applyStandardConfiguration(baseRecord, safeConfig);

      const updated: AddonStateRecord = {
        ...configuredRecord,
        safeConfig,
        installed: {
          ...configuredRecord.installed,
          enabled: !setupIncomplete,
          setupIncomplete,
          updatedAt: monotonicTimestamp(
            this.now(),
            configuredRecord.installed.updatedAt,
          ),
        },
      };
      await this.repository.save(persistedRecord(updated));
      return updated;
    } catch (error) {
      await restoreProviderSecrets(
        addonId,
        previousSecretValues,
        this.secrets,
      );
      try {
        await this.repository.save(stored);
      } catch {
        // Preserve the original configuration failure. The previous secure
        // state has already been restored, and a later refresh/edit can retry
        // persistence if the storage implementation itself is unavailable.
      }
      throw error;
    }
  }

  async setEnabled(addonId: string, enabled: boolean): Promise<AddonStateRecord> {
    const stored = (await this.repository.list()).find(
      (candidate) => candidate.installed.addonId === addonId,
    );
    if (!stored) throw new Error('Provider is not installed');
    const record = await this.hydrate(stored);
    if (enabled && record.installed.setupIncomplete) {
      throw new Error('Provider configuration is incomplete');
    }

    const updated: AddonStateRecord = {
      ...record,
      installed: {
        ...record.installed,
        enabled,
        updatedAt: monotonicTimestamp(
          this.now(),
          record.installed.updatedAt,
        ),
      },
    };
    await this.repository.save(persistedRecord(updated));
    return updated;
  }

  async remove(addonId: string): Promise<void> {
    const record = (await this.repository.list()).find(
      (candidate) => candidate.installed.addonId === addonId,
    );
    const secretFields = [
      ...(record?.descriptor
        ? secretKeys(record.descriptor.configurationFields)
        : []),
      RUNTIME_MANIFEST_URL_SECRET_KEY,
    ];

    // Delete the durable provider record first. If that write fails, the
    // provider remains fully intact, including the secure runtime endpoint.
    await this.repository.remove(addonId);

    try {
      await this.secrets.deleteProvider(addonId, secretFields);
    } catch (error) {
      // Secret cleanup and repository removal form one logical mutation.
      // Restore the record when secure cleanup fails so a configured provider
      // is never left installed-without-secrets or removed-with-stale-secrets.
      if (record) {
        await this.repository.save(record);
      }
      throw error;
    }
  }

  async move(addonId: string, direction: 'up' | 'down'): Promise<AddonStateRecord[]> {
    const records = sortByPriority(await this.repository.list());
    const index = records.findIndex((record) => record.installed.addonId === addonId);
    if (index < 0) throw new Error('Provider is not installed');

    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= records.length) {
      return Promise.all(records.map((record) => this.hydrate(record)));
    }

    const ids = records.map((record) => record.installed.addonId);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const updatedAt = monotonicTimestamp(
      this.now(),
      newestInstalledTimestamp(records),
    );
    await this.repository.reorder(ids, updatedAt);
    return Promise.all(
      (await this.repository.list()).map((record) => this.hydrate(record)),
    );
  }
}

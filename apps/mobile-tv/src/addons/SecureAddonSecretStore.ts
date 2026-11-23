export const RUNTIME_MANIFEST_URL_SECRET_KEY = '__runtimeManifestUrl';

const SECRET_KEY_PREFIX = 'moviestv.addon';
const LEGACY_OWNER_KEY = 'moviestv.addon.legacy-owner';
const MAX_PROVIDER_ID_LENGTH = 512;
const MAX_SECRET_FIELD_LENGTH = 128;
const MAX_SECRET_VALUE_LENGTH = 16_384;

function normalizedSecretIdentifier(
  value: string,
  maxLength: number,
  label: string,
): string {
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > maxLength
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
}

function validSecretValue(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_SECRET_VALUE_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export interface SecureStoreAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

function legacySecretKey(providerId: string, fieldKey: string): string {
  return `${SECRET_KEY_PREFIX}.${providerId}.${fieldKey}`;
}

function legacyScopedSecretKey(
  scope: string,
  providerId: string,
  fieldKey: string,
): string {
  return `${SECRET_KEY_PREFIX}.scope.${scope}.${providerId}.${fieldKey}`;
}

function secureStoreKeyPart(value: string): string {
  const symbols = Array.from(value);
  return `${symbols.length}_${symbols
    .map((symbol) => symbol.codePointAt(0)!.toString(16))
    .join('_')}`;
}

function scopedSecretKey(
  scope: string,
  providerId: string,
  fieldKey: string,
): string {
  return [
    SECRET_KEY_PREFIX,
    'scope2',
    secureStoreKeyPart(scope),
    secureStoreKeyPart(providerId),
    secureStoreKeyPart(fieldKey),
  ].join('.');
}

export function addonSecretScopeForUser(
  userId: string | null | undefined,
): string {
  if (userId === null || userId === undefined) return 'guest';
  const normalized = normalizedSecretIdentifier(
    userId,
    MAX_PROVIDER_ID_LENGTH,
    'Provider secret user id',
  );
  return `user:${encodeURIComponent(normalized)}`;
}

export class SecureAddonSecretStore {
  constructor(
    private readonly storage: SecureStoreAdapter,
    private readonly scope?: string,
    private readonly fallbackScopes: readonly string[] = [],
    private readonly migrateLegacy = false,
  ) {}

  private normalizedProviderId(providerId: string): string {
    return normalizedSecretIdentifier(
      providerId,
      MAX_PROVIDER_ID_LENGTH,
      'Provider secret id',
    );
  }

  private normalizedFieldKey(fieldKey: string): string {
    return normalizedSecretIdentifier(
      fieldKey,
      MAX_SECRET_FIELD_LENGTH,
      'Provider secret field',
    );
  }

  private key(providerId: string, fieldKey: string): string {
    const provider = this.normalizedProviderId(providerId);
    const field = this.normalizedFieldKey(fieldKey);
    return this.scope
      ? scopedSecretKey(this.scope, provider, field)
      : legacySecretKey(provider, field);
  }

  private async readValidMigrationSecret(
    key: string,
  ): Promise<string | null> {
    const value = await this.readMigrationKey(key);
    if (value === null) return null;
    if (validSecretValue(value)) return value;
    await this.deleteMigrationKey(key);
    return null;
  }

  private async readMigrationKey(key: string): Promise<string | null> {
    try {
      return await this.storage.getItemAsync(key);
    } catch {
      // Old scoped keys could contain characters (for example ":" in a user
      // scope) that native Expo SecureStore rejects. Ignore an unreadable
      // migration key; all newly written scoped keys use the safe v2 format.
      return null;
    }
  }

  private async deleteMigrationKey(key: string): Promise<void> {
    try {
      await this.storage.deleteItemAsync(key);
    } catch {
      // Best-effort cleanup for legacy keys that native SecureStore may reject.
    }
  }

  private fallbackKeys(
    scope: string,
    providerId: string,
    fieldKey: string,
  ): readonly [string, string] {
    return [
      scopedSecretKey(scope, providerId, fieldKey),
      legacyScopedSecretKey(scope, providerId, fieldKey),
    ];
  }

  private async legacyMigrationAllowed(): Promise<boolean> {
    if (!this.scope || !this.migrateLegacy) return false;

    const owner = await this.storage.getItemAsync(LEGACY_OWNER_KEY);
    if (owner !== null) return owner === this.scope;

    if (this.scope === 'guest') {
      return true;
    }

    await this.storage.setItemAsync(LEGACY_OWNER_KEY, this.scope);
    return true;
  }

  async get(providerId: string, fieldKey: string): Promise<string | null> {
    const provider = this.normalizedProviderId(providerId);
    const field = this.normalizedFieldKey(fieldKey);
    const currentKey = this.key(provider, field);
    const current = await this.storage.getItemAsync(currentKey);
    if (current !== null) {
      if (validSecretValue(current)) return current;
      await this.deleteMigrationKey(currentKey);
      return null;
    }

    if (this.scope) {
      const oldCurrentKey = legacyScopedSecretKey(
        this.scope,
        provider,
        field,
      );
      const oldCurrent = await this.readValidMigrationSecret(oldCurrentKey);
      if (oldCurrent !== null) {
        await this.storage.setItemAsync(currentKey, oldCurrent);
        await this.deleteMigrationKey(oldCurrentKey);
        return oldCurrent;
      }

      for (const fallbackScope of this.fallbackScopes) {
        const [fallbackKey, oldFallbackKey] = this.fallbackKeys(
          fallbackScope,
          provider,
          field,
        );
        const fallback = (
          await this.readValidMigrationSecret(fallbackKey)
          ?? await this.readValidMigrationSecret(oldFallbackKey)
        );
        if (fallback === null) continue;

        await this.storage.setItemAsync(currentKey, fallback);
        await this.deleteMigrationKey(fallbackKey);
        await this.deleteMigrationKey(oldFallbackKey);
        return fallback;
      }
    }

    if (await this.legacyMigrationAllowed()) {
      const fallbackKey = legacySecretKey(provider, field);
      const fallback = await this.readValidMigrationSecret(fallbackKey);
      if (fallback !== null) {
        await this.storage.setItemAsync(currentKey, fallback);
        await this.deleteMigrationKey(fallbackKey);
        return fallback;
      }
    }

    return null;
  }

  async set(
    providerId: string,
    fieldKey: string,
    value: string,
  ): Promise<void> {
    const provider = this.normalizedProviderId(providerId);
    const field = this.normalizedFieldKey(fieldKey);
    if (!validSecretValue(value)) {
      throw new TypeError('Provider secret value is invalid');
    }

    await this.storage.setItemAsync(this.key(provider, field), value);

    if (this.scope) {
      await this.deleteMigrationKey(
        legacyScopedSecretKey(this.scope, provider, field),
      );
      for (const fallbackScope of this.fallbackScopes) {
        const [fallbackKey, oldFallbackKey] = this.fallbackKeys(
          fallbackScope,
          provider,
          field,
        );
        await this.deleteMigrationKey(fallbackKey);
        await this.deleteMigrationKey(oldFallbackKey);
      }
    }

    if (await this.legacyMigrationAllowed()) {
      await this.deleteMigrationKey(
        legacySecretKey(provider, field),
      );
    }
  }

  async delete(providerId: string, fieldKey: string): Promise<void> {
    const provider = this.normalizedProviderId(providerId);
    const field = this.normalizedFieldKey(fieldKey);
    await this.storage.deleteItemAsync(this.key(provider, field));

    if (this.scope) {
      await this.deleteMigrationKey(
        legacyScopedSecretKey(this.scope, provider, field),
      );
      for (const fallbackScope of this.fallbackScopes) {
        const [fallbackKey, oldFallbackKey] = this.fallbackKeys(
          fallbackScope,
          provider,
          field,
        );
        await this.deleteMigrationKey(fallbackKey);
        await this.deleteMigrationKey(oldFallbackKey);
      }
    }

    if (await this.legacyMigrationAllowed()) {
      await this.deleteMigrationKey(
        legacySecretKey(provider, field),
      );
    }
  }

  async deleteProvider(
    providerId: string,
    fieldKeys: readonly string[],
  ): Promise<void> {
    const uniqueFields = [...new Set(fieldKeys)];
    const previous = new Map<string, string | null>();

    for (const fieldKey of uniqueFields) {
      previous.set(
        fieldKey,
        await this.get(providerId, fieldKey),
      );
    }

    try {
      for (const fieldKey of uniqueFields) {
        await this.delete(providerId, fieldKey);
      }
    } catch (error) {
      for (const [fieldKey, value] of previous) {
        if (value === null) continue;
        try {
          await this.set(providerId, fieldKey, value);
        } catch {
          // Preserve the original deletion failure. The provider-level
          // transaction can still surface the error and retry later.
        }
      }
      throw error;
    }
  }
}

/**
 * Provider setup codes: a one-time, user-initiated hand-off of the add-on links
 * and secret fields that sync must never carry.
 *
 * A configured Stremio add-on URL can embed a debrid key, which is why it is not
 * synchronized. Regenerating every provider on a second device is the only
 * alternative, so this code lets a user copy their own configuration across by
 * hand: it is shown on the source device, pasted on the target, and never sent
 * to a server.
 *
 * The code is readable JSON on purpose. It is a secret the user is moving, not a
 * token to be logged, and a format they can inspect is easier to trust than an
 * opaque blob. Callers must not write it to storage or logs.
 */

export const PROVIDER_SETUP_CODE_PREFIX = 'MTFLIX-SETUP-1:';

const MAX_ENTRIES = 20;
const MAX_CODE_LENGTH = 24_000;
const MAX_ADDON_ID_LENGTH = 200;
const MAX_URL_LENGTH = 2_048;
const MAX_SECRET_KEY_LENGTH = 100;
const MAX_SECRET_VALUE_LENGTH = 4_096;

export interface ProviderSetupEntry {
  addonId: string;
  /** The configured manifest URL for this device. */
  manifestUrl: string;
  /** Sensitive configuration values, keyed by descriptor field key. */
  secrets: Record<string, string>;
}

export class ProviderSetupCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderSetupCodeError';
  }
}

function safeText(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > limit) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function safeManifestUrl(value: unknown): string | null {
  const raw = safeText(value, MAX_URL_LENGTH);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeProviderSetupEntry(
  entry: ProviderSetupEntry,
): ProviderSetupEntry | null {
  const addonId = safeText(entry?.addonId, MAX_ADDON_ID_LENGTH);
  const manifestUrl = safeManifestUrl(entry?.manifestUrl);
  if (!addonId || !manifestUrl) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(addonId)) return null;

  const secrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(entry.secrets ?? {})) {
    const safeKey = safeText(key, MAX_SECRET_KEY_LENGTH);
    const safeValue = safeText(value, MAX_SECRET_VALUE_LENGTH);
    if (!safeKey || !safeValue) continue;
    secrets[safeKey] = safeValue;
  }

  return { addonId, manifestUrl, secrets };
}

export function encodeProviderSetupCode(
  entries: readonly ProviderSetupEntry[],
): string {
  const normalized = entries
    .map(normalizeProviderSetupEntry)
    .filter((entry): entry is ProviderSetupEntry => entry !== null)
    .slice(0, MAX_ENTRIES);
  if (normalized.length === 0) {
    throw new ProviderSetupCodeError('No configured providers to transfer.');
  }
  return PROVIDER_SETUP_CODE_PREFIX + JSON.stringify(normalized);
}

export function decodeProviderSetupCode(code: string): ProviderSetupEntry[] {
  const raw = code.trim();
  if (!raw) throw new ProviderSetupCodeError('Paste a setup code first.');
  if (raw.length > MAX_CODE_LENGTH) {
    throw new ProviderSetupCodeError('That code is too long.');
  }
  if (!raw.startsWith(PROVIDER_SETUP_CODE_PREFIX)) {
    throw new ProviderSetupCodeError('That is not a MoviesTv-Flix setup code.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(PROVIDER_SETUP_CODE_PREFIX.length));
  } catch {
    throw new ProviderSetupCodeError('That setup code is damaged.');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new ProviderSetupCodeError('That setup code has no providers.');
  }

  const entries = parsed
    .slice(0, MAX_ENTRIES)
    .map((entry) => normalizeProviderSetupEntry(entry as ProviderSetupEntry))
    .filter((entry): entry is ProviderSetupEntry => entry !== null);

  if (entries.length === 0) {
    throw new ProviderSetupCodeError('That setup code has no usable providers.');
  }
  return entries;
}

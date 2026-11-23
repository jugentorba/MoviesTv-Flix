import type { ExternalMediaIds, StreamSource } from '@moviestv/core';
import type { LiveTvProtocol } from '@moviestv/live-tv';

export type AddonCapability = 'stream' | 'catalog' | 'subtitle' | 'live-tv';
export type AddonSourceType = 'native' | 'stremio-manifest';
export type AddonMediaKind = 'movie' | 'series' | 'episode';
export type AddonConfigFieldType = 'text' | 'secret' | 'boolean' | 'select' | 'url';
export type SafeAddonConfigValue = string | boolean;

export interface AddonConfigOption {
  value: string;
  label: string;
}

export interface AddonConfigField {
  key: string;
  label: string;
  type: AddonConfigFieldType;
  required: boolean;
  secret: boolean;
  options?: AddonConfigOption[];
  placeholder?: string;
  defaultValue?: SafeAddonConfigValue;
}

export interface AddonStreamProtocol {
  types: Array<'movie' | 'series'>;
  idPrefixes: string[];
}

export interface AddonSubtitleProtocol {
  types: Array<'movie' | 'series'>;
  idPrefixes: string[];
}

export interface AddonCatalogExtra {
  name: string;
  isRequired: boolean;
  options?: string[];
}

export interface AddonCatalogDefinition {
  type: 'movie' | 'series';
  id: string;
  name: string;
  extra: AddonCatalogExtra[];
}

export interface AddonMetaProtocol {
  types: Array<'movie' | 'series'>;
  idPrefixes: string[];
}

export interface AddonCatalogProtocol {
  catalogs: AddonCatalogDefinition[];
  meta?: AddonMetaProtocol;
}

export interface AddonDescriptor {
  id: string;
  name: string;
  version: string;
  description?: string;
  logoUrl?: string;
  sourceType: AddonSourceType;
  capabilities: AddonCapability[];
  configurable?: boolean;
  requiresConfiguration: boolean;
  configurationFields: AddonConfigField[];
  supportedMediaKinds: Array<'movie' | 'series'>;
  manifestUrl?: string;
  stream?: AddonStreamProtocol;
  subtitle?: AddonSubtitleProtocol;
  catalog?: AddonCatalogProtocol;
  liveTv?: LiveTvProtocol;
}

export interface InstalledAddon {
  addonId: string;
  manifestUrl?: string;
  sourceType: AddonSourceType;
  enabled: boolean;
  priority: number;
  installedAt: string;
  updatedAt: string;
  lastValidatedAt?: string;
  setupIncomplete: boolean;
}

export interface AddonMediaRequest {
  mediaId: string;
  kind: AddonMediaKind;
  externalIds: ExternalMediaIds;
  seriesMediaId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface AddonResolveOptions {
  timeoutMs?: number;
}

export interface AddonAdapter {
  descriptor(): AddonDescriptor;
  resolve(
    request: AddonMediaRequest,
    options?: AddonResolveOptions,
  ): Promise<StreamSource[]>;
}

function isBoundedString(
  value: unknown,
  maxLength: number,
): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return Boolean(
    normalized
    && normalized.length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(normalized)
  );
}

function isCatalogMediaIdentity(
  value: unknown,
  kind: 'movie' | 'series',
): value is string {
  if (!isBoundedString(value, 2_048)) return false;
  const normalized = value.trim();
  const marker = `:${kind}:`;
  if (!normalized.startsWith('stremio-')) return false;

  const markerIndex = normalized.indexOf(marker);
  if (markerIndex <= 'stremio-'.length) return false;
  const encodedRemoteId = normalized.slice(
    markerIndex + marker.length,
  );
  if (!encodedRemoteId) return false;

  try {
    const remoteId = decodeURIComponent(encodedRemoteId).trim();
    return Boolean(
      remoteId
      && remoteId.length <= 512
      && !/[\u0000-\u001f\u007f]/.test(remoteId)
    );
  } catch {
    return false;
  }
}

function isBoundedInteger(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= min
    && value <= max;
}

export function isAddonMediaRequest(value: unknown): value is AddonMediaRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!isBoundedString(record.mediaId, 2_048)) return false;
  if (
    record.kind !== 'movie'
    && record.kind !== 'series'
    && record.kind !== 'episode'
  ) return false;

  if (
    typeof record.externalIds !== 'object'
    || record.externalIds === null
    || Array.isArray(record.externalIds)
  ) return false;
  const externalIds = record.externalIds as Record<string, unknown>;
  if (!Object.keys(externalIds).every(
    (key) => key === 'imdb' || key === 'tmdb',
  )) return false;

  const tmdb = isBoundedString(externalIds.tmdb, 32)
    ? externalIds.tmdb.trim()
    : '';
  const imdb = isBoundedString(externalIds.imdb, 32)
    ? externalIds.imdb.trim()
    : '';
  const hasTmdb = /^(?:\d+|tmdb:(?:(?:movie|series):)?\d+)$/i.test(tmdb);
  const hasImdb = /^(?:tt\d+|imdb:tt\d+)$/i.test(imdb);
  if (
    externalIds.tmdb !== undefined
    && externalIds.tmdb !== null
    && !hasTmdb
  ) return false;
  if (
    externalIds.imdb !== undefined
    && externalIds.imdb !== null
    && !hasImdb
  ) return false;
  const hasCatalogMovieIdentity = (
    record.kind === 'movie'
    && isCatalogMediaIdentity(record.mediaId, 'movie')
  );
  const hasCatalogSeriesIdentity = (
    record.kind === 'episode'
    && isCatalogMediaIdentity(record.seriesMediaId, 'series')
  );
  if (
    !hasTmdb
    && !hasImdb
    && !hasCatalogMovieIdentity
    && !hasCatalogSeriesIdentity
  ) return false;

  if (record.kind === 'episode') {
    return (
      isBoundedInteger(record.seasonNumber, 0, 10_000)
      && isBoundedInteger(record.episodeNumber, 1, 100_000)
    );
  }

  return true;
}

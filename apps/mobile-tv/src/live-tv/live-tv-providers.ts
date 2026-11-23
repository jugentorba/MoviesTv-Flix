import { stableTextCompare } from '@moviestv/core';
import {
  MAX_PROVIDER_URL_LENGTH,
  type AddonStateRecord,
} from '@moviestv/addons';
import type { LiveTvProviderDescriptor } from '@moviestv/live-tv';

export function createLiveTvProviders(
  records: readonly AddonStateRecord[],
): LiveTvProviderDescriptor[] {
  return records
    .filter((record) => record.installed.enabled)
    .filter((record) => Boolean(record.installed.addonId?.trim()))
    .filter((record) => !record.installed.setupIncomplete)
    .filter((record) => Boolean(record.descriptor?.manifestUrl))
    .filter((record) => (
      Array.isArray(record.descriptor?.capabilities)
      && record.descriptor.capabilities.includes('live-tv')
    ))
    .filter((record) => Boolean(record.descriptor?.liveTv))
    .filter((record) => {
      try {
        const raw = record.descriptor!.manifestUrl!.trim();
        if (!raw || raw.length > MAX_PROVIDER_URL_LENGTH) return false;
        const url = new URL(raw);
        const hostname = url.hostname
          .toLowerCase()
          .replace(/^\[|\]$/g, '');
        const loopbackHttp = url.protocol === 'http:'
          && ['localhost', '127.0.0.1', '::1'].includes(hostname);
        return (url.protocol === 'https:' || loopbackHttp)
          && !url.username
          && !url.password
          && url.href.length <= MAX_PROVIDER_URL_LENGTH;
      } catch { return false; }
    })
    .filter((record, index, list) => list.findIndex((candidate) => candidate.installed.addonId.trim() === record.installed.addonId.trim()) === index)
    .flatMap((record) => {
      const liveTv = record.descriptor?.liveTv;
      if (
        !liveTv
        || !Array.isArray(liveTv.catalogs)
        || !Array.isArray(liveTv.streamTypes)
      ) return [];
      try {
        return [{
          addonId: record.installed.addonId.trim(),
          name: record.descriptor!.name?.trim().slice(0, 200)
            || record.installed.addonId.trim(),
          manifestUrl: new URL(record.descriptor!.manifestUrl!).href,
          priority: Number.isFinite(record.installed.priority)
            ? record.installed.priority
            : 0,
          liveTv,
        }];
      } catch {
        return [];
      }
    })
    .sort((left, right) =>
      right.priority - left.priority || stableTextCompare(left.addonId, right.addonId))
    .slice(0, 100);
}

export const MAX_LIVE_TV_PROVIDERS_PER_KIND = 100;

/**
 * True when two provider lists describe the same providers in the same order.
 *
 * The Live TV screen keeps playlist providers in state and reloads whenever
 * that list changes identity. Without this check every secure-storage read
 * would produce a new array and trigger a redundant channel load.
 */
export function sameLiveTvProviders(
  left: readonly LiveTvProviderDescriptor[],
  right: readonly LiveTvProviderDescriptor[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((provider, index) => {
    const other = right[index];
    return Boolean(other)
      && provider.addonId === other.addonId
      && provider.priority === other.priority
      && provider.name === other.name
      && (provider.kind ?? 'addon') === (other.kind ?? 'addon');
  });
}

/**
 * Combines add-on providers with imported playlist providers.
 *
 * Ordering is deterministic — priority descending, then id — because the
 * channel service and the playback fallback both walk providers in the order
 * they are given. A duplicate id keeps the first entry: add-on ids cannot
 * collide with the `m3u:` playlist namespace, so a duplicate means the same
 * provider arrived from two sources and must not be queried twice.
 */
export function mergeLiveTvProviders(
  addonProviders: readonly LiveTvProviderDescriptor[],
  playlistProviders: readonly LiveTvProviderDescriptor[],
): LiveTvProviderDescriptor[] {
  const seen = new Set<string>();
  const merged: LiveTvProviderDescriptor[] = [];

  for (const provider of [...addonProviders, ...playlistProviders]) {
    const addonId = provider?.addonId?.trim();
    if (!addonId || seen.has(addonId)) continue;
    seen.add(addonId);
    merged.push(provider);
  }

  return merged
    .sort((left, right) => (
      right.priority - left.priority
      || stableTextCompare(left.addonId, right.addonId)
    ))
    .slice(0, MAX_LIVE_TV_PROVIDERS_PER_KIND * 2);
}

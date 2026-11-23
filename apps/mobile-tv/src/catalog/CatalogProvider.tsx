import { stableTextCompare } from '@moviestv/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { Platform } from 'react-native';
import { CatalogRegistry, CatalogService, type CatalogRegistryEntry } from '@moviestv/catalog';
import type { AddonStateRecord } from '@moviestv/addons';
import { useAddons } from '../addons/useAddons';
import { AccountContext } from '../auth/useAccount';
import { AsyncStorageCatalogCache } from './AsyncStorageCatalogCache';
import { getCatalogConfig, type CatalogConfig } from './catalog-config';
import { DemoCatalogGateway } from './DemoCatalogGateway';
import { RemoteCatalogGateway } from './RemoteCatalogGateway';
import { StremioCatalogGateway } from './StremioCatalogGateway';
import { nuvioWebCatalogBaseUrl } from './nuvio-proxy';

export interface CatalogContextValue {
  service: CatalogService;
  config: CatalogConfig;
}

export const CatalogContext = createContext<CatalogContextValue | null>(null);

function installedCatalogBaseUrl(
  manifestUrl: string,
  web = Platform.OS === 'web',
): string | undefined {
  return web
    ? nuvioWebCatalogBaseUrl(manifestUrl)
    : undefined;
}

export function createInstalledCatalogEntries(
  installed: readonly AddonStateRecord[],
  web = Platform.OS === 'web',
): CatalogRegistryEntry[] {
  const seenCatalogAddons = new Set<string>();
  return installed
    .filter((record) => (
      record.installed.enabled
      && !record.installed.setupIncomplete
      && Array.isArray(record.descriptor?.capabilities)
      && record.descriptor.capabilities.includes('catalog')
      && Boolean(record.descriptor.catalog)
      && Boolean(record.descriptor.manifestUrl)
    ))
    .filter((record) => {
      const id = record.installed.addonId.trim();
      if (!id || seenCatalogAddons.has(id)) return false;
      seenCatalogAddons.add(id);
      return true;
    })
    .slice(0, 100)
    .flatMap((record) => {
      try {
        return [{
          gateway: new StremioCatalogGateway(
            record,
            undefined,
            installedCatalogBaseUrl(
              record.descriptor!.manifestUrl!,
              web,
            ),
          ),
          enabled: true,
          priority: record.installed.priority,
        }];
      } catch {
        // One stale/corrupt installed provider must not take down every catalog.
        return [];
      }
    });
}

export function catalogCacheScopeForUser(
  userId: string | null | undefined,
): string {
  const normalized = userId?.trim();
  return normalized
    ? `user:${encodeURIComponent(normalized)}`
    : 'guest';
}

export function catalogProviderCacheIdentity(
  record: AddonStateRecord,
): string {
  const identity = [
    record.installed.addonId,
    record.installed.priority,
    record.installed.updatedAt,
    record.installed.manifestUrl ?? '',
    record.descriptor?.manifestUrl ?? '',
    record.descriptor?.version ?? '',
    record.descriptor?.catalog ?? null,
    record.safeConfig,
  ];

  try {
    return JSON.stringify(identity);
  } catch {
    // Corrupt provider metadata must still get an endpoint-sensitive cache
    // identity instead of collapsing onto an unrelated provider cache.
    return [
      record.installed.addonId,
      String(record.installed.priority),
      record.installed.updatedAt,
      record.installed.manifestUrl ?? '',
      record.descriptor?.manifestUrl ?? '',
      record.descriptor?.version ?? '',
    ].join('|');
  }
}

function fnv1a(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function compactCatalogCacheNamespace(value: string): string {
  const first = fnv1a(value, 0x811c9dc5).toString(36);
  const second = fnv1a(value, 0x9e3779b9).toString(36);
  return `v2:${first}:${second}:${value.length.toString(36)}`;
}

export function CatalogProvider({ children }: PropsWithChildren) {
  const { installed } = useAddons();
  const account = useContext(AccountContext);
  const userId = account?.userId?.trim() || null;

  const value = useMemo<CatalogContextValue>(() => {
    const config = getCatalogConfig({
      EXPO_PUBLIC_CATALOG_BASE_URL: process.env.EXPO_PUBLIC_CATALOG_BASE_URL,
      EXPO_PUBLIC_PREVIEW_MODE: process.env.EXPO_PUBLIC_PREVIEW_MODE,
      EXPO_PUBLIC_DEMO_CATALOG: process.env.EXPO_PUBLIC_DEMO_CATALOG,
    });

    const baseGateway = config.mode === 'remote'
      ? new RemoteCatalogGateway(config.baseUrl)
      : config.mode === 'demo'
        ? new DemoCatalogGateway()
        : null;

    const installedCatalogs = createInstalledCatalogEntries(
      installed,
    );

    const registry = new CatalogRegistry([
      ...installedCatalogs,
      ...(baseGateway
        ? [{ gateway: baseGateway, enabled: true, priority: 0 }]
        : []),
    ]);
    const providerFingerprint = [
      catalogCacheScopeForUser(userId),
      `base:${config.mode}:${config.baseUrl ?? ''}`,
      ...installed
        .filter((record) => (
          record.installed.enabled
          && !record.installed.setupIncomplete
          && Array.isArray(record.descriptor?.capabilities)
          && record.descriptor.capabilities.includes('catalog')
        ))
        .sort((left, right) => stableTextCompare(left.installed.addonId, right.installed.addonId))
        .map((record) => catalogProviderCacheIdentity(record)),
    ].join('|');

    return {
      service: new CatalogService(
        registry,
        new AsyncStorageCatalogCache(AsyncStorage),
        compactCatalogCacheNamespace(providerFingerprint),
      ),
      config,
    };
  }, [installed, userId]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

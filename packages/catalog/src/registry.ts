import { stableTextCompare } from '@moviestv/core';
import type { CatalogGateway } from './types';

export interface CatalogRegistryEntry {
  gateway: CatalogGateway;
  enabled: boolean;
  priority: number;
}

export class CatalogRegistry {
  constructor(private readonly entries: CatalogRegistryEntry[]) {}

  enabled(): CatalogRegistryEntry[] {
    return this.entries
      .filter((entry) => entry.enabled)
      .slice()
      .sort((a, b) => (
        b.priority - a.priority
        || stableTextCompare(a.gateway.id, b.gateway.id)
      ))
      .slice(0, 100);
  }

  find(providerId: string): CatalogRegistryEntry | undefined {
    return this.entries.find((entry) => entry.gateway.id === providerId && entry.enabled);
  }
}

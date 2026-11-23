import { stableTextCompare } from '@moviestv/core';
import type { AddonAdapter, InstalledAddon } from './types';

export interface RegisteredAddon {
  installed: InstalledAddon;
  adapter: AddonAdapter;
}

function isStreamEntry(entry: RegisteredAddon): boolean {
  try {
    const capabilities = entry.adapter.descriptor().capabilities;
    return Array.isArray(capabilities) && capabilities.includes('stream');
  } catch {
    return false;
  }
}

export class AddonRegistry {
  constructor(private readonly entries: RegisteredAddon[]) {}

  enabledConfigured(): RegisteredAddon[] {
    return this.entries
      .filter((entry) => entry.installed.enabled)
      .filter((entry) => !entry.installed.setupIncomplete)
      .filter(isStreamEntry)
      .slice()
      .sort((a, b) => (
        b.installed.priority - a.installed.priority
        || stableTextCompare(a.installed.addonId, b.installed.addonId)
      ))
      .slice(0, 100);
  }
}

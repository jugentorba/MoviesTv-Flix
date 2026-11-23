import { createContext, useContext } from 'react';
import type {
  AddonInstallOrigin,
  AddonStateRecord,
  ProviderSetupEntry,
} from '@moviestv/addons';
import type { AddonSyncStatus } from './AddonStateCoordinator';
import type { InspectedAddon } from './AddonInstallationService';

export interface AddonsApi {
  installed: AddonStateRecord[];
  ready: boolean;
  syncStatus: AddonSyncStatus;
  error: string | null;
  refresh(): Promise<void>;
  inspectManifest(input: string, origin?: AddonInstallOrigin): Promise<InspectedAddon>;
  install(inspected: InspectedAddon, values: Record<string, unknown>): Promise<AddonStateRecord>;
  configure(addonId: string, values: Record<string, unknown>): Promise<AddonStateRecord>;
  setEnabled(addonId: string, enabled: boolean): Promise<AddonStateRecord>;
  move(addonId: string, direction: 'up' | 'down'): Promise<AddonStateRecord[]>;
  remove(addonId: string): Promise<void>;
  hasSavedSecret(addonId: string, fieldKey: string): Promise<boolean>;
  /** The configured add-on link stored on this device, if any. Never synced. */
  getRuntimeManifestUrl?(addonId: string): Promise<string | null>;
  /** Collects the links and secret fields a setup code should carry. */
  exportProviderSetup?(): Promise<ProviderSetupEntry[]>;
  /** Applies a setup code received from another device. */
  applyProviderSetup?(
    entries: readonly ProviderSetupEntry[],
  ): Promise<{ applied: number; skipped: number }>;
}

export const AddonsContext = createContext<AddonsApi | null>(null);

export function useAddons(): AddonsApi {
  const context = useContext(AddonsContext);
  if (!context) throw new Error('useAddons must be used inside AddonsProvider');
  return context;
}

/**
 * For screens that only want to *describe* provider state (the catalog empty
 * state) and must still render when no provider exists, as in isolated tests.
 */
export function useOptionalAddons(): AddonsApi | null {
  return useContext(AddonsContext);
}

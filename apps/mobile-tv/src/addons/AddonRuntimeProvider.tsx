import React, { useMemo, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { KeyValueStore } from '@moviestv/storage';
import { AddonsProvider } from './AddonsProvider';
import { createAddonRuntime } from './AddonRuntime';
import type { SecureStoreAdapter } from './SecureAddonSecretStore';

export interface AddonRuntimeProviderProps {
  children: ReactNode;
  metadataStore: KeyValueStore;
  secureStore: SecureStoreAdapter;
  supabase?: SupabaseClient;
  userId?: string | null;
  inheritLegacyUserData?: boolean;
}

export function AddonRuntimeProvider({
  children,
  metadataStore,
  secureStore,
  supabase,
  userId = null,
  inheritLegacyUserData = true,
}: AddonRuntimeProviderProps) {
  const runtime = useMemo(
    () => createAddonRuntime({
      metadataStore,
      secureStore,
      supabase,
      userId,
      inheritLegacyUserData,
    }),
    [inheritLegacyUserData, metadataStore, secureStore, supabase, userId],
  );

  return (
    <AddonsProvider
      userId={userId}
      coordinator={runtime.coordinator}
      service={runtime.service}
      secrets={runtime.secrets}
    >
      {children}
    </AddonsProvider>
  );
}

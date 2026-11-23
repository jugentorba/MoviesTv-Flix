import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AsyncStorageStore } from '@moviestv/storage';
import { theme } from '@moviestv/ui';
import { useAppFonts } from './useAppFonts';
import { useFontGate } from './useFontGate';
import { AppErrorBoundary } from './AppErrorBoundary';
import { markStartup as markStartupOnce } from './startupTiming';
import { ThemeProvider } from '../theme/ThemeProvider';
import { AddonRuntimeProvider } from '../addons/AddonRuntimeProvider';
import { runtimeAddonSecretStore } from '../addons/addonSecretRuntime';
import { AccountContext, type AccountApi } from '../auth/useAccount';
import { useAuthSession } from '../auth/useAuthSession';
import { CatalogProvider } from '../catalog/CatalogProvider';
import { I18nProvider } from '../i18n/I18nProvider';
import { DownloadManagerProvider } from '../downloads/DownloadManagerProvider';
import {
  AppNavigator,
  type SettingsNavigationRequest,
} from '../navigation/AppNavigator';
import type { SettingsPage } from '../screens/SettingsScreen';
import { PlaybackOverlay } from '../playback/PlaybackOverlay';
import { PlaybackProvider } from '../playback/PlaybackProvider';
import { PreferencesProvider } from '../preferences/PreferencesProvider';
import { SupabasePreferenceRemoteStore } from '../preferences/SupabasePreferenceRemoteStore';
import { ProfilesProvider } from '../profiles/ProfilesProvider';
import { profileRuntimeScope } from '../profiles/profileRuntimeScope';
import { useProfiles } from '../profiles/useProfiles';
import {
  fetchRuntimeSupabaseConfig,
  readSupabaseConfig,
  shouldFetchRuntimeSupabaseConfig,
  shouldLoadStoredSupabaseConfig,
  type SupabaseConfigResult,
  type SupabaseEnvironment,
} from '../services/runtime';
import { createSupabaseClient, SupabaseAuthClient } from '../services/supabase';
import { SupabaseWatchProgressGateway } from '../watch-progress/SupabaseWatchProgressGateway';
import { WatchProgressProvider } from '../watch-progress/WatchProgressProvider';
import { useFormFactor, type FormFactor } from './platform';
import { useWebTvRemoteNavigation } from '../web/tvRemoteNavigation';

function AppShell({ formFactor }: { formFactor: FormFactor }) {
  const nextSettingsRequestId = useRef(0);
  const [settingsRequest, setSettingsRequest] = useState<SettingsNavigationRequest | null>(null);

  const openSettings = useCallback((page: SettingsPage) => {
    nextSettingsRequestId.current += 1;
    setSettingsRequest({
      id: nextSettingsRequestId.current,
      page,
    });
  }, []);

  const handleSettingsRequest = useCallback((id: number) => {
    setSettingsRequest((current) => (
      current?.id === id ? null : current
    ));
  }, []);

  return (
    <CatalogProvider>
      <PlaybackProvider>
        <View style={{ flex: 1 }}>
          <AppNavigator
            formFactor={formFactor}
            settingsRequest={settingsRequest}
            onSettingsRequestHandled={handleSettingsRequest}
          />
          <PlaybackOverlay
            onOpenStreamProviders={() => openSettings('stream-providers')}
          />
        </View>
      </PlaybackProvider>
    </CatalogProvider>
  );
}

function LocalGuestApp({
  formFactor,
  preferenceStore,
  runtimeConfigLoading = false,
  onRetryBackend,
  onConfigureBackend,
}: {
  formFactor: FormFactor;
  preferenceStore: AsyncStorageStore;
  runtimeConfigLoading?: boolean;
  onRetryBackend?(): void;
  onConfigureBackend?(url: string, publishableKey: string): Promise<boolean>;
}) {
  const { activeProfile } = useProfiles();
  const {
    isMainProfile,
    profileIdentity,
    providerIdentity,
    promoteMainData,
  } = profileRuntimeScope({
    profileId: activeProfile.id,
    useMainProviders: activeProfile.useMainProviders,
    mainIdentity: null,
  });
  const usesMainProviders = isMainProfile || activeProfile.useMainProviders;

  const account = useMemo<AccountApi>(() => ({
    backendAvailable: false,
    userId: null,
    loading: runtimeConfigLoading,
    ...(onRetryBackend ? { retryBackend: onRetryBackend } : {}),
    ...(onConfigureBackend ? { configureBackend: onConfigureBackend } : {}),
    signIn: async () => undefined,
    signUp: async () => undefined,
    signOut: async () => undefined,
  }), [onConfigureBackend, onRetryBackend, runtimeConfigLoading]);

  return (
    <AccountContext.Provider value={account}>
      <PreferencesProvider
        store={preferenceStore}
        userId={profileIdentity}
        promoteGuestPreferences={promoteMainData}
      >
        <I18nProvider>
          <AddonRuntimeProvider
            metadataStore={preferenceStore}
            secureStore={runtimeAddonSecretStore}
            userId={providerIdentity}
            inheritLegacyUserData={usesMainProviders}
          >
            <WatchProgressProvider
              userId={profileIdentity ?? undefined}
              promoteGuestProgress={promoteMainData}
            >
              <DownloadManagerProvider
                key={profileIdentity ?? 'guest'}
                identityOverride={profileIdentity}
              >
                <AppShell formFactor={formFactor} />
              </DownloadManagerProvider>
            </WatchProgressProvider>
          </AddonRuntimeProvider>
        </I18nProvider>
      </PreferencesProvider>
    </AccountContext.Provider>
  );
}

function BackendApp({
  config,
  formFactor,
  preferenceStore,
  onResetBackend,
}: {
  config: Extract<SupabaseConfigResult, { ok: true }>;
  formFactor: FormFactor;
  preferenceStore: AsyncStorageStore;
  onResetBackend?(): Promise<void>;
}) {
  const supabase = useMemo(
    () => createSupabaseClient(config, AsyncStorage)!,
    [config.url, config.publishableKey],
  );
  const authClient = useMemo(() => new SupabaseAuthClient(supabase), [supabase]);
  const preferenceRemote = useMemo(
    () => new SupabasePreferenceRemoteStore(supabase),
    [supabase],
  );
  const watchProgressRemote = useMemo(
    () => new SupabaseWatchProgressGateway(supabase),
    [supabase],
  );
  const auth = useAuthSession(authClient);
  const userId = auth.session?.userId ?? null;
  const { activeProfile } = useProfiles();
  const {
    isMainProfile,
    dataIdentity,
    providerIdentity,
    promoteMainData,
  } = profileRuntimeScope({
    profileId: activeProfile.id,
    useMainProviders: activeProfile.useMainProviders,
    mainIdentity: userId,
  });
  const usesMainProviders = isMainProfile || activeProfile.useMainProviders;

  useEffect(() => () => {
    void authClient.dispose().catch(() => undefined);
  }, [authClient]);

  const account = useMemo<AccountApi>(() => ({
    backendAvailable: true,
    userId,
    loading: auth.loading,
    message: auth.message,
    ...(onResetBackend ? { resetBackend: onResetBackend } : {}),
    signIn: auth.signIn,
    signUp: auth.signUp,
    signOut: auth.signOut,
  }), [
    auth.loading,
    auth.message,
    auth.signIn,
    auth.signOut,
    auth.signUp,
    onResetBackend,
    userId,
  ]);

  return (
    <AccountContext.Provider value={account}>
      <PreferencesProvider
        store={preferenceStore}
        userId={dataIdentity}
        remoteStore={isMainProfile ? preferenceRemote : null}
        promoteGuestPreferences={promoteMainData}
      >
        <I18nProvider>
          <AddonRuntimeProvider
            metadataStore={preferenceStore}
            secureStore={runtimeAddonSecretStore}
            supabase={usesMainProviders ? supabase : undefined}
            userId={providerIdentity}
            inheritLegacyUserData={usesMainProviders}
          >
            <WatchProgressProvider
              userId={dataIdentity ?? undefined}
              remoteGateway={isMainProfile ? watchProgressRemote : null}
              promoteGuestProgress={promoteMainData}
            >
              <DownloadManagerProvider
                key={dataIdentity ?? 'guest'}
                identityOverride={dataIdentity}
              >
                <AppShell formFactor={formFactor} />
              </DownloadManagerProvider>
            </WatchProgressProvider>
          </AddonRuntimeProvider>
        </I18nProvider>
      </PreferencesProvider>
    </AccountContext.Provider>
  );
}

const RUNTIME_SUPABASE_STORAGE_KEY = 'moviestv:runtime-supabase:v1';

export function enqueueRuntimeConfigStorageMutation(
  queueRef: { current: Promise<void> },
  task: () => Promise<void>,
): Promise<void> {
  const run = queueRef.current
    .catch(() => undefined)
    .then(task);
  queueRef.current = run.catch(() => undefined);
  return run;
}

export default function AppRoot({ environment }: { environment?: SupabaseEnvironment }) {
  // Fonts are registered before anything is measured, so the first frame is
  // already in the design font instead of reflowing afterwards.
  const [fontsLoaded, fontError] = useAppFonts();
  const fontsReady = useFontGate(fontsLoaded, fontError);
  const formFactor = useFormFactor();
  useWebTvRemoteNavigation(
    Platform.OS === 'web' && formFactor === 'tv',
  );
  const preferenceStore = useMemo(() => new AsyncStorageStore(AsyncStorage), []);
  const processEnvironment: SupabaseEnvironment = {
    EXPO_PUBLIC_PREVIEW_MODE: process.env.EXPO_PUBLIC_PREVIEW_MODE,
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
  const activeEnvironment = environment ?? processEnvironment;
  const buildConfig = readSupabaseConfig(activeEnvironment);
  const [runtimeConfig, setRuntimeConfig] = useState<
    Extract<SupabaseConfigResult, { ok: true }> | null
  >(null);
  const [runtimeConfigLoading, setRuntimeConfigLoading] = useState(false);
  const [runtimeRetryNonce, setRuntimeRetryNonce] = useState(0);
  const runtimeConfigGenerationRef = useRef(0);
  const runtimeConfigStorageQueueRef = useRef<Promise<void>>(Promise.resolve());
  const retryRuntimeConfig = useCallback(() => {
    runtimeConfigGenerationRef.current += 1;
    setRuntimeRetryNonce((value) => value + 1);
  }, []);
  const configureRuntimeBackend = useCallback(async (
    url: string,
    publishableKey: string,
  ): Promise<boolean> => {
    const next = readSupabaseConfig({
      EXPO_PUBLIC_SUPABASE_URL: url,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    });
    if (!next.ok) return false;

    runtimeConfigGenerationRef.current += 1;
    setRuntimeConfigLoading(false);
    setRuntimeConfig(next);
    try {
      await enqueueRuntimeConfigStorageMutation(
        runtimeConfigStorageQueueRef,
        () => AsyncStorage.setItem(
          RUNTIME_SUPABASE_STORAGE_KEY,
          JSON.stringify({
            supabaseUrl: next.url,
            supabasePublishableKey: next.publishableKey,
          }),
        ),
      );
    } catch {
      // Keep the validated backend active for this session even if storage fails.
    }
    return true;
  }, []);
  const resetRuntimeBackend = useCallback(async (): Promise<void> => {
    runtimeConfigGenerationRef.current += 1;
    setRuntimeConfigLoading(false);
    setRuntimeConfig(null);
    try {
      await enqueueRuntimeConfigStorageMutation(
        runtimeConfigStorageQueueRef,
        () => AsyncStorage.removeItem(RUNTIME_SUPABASE_STORAGE_KEY),
      );
    } catch {
      // Runtime fallback still returns to guest mode for this session.
    }
  }, []);

  useEffect(() => {
    const generation = ++runtimeConfigGenerationRef.current;
    setRuntimeConfig(null);

    if (!shouldLoadStoredSupabaseConfig(
      environment !== undefined,
      buildConfig.ok,
    )) {
      setRuntimeConfigLoading(false);
      return undefined;
    }

    let active = true;
    setRuntimeConfigLoading(true);
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(
          RUNTIME_SUPABASE_STORAGE_KEY,
        );
        if (stored) {
          const parsed = JSON.parse(stored) as {
            supabaseUrl?: unknown;
            supabasePublishableKey?: unknown;
          };
          const saved = readSupabaseConfig({
            EXPO_PUBLIC_SUPABASE_URL:
              typeof parsed.supabaseUrl === 'string'
                ? parsed.supabaseUrl
                : undefined,
            EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
              typeof parsed.supabasePublishableKey === 'string'
                ? parsed.supabasePublishableKey
                : undefined,
          });
          if (saved.ok) {
            if (
              active
              && generation === runtimeConfigGenerationRef.current
            ) {
              setRuntimeConfig(saved);
            }
            return;
          }
          // Ignore invalid cached public configuration. Do not delete it
          // here: a manual configuration may be writing a replacement at the
          // same time, and an old discovery pass must never race that write.
        }
      } catch {
        // Ignore malformed or unavailable local storage and try the runtime API.
      }

      if (
        !active
        || generation !== runtimeConfigGenerationRef.current
      ) return;

      // Native preview builds can still load a manually saved public backend
      // from AsyncStorage. Only the web PWA has a same-origin runtime endpoint.
      if (!shouldFetchRuntimeSupabaseConfig(
        Platform.OS,
        environment !== undefined,
        buildConfig.ok,
      )) return;

      const next = await fetchRuntimeSupabaseConfig(
        (input, init) => fetch(input, init),
      );
      if (
        !active
        || generation !== runtimeConfigGenerationRef.current
        || !next.ok
      ) return;
      setRuntimeConfig(next);
      try {
        await enqueueRuntimeConfigStorageMutation(
          runtimeConfigStorageQueueRef,
          () => AsyncStorage.setItem(
            RUNTIME_SUPABASE_STORAGE_KEY,
            JSON.stringify({
              supabaseUrl: next.url,
              supabasePublishableKey: next.publishableKey,
            }),
          ),
        );
      } catch {
        // Public runtime configuration can still be used for this session.
      }
    })().finally(() => {
      if (
        active
        && generation === runtimeConfigGenerationRef.current
      ) {
        setRuntimeConfigLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [
    environment,
    activeEnvironment.EXPO_PUBLIC_SUPABASE_URL,
    activeEnvironment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    buildConfig.ok,
    runtimeRetryNonce,
  ]);

  const config: SupabaseConfigResult = runtimeConfig ?? buildConfig;

  const app = !config.ok ? (
    <LocalGuestApp
      formFactor={formFactor}
      preferenceStore={preferenceStore}
      runtimeConfigLoading={runtimeConfigLoading}
      onRetryBackend={
        environment === undefined
        && Platform.OS === 'web'
        && !buildConfig.ok
          ? retryRuntimeConfig
          : undefined
      }
      onConfigureBackend={
        environment === undefined
        && !buildConfig.ok
          ? configureRuntimeBackend
          : undefined
      }
    />
  ) : (
    <BackendApp
      config={config}
      formFactor={formFactor}
      preferenceStore={preferenceStore}
      onResetBackend={
        environment === undefined
        && !buildConfig.ok
          ? resetRuntimeBackend
          : undefined
      }
    />
  );

  markStartupOnce('app-render');

  if (!fontsReady) {
    // A single themed surface instead of a white flash while fonts register.
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  return (
    // Outermost: a render error anywhere — including inside a provider — must
    // never leave a white window with no way back.
    <AppErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <ProfilesProvider>
            {app}
          </ProfilesProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}

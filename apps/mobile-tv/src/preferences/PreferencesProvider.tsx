import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  defaultUserPreferences,
  migrateUserPreferences,
  type MyListMediaItem,
  type UserPreferences,
} from '@moviestv/core';
import type { KeyValueStore } from '@moviestv/storage';
import {
  PreferenceSyncService,
  chooseLatest,
  type PreferenceRemoteStore,
  type TimestampedPreferences,
} from '@moviestv/sync';
import { PreferencesContext, type PreferencesApi } from './usePreferences';

const LEGACY_CACHE_KEY = 'user-preferences';
const GUEST_CACHE_KEY = 'user-preferences:guest';
const EMPTY_TIMESTAMP = '1970-01-01T00:00:00.000Z';

type TimestampedUnknown = { value: unknown; updatedAt: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamped(value: unknown): value is TimestampedUnknown {
  return isRecord(value) && 'value' in value && typeof value.updatedAt === 'string';
}

function unwrap(value: unknown): unknown {
  return isTimestamped(value) ? value.value : value;
}

function timestampOf(value: unknown, fallback: string): string {
  if (!isTimestamped(value)) return fallback;
  const parsed = Date.parse(value.updatedAt);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function toPlain(state: TimestampedPreferences): UserPreferences {
  return {
    appLocale: state.appLocale.value,
    preferredAudioLanguages: state.preferredAudioLanguages.value,
    preferredSubtitleLanguages: state.preferredSubtitleLanguages.value,
    subtitlesEnabled: state.subtitlesEnabled.value,
    autoplay: state.autoplay.value,
    favoriteChannelIds: state.favoriteChannelIds.value,
    myListItems: state.myListItems.value,
  };
}

function seedPreferences(timestamp: string): TimestampedPreferences {
  const defaults = defaultUserPreferences();
  return {
    appLocale: { value: defaults.appLocale, updatedAt: timestamp },
    preferredAudioLanguages: {
      value: defaults.preferredAudioLanguages,
      updatedAt: timestamp,
    },
    preferredSubtitleLanguages: {
      value: defaults.preferredSubtitleLanguages,
      updatedAt: timestamp,
    },
    subtitlesEnabled: { value: defaults.subtitlesEnabled, updatedAt: timestamp },
    autoplay: { value: defaults.autoplay, updatedAt: timestamp },
    favoriteChannelIds: {
      value: defaults.favoriteChannelIds,
      updatedAt: timestamp,
    },
    myListItems: { value: defaults.myListItems, updatedAt: timestamp },
  };
}

function migrateTimestampedPreferences(
  raw: unknown,
  timestamp: string,
): TimestampedPreferences {
  if (!isRecord(raw)) return seedPreferences(EMPTY_TIMESTAMP);

  const audioSource = raw.preferredAudioLanguages ?? raw.audioLanguages;
  const subtitleSource = raw.preferredSubtitleLanguages ?? raw.subtitleLanguage;
  const plain = migrateUserPreferences({
    appLocale: unwrap(raw.appLocale),
    preferredAudioLanguages: unwrap(audioSource),
    preferredSubtitleLanguages: Array.isArray(
      unwrap(raw.preferredSubtitleLanguages),
    )
      ? unwrap(raw.preferredSubtitleLanguages)
      : undefined,
    audioLanguages: unwrap(raw.audioLanguages),
    subtitleLanguage: unwrap(raw.subtitleLanguage),
    subtitlesEnabled: unwrap(raw.subtitlesEnabled),
    autoplay: unwrap(raw.autoplay),
    favoriteChannelIds: unwrap(raw.favoriteChannelIds),
    myListItems: unwrap(raw.myListItems),
  });

  return {
    appLocale: {
      value: plain.appLocale,
      updatedAt: timestampOf(raw.appLocale, timestamp),
    },
    preferredAudioLanguages: {
      value: plain.preferredAudioLanguages,
      updatedAt: timestampOf(audioSource, timestamp),
    },
    preferredSubtitleLanguages: {
      value: plain.preferredSubtitleLanguages,
      updatedAt: timestampOf(subtitleSource, timestamp),
    },
    subtitlesEnabled: {
      value: plain.subtitlesEnabled,
      updatedAt: timestampOf(
        raw.subtitlesEnabled ?? raw.subtitleLanguage,
        timestamp,
      ),
    },
    autoplay: {
      value: plain.autoplay,
      updatedAt: timestampOf(raw.autoplay, timestamp),
    },
    favoriteChannelIds: {
      value: plain.favoriteChannelIds,
      updatedAt: timestampOf(raw.favoriteChannelIds, timestamp),
    },
    myListItems: {
      value: plain.myListItems,
      updatedAt: timestampOf(raw.myListItems, timestamp),
    },
  };
}

function mergeTimestampedPreferences(
  left: TimestampedPreferences,
  right: TimestampedPreferences,
): TimestampedPreferences {
  return {
    appLocale: chooseLatest(left.appLocale, right.appLocale),
    preferredAudioLanguages: chooseLatest(
      left.preferredAudioLanguages,
      right.preferredAudioLanguages,
    ),
    preferredSubtitleLanguages: chooseLatest(
      left.preferredSubtitleLanguages,
      right.preferredSubtitleLanguages,
    ),
    subtitlesEnabled: chooseLatest(
      left.subtitlesEnabled,
      right.subtitlesEnabled,
    ),
    autoplay: chooseLatest(left.autoplay, right.autoplay),
    favoriteChannelIds: chooseLatest(
      left.favoriteChannelIds,
      right.favoriteChannelIds,
    ),
    myListItems: chooseLatest(left.myListItems, right.myListItems),
  };
}

export function preferenceCacheKeyForUser(
  userId: string | null | undefined,
): string {
  const normalized = userId?.trim();
  return normalized
    ? `user-preferences:user:${encodeURIComponent(normalized)}`
    : GUEST_CACHE_KEY;
}

async function loadScopedPreferences(
  store: KeyValueStore,
  userId: string | null,
  migrationTimestamp: string,
  promoteGuestPreferences = true,
): Promise<TimestampedPreferences> {
  const cacheKey = preferenceCacheKeyForUser(userId);
  const scopedRaw = await store.get<unknown>(cacheKey);
  const scoped = scopedRaw === null
    ? null
    : migrateTimestampedPreferences(scopedRaw, migrationTimestamp);

  if (userId === null) {
    if (scoped !== null) {
      if (JSON.stringify(scopedRaw) !== JSON.stringify(scoped)) {
        await store.set(cacheKey, scoped);
      }
      return scoped;
    }

    const legacy = await store.get<unknown>(LEGACY_CACHE_KEY);
    const migrated = legacy === null
      ? seedPreferences(EMPTY_TIMESTAMP)
      : migrateTimestampedPreferences(legacy, migrationTimestamp);
    await store.set(cacheKey, migrated);
    if (legacy !== null) await store.remove(LEGACY_CACHE_KEY);
    return migrated;
  }

  const guestRaw = promoteGuestPreferences
    ? await store.get<unknown>(GUEST_CACHE_KEY)
    : null;
  const legacyRaw = promoteGuestPreferences && guestRaw === null
    ? await store.get<unknown>(LEGACY_CACHE_KEY)
    : null;
  const promotableRaw = guestRaw ?? legacyRaw;

  let next = scoped ?? seedPreferences(EMPTY_TIMESTAMP);
  if (promotableRaw !== null) {
    const promotable = migrateTimestampedPreferences(
      promotableRaw,
      migrationTimestamp,
    );
    next = scoped
      ? mergeTimestampedPreferences(scoped, promotable)
      : promotable;

    await store.set(cacheKey, next);
    await store.remove(GUEST_CACHE_KEY);
    if (legacyRaw !== null) await store.remove(LEGACY_CACHE_KEY);
    return next;
  }

  if (
    scopedRaw === null
    || JSON.stringify(scopedRaw) !== JSON.stringify(next)
  ) {
    await store.set(cacheKey, next);
  }
  return next;
}

export interface PreferencesProviderProps {
  children: ReactNode;
  store: KeyValueStore;
  userId?: string | null;
  remoteStore?: PreferenceRemoteStore | null;
  now?: () => number;
  promoteGuestPreferences?: boolean;
}

export function PreferencesProvider({
  children,
  store,
  userId = null,
  remoteStore = null,
  now = Date.now,
  promoteGuestPreferences = true,
}: PreferencesProviderProps) {
  const normalizedUserId = userId?.trim() || null;
  const initial = useMemo(
    () => seedPreferences(EMPTY_TIMESTAMP),
    [],
  );
  const [timestamped, setTimestamped] = useState<TimestampedPreferences>(
    initial,
  );
  const [ready, setReady] = useState(false);
  const currentRef = useRef(timestamped);
  const durableRef = useRef(timestamped);
  const localMutationRevisionRef = useRef(0);
  const identityGenerationRef = useRef(1);
  const stateGenerationRef = useRef(1);
  const readyGenerationRef = useRef<number | null>(null);
  const syncQueueRef = useRef<{
    generation: number;
    tail: Promise<void>;
  }>({
    generation: 0,
    tail: Promise.resolve(),
  });
  const persistQueueRef = useRef<{
    cacheKey: string;
    tail: Promise<void>;
  }>({
    cacheKey: '',
    tail: Promise.resolve(),
  });
  const preferenceIdentityRef = useRef({
    userId: normalizedUserId,
    store,
    remoteStore,
  });
  const identityChanged = (
    preferenceIdentityRef.current.userId !== normalizedUserId
    || preferenceIdentityRef.current.store !== store
    || preferenceIdentityRef.current.remoteStore !== remoteStore
  );
  if (identityChanged) {
    preferenceIdentityRef.current = {
      userId: normalizedUserId,
      store,
      remoteStore,
    };
    identityGenerationRef.current += 1;
    readyGenerationRef.current = null;
    syncQueueRef.current = {
      generation: identityGenerationRef.current,
      tail: Promise.resolve(),
    };
    persistQueueRef.current = {
      cacheKey: '',
      tail: Promise.resolve(),
    };
    durableRef.current = seedPreferences(EMPTY_TIMESTAMP);
    localMutationRevisionRef.current = 0;
  }

  const activeCacheKey = preferenceCacheKeyForUser(normalizedUserId);
  const renderGeneration = identityGenerationRef.current;

  const visibleIdentity = (
    stateGenerationRef.current === renderGeneration
  );
  const visibleTimestamped = visibleIdentity
    ? timestamped
    : seedPreferences(EMPTY_TIMESTAMP);
  const visibleReady = (
    visibleIdentity
    && ready
    && readyGenerationRef.current === renderGeneration
  );

  const apply = useCallback((
    next: TimestampedPreferences,
    generation = identityGenerationRef.current,
  ) => {
    currentRef.current = next;
    stateGenerationRef.current = generation;
    setTimestamped(next);
  }, []);

  const reconcileRemote = useCallback((
    activeUserId: string,
    activeRemote: PreferenceRemoteStore,
    cacheKey: string,
    generation: number,
  ) => {
    if (syncQueueRef.current.generation !== generation) {
      syncQueueRef.current = {
        generation,
        tail: Promise.resolve(),
      };
    }

    const run = syncQueueRef.current.tail
      .catch(() => undefined)
      .then(async () => {
        const service = new PreferenceSyncService(
          store,
          activeRemote,
          cacheKey,
        );
        const revisionBeforeSync = localMutationRevisionRef.current;
        let next = await service.sync(activeUserId);

        if (
          generation === identityGenerationRef.current
          && revisionBeforeSync !== localMutationRevisionRef.current
        ) {
          // A local preference update raced this remote read. Wait for the
          // local persistence lane, restore the last durable local snapshot,
          // then reconcile once more so a stale remote sync cannot overwrite
          // the newer on-device change.
          await persistQueueRef.current.tail.catch(() => undefined);
          if (generation !== identityGenerationRef.current) return;
          await store.set(cacheKey, durableRef.current);
          next = await service.sync(activeUserId);
        }

        if (generation === identityGenerationRef.current) {
          durableRef.current = next;
          apply(next, generation);
        }
      });

    syncQueueRef.current = {
      generation,
      tail: run.catch(() => undefined),
    };
  }, [apply, store]);

  useEffect(() => {
    const generation = identityGenerationRef.current;
    const placeholder = seedPreferences(EMPTY_TIMESTAMP);
    readyGenerationRef.current = null;
    apply(placeholder, generation);
    setReady(false);

    let active = true;
    const clock = now();
    void loadScopedPreferences(
      store,
      normalizedUserId,
      new Date(Number.isFinite(clock) ? clock : Date.now()).toISOString(),
      promoteGuestPreferences,
    )
      .then((next) => {
        if (
          !active
          || generation !== identityGenerationRef.current
        ) return;
        durableRef.current = next;
        apply(next, generation);
        readyGenerationRef.current = generation;
        setReady(true);
      })
      .catch(() => {
        if (
          !active
          || generation !== identityGenerationRef.current
        ) return;
        const fallback = seedPreferences(EMPTY_TIMESTAMP);
        durableRef.current = fallback;
        apply(fallback, generation);
        readyGenerationRef.current = generation;
        setReady(true);
      });

    return () => {
      active = false;
    };
  }, [
    apply,
    now,
    store,
    normalizedUserId,
    promoteGuestPreferences,
    renderGeneration,
  ]);

  useEffect(() => {
    if (!visibleReady || !normalizedUserId || !remoteStore) return;
    reconcileRemote(
      normalizedUserId,
      remoteStore,
      activeCacheKey,
      renderGeneration,
    );
  }, [
    activeCacheKey,
    reconcileRemote,
    remoteStore,
    normalizedUserId,
    renderGeneration,
    visibleReady,
  ]);

  const persist = useCallback(async (
    next: TimestampedPreferences,
  ) => {
    const generation = renderGeneration;
    if (
      generation !== identityGenerationRef.current
      || readyGenerationRef.current !== generation
    ) return;
    localMutationRevisionRef.current += 1;
    apply(next, generation);

    if (persistQueueRef.current.cacheKey !== activeCacheKey) {
      persistQueueRef.current = {
        cacheKey: activeCacheKey,
        tail: Promise.resolve(),
      };
    }

    const writeGeneration = generation;
    const write = persistQueueRef.current.tail
      .catch(() => undefined)
      .then(() => {
        if (writeGeneration !== identityGenerationRef.current) return;
        return store.set(activeCacheKey, next);
      });
    persistQueueRef.current = {
      cacheKey: activeCacheKey,
      tail: write.catch(() => undefined),
    };

    try {
      await write;
    } catch (error) {
      if (
        generation === identityGenerationRef.current
        && currentRef.current === next
      ) {
        apply(durableRef.current, generation);
      }
      throw error;
    }
    if (generation !== identityGenerationRef.current) return;
    durableRef.current = next;
    if (normalizedUserId && remoteStore) {
      reconcileRemote(
        normalizedUserId,
        remoteStore,
        activeCacheKey,
        generation,
      );
    }
  }, [
    activeCacheKey,
    apply,
    reconcileRemote,
    remoteStore,
    store,
    normalizedUserId,
    renderGeneration,
  ]);

  const updatedAt = useCallback(
    (previous?: string) => {
      const current = now();
      const clockMs = Number.isFinite(current)
        ? current
        : Date.now();
      const previousMs = previous
        ? Date.parse(previous)
        : Number.NEGATIVE_INFINITY;
      const nextMs = Number.isFinite(previousMs)
        && clockMs <= previousMs
        ? Math.min(previousMs + 1, 8_640_000_000_000_000)
        : clockMs;
      return new Date(nextMs).toISOString();
    },
    [now],
  );

  const setAppLocale = useCallback(async (
    value: string | 'system',
  ) => {
    const normalized = migrateUserPreferences({
      ...toPlain(currentRef.current),
      appLocale: value,
    });
    await persist({
      ...currentRef.current,
      appLocale: {
        value: normalized.appLocale,
        updatedAt: updatedAt(currentRef.current.appLocale.updatedAt),
      },
    });
  }, [persist, updatedAt]);

  const setPreferredAudioLanguages = useCallback(async (
    value: string[],
  ) => {
    const normalized = migrateUserPreferences({
      ...toPlain(currentRef.current),
      preferredAudioLanguages: value,
    });
    await persist({
      ...currentRef.current,
      preferredAudioLanguages: {
        value: normalized.preferredAudioLanguages,
        updatedAt: updatedAt(currentRef.current.preferredAudioLanguages.updatedAt),
      },
    });
  }, [persist, updatedAt]);

  const setPreferredSubtitleLanguages = useCallback(async (
    value: string[],
  ) => {
    const normalized = migrateUserPreferences({
      ...toPlain(currentRef.current),
      preferredSubtitleLanguages: value,
    });
    await persist({
      ...currentRef.current,
      preferredSubtitleLanguages: {
        value: normalized.preferredSubtitleLanguages,
        updatedAt: updatedAt(currentRef.current.preferredSubtitleLanguages.updatedAt),
      },
    });
  }, [persist, updatedAt]);

  const setSubtitlesEnabled = useCallback(async (value: boolean) => {
    await persist({
      ...currentRef.current,
      subtitlesEnabled: {
        value,
        updatedAt: updatedAt(currentRef.current.subtitlesEnabled.updatedAt),
      },
    });
  }, [persist, updatedAt]);

  const setAutoplay = useCallback(async (value: boolean) => {
    await persist({
      ...currentRef.current,
      autoplay: {
        value,
        updatedAt: updatedAt(currentRef.current.autoplay.updatedAt),
      },
    });
  }, [persist, updatedAt]);

  const setFavoriteChannelIds = useCallback(async (
    value: string[],
  ) => {
    const normalized = migrateUserPreferences({
      ...toPlain(currentRef.current),
      favoriteChannelIds: value,
    });
    await persist({
      ...currentRef.current,
      favoriteChannelIds: {
        value: normalized.favoriteChannelIds,
        updatedAt: updatedAt(currentRef.current.favoriteChannelIds.updatedAt),
      },
    });
  }, [persist, updatedAt]);

  const setMyListItems = useCallback(async (
    value: MyListMediaItem[],
  ) => {
    const normalized = migrateUserPreferences({
      ...toPlain(currentRef.current),
      myListItems: value,
    });
    await persist({
      ...currentRef.current,
      myListItems: {
        value: normalized.myListItems,
        updatedAt: updatedAt(currentRef.current.myListItems.updatedAt),
      },
    });
  }, [persist, updatedAt]);


  const api = useMemo<PreferencesApi>(() => ({
    preferences: toPlain(visibleTimestamped),
    ready: visibleReady,
    setAppLocale,
    setPreferredAudioLanguages,
    setPreferredSubtitleLanguages,
    setSubtitlesEnabled,
    setAutoplay,
    setFavoriteChannelIds,
    setMyListItems,
  }), [
    setAppLocale,
    setAutoplay,
    setFavoriteChannelIds,
    setMyListItems,
    setPreferredAudioLanguages,
    setPreferredSubtitleLanguages,
    setSubtitlesEnabled,
    visibleReady,
    visibleTimestamped,
  ]);

  return (
    <PreferencesContext.Provider value={api}>
      {children}
    </PreferencesContext.Provider>
  );
}

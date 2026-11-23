import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_PROFILE_ID,
  ProfilesContext,
  type AppProfile,
  type ProfilesApi,
} from './useProfiles';
import { PROFILE_AVATARS } from './avatars';

const STORAGE_KEY = 'moviestv:profiles:v1';
/** Only ids from the preset list are accepted, so storage cannot inject an icon. */
const AVATAR_IDS = new Set(PROFILE_AVATARS.map((avatar) => avatar.id));
const MAX_PROFILES = 5;
const MAX_PROFILE_NAME_LENGTH = 30;

type StoredProfiles = {
  profiles: AppProfile[];
  activeProfileId: string;
};

function defaultProfile(): AppProfile {
  return {
    id: DEFAULT_PROFILE_ID,
    name: 'Main',
    createdAt: '1970-01-01T00:00:00.000Z',
    useMainProviders: true,
  };
}

function cleanName(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PROFILE_NAME_LENGTH);
}

function validProfile(value: unknown): AppProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<AppProfile>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const name = typeof record.name === 'string' ? cleanName(record.name) : '';
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt.trim() : '';
  if (
    !id
    || id.length > 96
    || !name
    || Number.isNaN(Date.parse(createdAt))
    || /[\u0000-\u001f\u007f]/.test(id)
  ) return null;
  return {
    id,
    name,
    createdAt: new Date(createdAt).toISOString(),
    useMainProviders: id === DEFAULT_PROFILE_ID
      ? true
      : record.useMainProviders === true,
    ...(typeof record.avatarId === 'string' && record.avatarId.trim()
      ? { avatarId: record.avatarId.trim() }
      : {}),
  };
}

function normalizeStored(value: unknown): StoredProfiles {
  const main = defaultProfile();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { profiles: [main], activeProfileId: main.id };
  }
  const raw = value as { profiles?: unknown; activeProfileId?: unknown };
  const parsed = Array.isArray(raw.profiles)
    ? raw.profiles.map(validProfile).filter((profile): profile is AppProfile => Boolean(profile))
    : [];
  const unique = new Map<string, AppProfile>();
  unique.set(main.id, {
    ...main,
    ...(parsed.find((profile) => profile.id === main.id)
      ? { name: parsed.find((profile) => profile.id === main.id)!.name }
      : {}),
  });
  for (const profile of parsed) {
    if (profile.id === main.id || unique.size >= MAX_PROFILES) continue;
    unique.set(profile.id, profile);
  }
  const profiles = [...unique.values()];
  const requested = typeof raw.activeProfileId === 'string'
    ? raw.activeProfileId.trim()
    : '';
  return {
    profiles,
    activeProfileId: profiles.some((profile) => profile.id === requested)
      ? requested
      : main.id,
  };
}

function newProfileId(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  const randomUuid = cryptoApi?.randomUUID?.();
  if (randomUuid) return randomUuid;
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ProfilesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoredProfiles>(() => normalizeStored(null));
  const [ready, setReady] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!active) return;
        let parsed: unknown = null;
        if (stored) {
          try { parsed = JSON.parse(stored); } catch { parsed = null; }
        }
        const next = normalizeStored(parsed);
        stateRef.current = next;
        setState(next);
        setReady(true);
        return AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      })
      .catch(() => {
        if (!active) return;
        setReady(true);
      });
    return () => { active = false; };
  }, []);

  const persist = useCallback(async (next: StoredProfiles) => {
    const normalized = normalizeStored(next);
    stateRef.current = normalized;
    setState(normalized);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  }, []);

  const selectProfile = useCallback(async (id: string) => {
    const current = stateRef.current;
    if (!current.profiles.some((profile) => profile.id === id)) return;
    await persist({ ...current, activeProfileId: id });
  }, [persist]);

  const createProfile = useCallback(async (
    name: string,
    useMainProviders = false,
  ): Promise<AppProfile | null> => {
    const current = stateRef.current;
    const normalizedName = cleanName(name);
    if (!normalizedName || current.profiles.length >= MAX_PROFILES) return null;
    const profile: AppProfile = {
      id: newProfileId(),
      name: normalizedName,
      createdAt: new Date().toISOString(),
      useMainProviders,
    };
    await persist({
      profiles: [...current.profiles, profile],
      activeProfileId: profile.id,
    });
    return profile;
  }, [persist]);

  const setAvatar = useCallback(async (id: string, avatarId: string): Promise<boolean> => {
    if (!AVATAR_IDS.has(avatarId)) return false;
    setState((current) => ({
      ...current,
      profiles: current.profiles.map((profile) => (
        profile.id === id ? { ...profile, avatarId } : profile
      )),
    }));
    return true;
  }, []);

  const renameProfile = useCallback(async (id: string, name: string): Promise<boolean> => {
    const current = stateRef.current;
    const normalizedName = cleanName(name);
    if (!normalizedName || !current.profiles.some((profile) => profile.id === id)) return false;
    await persist({
      ...current,
      profiles: current.profiles.map((profile) => (
        profile.id === id ? { ...profile, name: normalizedName } : profile
      )),
    });
    return true;
  }, [persist]);

  const setUseMainProviders = useCallback(async (
    id: string,
    value: boolean,
  ): Promise<boolean> => {
    if (id === DEFAULT_PROFILE_ID) return false;
    const current = stateRef.current;
    if (!current.profiles.some((profile) => profile.id === id)) return false;
    await persist({
      ...current,
      profiles: current.profiles.map((profile) => (
        profile.id === id
          ? { ...profile, useMainProviders: value }
          : profile
      )),
    });
    return true;
  }, [persist]);

  const deleteProfile = useCallback(async (id: string): Promise<boolean> => {
    if (id === DEFAULT_PROFILE_ID) return false;
    const current = stateRef.current;
    if (!current.profiles.some((profile) => profile.id === id)) return false;
    const profiles = current.profiles.filter((profile) => profile.id !== id);
    await persist({
      profiles,
      activeProfileId: current.activeProfileId === id
        ? DEFAULT_PROFILE_ID
        : current.activeProfileId,
    });
    return true;
  }, [persist]);

  const activeProfile = state.profiles.find(
    (profile) => profile.id === state.activeProfileId,
  ) ?? state.profiles[0] ?? defaultProfile();

  const value = useMemo<ProfilesApi>(() => ({
    profiles: state.profiles,
    activeProfile,
    ready,
    selectProfile,
    createProfile,
    renameProfile,
    setAvatar,
    setUseMainProviders,
    deleteProfile,
  }), [
    activeProfile,
    createProfile,
    deleteProfile,
    ready,
    renameProfile,
    setAvatar,
    selectProfile,
    setUseMainProviders,
    state.profiles,
  ]);

  return (
    <ProfilesContext.Provider value={value}>
      {children}
    </ProfilesContext.Provider>
  );
}

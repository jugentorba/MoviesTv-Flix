import { createContext, useContext } from 'react';

export interface AppProfile {
  id: string;
  name: string;
  createdAt: string;
  useMainProviders: boolean;
  /** Preset avatar id; see `avatars.ts`. Optional for older stored profiles. */
  avatarId?: string;
}

export interface ProfilesApi {
  profiles: AppProfile[];
  activeProfile: AppProfile;
  ready: boolean;
  selectProfile(id: string): Promise<void>;
  createProfile(name: string, useMainProviders?: boolean): Promise<AppProfile | null>;
  renameProfile(id: string, name: string): Promise<boolean>;
  setAvatar(id: string, avatarId: string): Promise<boolean>;
  setUseMainProviders(id: string, value: boolean): Promise<boolean>;
  deleteProfile(id: string): Promise<boolean>;
}

export const DEFAULT_PROFILE_ID = 'default';

export const ProfilesContext = createContext<ProfilesApi | null>(null);

export function useProfiles(): ProfilesApi {
  const value = useContext(ProfilesContext);
  if (!value) throw new Error('useProfiles must be used inside ProfilesProvider');
  return value;
}

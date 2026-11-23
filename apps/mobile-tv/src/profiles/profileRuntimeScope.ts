import { DEFAULT_PROFILE_ID } from './useProfiles';

export interface ProfileRuntimeScope {
  isMainProfile: boolean;
  profileIdentity: string | null;
  dataIdentity: string | null;
  providerIdentity: string | null;
  promoteMainData: boolean;
}

export function profileLocalIdentity(profileId: string): string | null {
  const normalized = profileId.trim();
  if (!normalized || normalized === DEFAULT_PROFILE_ID) return null;
  return `profile:${encodeURIComponent(normalized)}`;
}

export function profileRuntimeScope({
  profileId,
  useMainProviders,
  mainIdentity,
}: {
  profileId: string;
  useMainProviders: boolean;
  mainIdentity: string | null | undefined;
}): ProfileRuntimeScope {
  const normalizedMainIdentity = mainIdentity?.trim() || null;
  const isMainProfile = profileId.trim() === DEFAULT_PROFILE_ID;
  const profileIdentity = profileLocalIdentity(profileId);
  const dataIdentity = isMainProfile
    ? normalizedMainIdentity
    : profileIdentity;
  const providerIdentity = isMainProfile || useMainProviders
    ? normalizedMainIdentity
    : profileIdentity;

  return {
    isMainProfile,
    profileIdentity,
    dataIdentity,
    providerIdentity,
    promoteMainData: isMainProfile,
  };
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import { runtimeAddonSecretStore } from '../addons/addonSecretRuntime';
import { LiveTvGuideController } from './LiveTvGuideController';
import {
  LiveTvGuideRepository,
  liveTvGuideFallbackStorageKeysForUser,
  liveTvGuideStorageKeysForUser,
} from './LiveTvGuideRepository';
import { XmlTvGuideProvider } from './XmlTvGuideProvider';

export function createLiveTvGuideRuntime(
  userId: string | null | undefined,
) {
  const repository = new LiveTvGuideRepository(
    AsyncStorage,
    runtimeAddonSecretStore,
    liveTvGuideStorageKeysForUser(userId),
    liveTvGuideFallbackStorageKeysForUser(userId),
  );
  const provider = new XmlTvGuideProvider();
  const controller = new LiveTvGuideController(
    repository,
    provider,
  );

  return {
    repository,
    provider,
    controller,
  };
}

const guestRuntime = createLiveTvGuideRuntime(null);

export const liveTvGuideRepository = guestRuntime.repository;
export const liveTvGuideProvider = guestRuntime.provider;
export const liveTvGuideController = guestRuntime.controller;

type GuideChangeListener = () => void;

const guideChangeListeners = new Set<GuideChangeListener>();

export function subscribeLiveTvGuideChanges(
  listener: GuideChangeListener,
): () => void {
  guideChangeListeners.add(listener);
  return () => {
    guideChangeListeners.delete(listener);
  };
}

export function notifyLiveTvGuideChanged(): void {
  for (const listener of guideChangeListeners) listener();
}

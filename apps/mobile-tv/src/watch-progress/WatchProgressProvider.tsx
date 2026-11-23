import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AsyncStorageWatchProgressRepository, type WatchProgressRepository } from './AsyncStorageWatchProgressRepository';
import type { WatchProgressRemoteGateway } from './SupabaseWatchProgressGateway';
import { WatchProgressController } from './WatchProgressController';
import { WatchProgressContext, type WatchProgressContextValue } from './useWatchProgress';

export interface WatchProgressProviderProps {
  children: ReactNode;
  userId?: string;
  repository?: WatchProgressRepository;
  remoteGateway?: WatchProgressRemoteGateway | null;
  promoteGuestProgress?: boolean;
}

export function WatchProgressProvider({
  children,
  userId,
  repository,
  remoteGateway = null,
  promoteGuestProgress = true,
}: WatchProgressProviderProps) {
  const controller = useMemo(
    () => new WatchProgressController(
      repository ?? new AsyncStorageWatchProgressRepository(),
      remoteGateway,
      Date.now,
      promoteGuestProgress,
    ),
    [promoteGuestProgress, repository, remoteGateway],
  );
  const [snapshot, setSnapshot] = useState(controller.getSnapshot);
  const snapshotControllerRef = useRef(controller);
  const requestedUserId = userId?.trim() || null;
  const identityGenerationRef = useRef(1);
  const runtimeIdentityRef = useRef({
    userId: requestedUserId,
    controller,
  });

  if (
    runtimeIdentityRef.current.userId !== requestedUserId
    || runtimeIdentityRef.current.controller !== controller
  ) {
    runtimeIdentityRef.current = {
      userId: requestedUserId,
      controller,
    };
    identityGenerationRef.current += 1;
  }
  const renderGeneration = identityGenerationRef.current;

  useEffect(() => {
    snapshotControllerRef.current = controller;
    setSnapshot(controller.getSnapshot());

    return controller.subscribe(() => {
      snapshotControllerRef.current = controller;
      setSnapshot(controller.getSnapshot());
    });
  }, [controller]);
  useEffect(() => { void controller.restore(requestedUserId); }, [
    controller,
    requestedUserId,
  ]);

  useEffect(() => {
    const browserWindow = globalThis as typeof globalThis & {
      addEventListener?: (
        type: string,
        listener: () => void,
      ) => void;
      removeEventListener?: (
        type: string,
        listener: () => void,
      ) => void;
    };
    if (
      !requestedUserId
      || !remoteGateway
      || typeof browserWindow.addEventListener !== 'function'
      || typeof browserWindow.removeEventListener !== 'function'
    ) return undefined;

    let retrying = false;
    const retryRemoteSync = () => {
      if (
        retrying
        || controller.getSnapshot().status !== 'offline'
        || globalThis.navigator?.onLine === false
      ) return;
      retrying = true;
      void controller.restore(requestedUserId)
        .finally(() => {
          retrying = false;
        });
    };

    browserWindow.addEventListener('online', retryRemoteSync);
    browserWindow.addEventListener('focus', retryRemoteSync);
    browserWindow.addEventListener('pageshow', retryRemoteSync);
    return () => {
      browserWindow.removeEventListener('online', retryRemoteSync);
      browserWindow.removeEventListener('focus', retryRemoteSync);
      browserWindow.removeEventListener('pageshow', retryRemoteSync);
    };
  }, [controller, remoteGateway, requestedUserId]);

  const identityMatches = (
    snapshotControllerRef.current === controller
    && (snapshot.userId ?? null) === requestedUserId
  );
  const visibleSnapshot = identityMatches
    ? snapshot
    : { ...(requestedUserId === null ? {} : { userId: requestedUserId }), records: [], status: 'syncing' as const };
  const save = useCallback<WatchProgressContextValue['save']>(
    async (record) => {
      if (renderGeneration !== identityGenerationRef.current) return;
      if ((controller.getSnapshot().userId ?? null) !== requestedUserId) return;
      await controller.save(record);
    },
    [controller, renderGeneration, requestedUserId],
  );

  const restart = useCallback<WatchProgressContextValue['restart']>(
    async (record, durationSeconds) => {
      if (renderGeneration !== identityGenerationRef.current) return;
      if ((controller.getSnapshot().userId ?? null) !== requestedUserId) return;
      await controller.restart(record, durationSeconds);
    },
    [controller, renderGeneration, requestedUserId],
  );

  const markCompleted = useCallback<WatchProgressContextValue['markCompleted']>(
    async (record) => {
      if (renderGeneration !== identityGenerationRef.current) return;
      if ((controller.getSnapshot().userId ?? null) !== requestedUserId) return;
      await controller.markCompleted(record);
    },
    [controller, renderGeneration, requestedUserId],
  );

  const forget = useCallback<WatchProgressContextValue['forget']>(
    async (record) => {
      if (renderGeneration !== identityGenerationRef.current) return;
      if ((controller.getSnapshot().userId ?? null) !== requestedUserId) return;
      await controller.forget(record);
    },
    [controller, renderGeneration, requestedUserId],
  );

  const forgetAll = useCallback<WatchProgressContextValue['forgetAll']>(
    async () => {
      if (renderGeneration !== identityGenerationRef.current) return;
      if ((controller.getSnapshot().userId ?? null) !== requestedUserId) return;
      await controller.forgetAll();
    },
    [controller, renderGeneration, requestedUserId],
  );

  const value = useMemo<WatchProgressContextValue>(() => ({
    ...visibleSnapshot,
    save,
    restart,
    markCompleted,
    forget,
    forgetAll,
  }), [
    forget,
    forgetAll,
    markCompleted,
    restart,
    save,
    visibleSnapshot,
  ]);

  return <WatchProgressContext.Provider value={value}>{children}</WatchProgressContext.Provider>;
}

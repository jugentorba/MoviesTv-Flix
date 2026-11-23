import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { StreamSource } from '@moviestv/core';
import { useAccount } from '../auth/useAccount';
import { downloadSource } from '../playback/downloadSource';
import type { OfflineMediaSnapshot } from './offlineDownloadMetadata';
import { offlineDownloadScope } from './offlineDownloadScope';
import {
  DownloadManagerContext,
  type DownloadJob,
  type DownloadManagerApi,
} from './useDownloadManager';
import { safeDownloadErrorMessage } from './downloadError';

let nextJobId = 1;

const MAX_ACTIVE_DOWNLOADS = 10;
const MAX_DOWNLOAD_JOBS = 100;

function strictJobString(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > maxLength
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) return undefined;
  return normalized;
}

function boundedJobs(jobs: DownloadJob[]): DownloadJob[] {
  return jobs.length <= MAX_DOWNLOAD_JOBS
    ? jobs
    : jobs.slice(0, MAX_DOWNLOAD_JOBS);
}

export function DownloadManagerProvider({
  children,
  identityOverride,
}: {
  children: ReactNode;
  identityOverride?: string | null;
}) {
  const { userId } = useAccount();
  const scopedUserId = identityOverride === undefined
    ? userId
    : identityOverride;
  const identityKey = useMemo(() => {
    const scope = offlineDownloadScope(scopedUserId);
    return scope.type === 'guest' ? 'guest' : scope.key;
  }, [scopedUserId]);
  const identityRef = useRef(identityKey);
  identityRef.current = identityKey;

  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const activeKeysRef = useRef(new Map<string, string>());
  const cancelledJobsRef = useRef(new Set<string>());

  useEffect(() => {
    setJobs([]);
    activeKeysRef.current.clear();
    cancelledJobsRef.current.clear();
  }, [identityKey]);

  const dismiss = useCallback((jobId: string) => {
    setJobs((current) => current.some((job) => job.id === jobId && job.status === 'downloading')
      ? current
      : current.filter((job) => job.id !== jobId));
    for (const [key, value] of activeKeysRef.current.entries()) {
      if (value === jobId) activeKeysRef.current.delete(key);
    }
  }, []);

  const pause = useCallback(async (_jobId: string) => undefined, []);
  const resume = useCallback(async (_jobId: string) => undefined, []);
  const cancel = useCallback((jobId: string) => {
    const exists = jobs.some((job) => job.id === jobId && job.status === 'downloading');
    if (!exists) return;
    cancelledJobsRef.current.add(jobId);
    setJobs((current) => current.filter((job) => job.id !== jobId));
    for (const [key, value] of activeKeysRef.current.entries()) {
      if (value === jobId) activeKeysRef.current.delete(key);
    }
  }, [jobs]);

  const startDownload = useCallback(async (
    source: StreamSource,
    titleHint?: string,
    media?: OfflineMediaSnapshot,
  ): Promise<string> => {
    const requestIdentity = identityRef.current;
    const mediaId = strictJobString(media?.mediaId, 512);
    if (media?.mediaId !== undefined && !mediaId) {
      throw new Error('Invalid download media identity');
    }
    const providerId = strictJobString(source.providerId, 512);
    const quality = strictJobString(source.quality, 128);
    const normalizedTitle = (
      media?.title?.trim()
      || titleHint?.trim()
      || source.name?.trim()
      || 'MoviesTv-Flix'
    )
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 500)
      || 'MoviesTv-Flix';
    const mediaKey = mediaId
      ? `media:${mediaId}`
      : `title:${normalizedTitle}:${providerId ?? ''}:${quality ?? ''}`;
    const stableKey = `${requestIdentity}:${mediaKey}`;
    const existingJobId = activeKeysRef.current.get(stableKey);
    if (existingJobId) return existingJobId;

    if (activeKeysRef.current.size >= MAX_ACTIVE_DOWNLOADS) {
      throw new Error('Too many active downloads');
    }
    if (!source.id?.trim() || !source.url?.trim()) {
      throw new Error('Invalid download source');
    }
    const id = `browser-download-${Date.now()}-${nextJobId++}`;
    cancelledJobsRef.current.delete(id);
    const title = normalizedTitle;
    const startedAt = new Date().toISOString();
    activeKeysRef.current.set(stableKey, id);
    setJobs((current) => boundedJobs([{
      id,
      title,
      ...(mediaId ? { mediaId } : {}),
      ...(quality ? { quality } : {}),
      ...(providerId ? { providerId } : {}),
      progress: null,
      status: 'downloading',
      startedAt,
    }, ...current]));

    try {
      await downloadSource(source, undefined, titleHint, media);
      if (activeKeysRef.current.get(stableKey) === id) activeKeysRef.current.delete(stableKey);
      if (identityRef.current !== requestIdentity) {
        cancelledJobsRef.current.delete(id);
        return id;
      }
      if (cancelledJobsRef.current.delete(id)) return id;
      setJobs((current) => current.map((job) => (
        job.id === id ? { ...job, progress: 1, status: 'completed' } : job
      )));
    } catch (error) {
      if (activeKeysRef.current.get(stableKey) === id) activeKeysRef.current.delete(stableKey);
      if (identityRef.current !== requestIdentity) {
        cancelledJobsRef.current.delete(id);
        return id;
      }
      if (cancelledJobsRef.current.delete(id)) return id;
      setJobs((current) => current.map((job) => (
        job.id === id
          ? {
            ...job,
            status: 'error',
            error: safeDownloadErrorMessage(error),
          }
          : job
      )));
    }

    return id;
  }, []);

  const api = useMemo<DownloadManagerApi>(() => ({
    jobs,
    startDownload,
    pause,
    resume,
    cancel,
    dismiss,
  }), [cancel, dismiss, jobs, pause, resume, startDownload]);

  return (
    <DownloadManagerContext.Provider value={api}>
      {children}
    </DownloadManagerContext.Provider>
  );
}

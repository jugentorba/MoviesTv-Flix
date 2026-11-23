import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { StreamSource } from '@moviestv/core';
import { useAccount } from '../auth/useAccount';
import {
  cleanupStalePartialDownloads,
  startDownloadSource,
  type ControlledDownloadHandle,
} from '../playback/downloadSource';
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

function safeJobString(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return normalized
    ? normalized.slice(0, maxLength)
    : undefined;
}

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

function jobTitle(
  source: StreamSource,
  titleHint?: string,
  media?: OfflineMediaSnapshot,
): string {
  return safeJobString(
    media?.title
      ?? titleHint
      ?? source.name
      ?? 'MoviesTv-Flix',
    500,
  ) ?? 'MoviesTv-Flix';
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
  const downloadScope = useMemo(
    () => offlineDownloadScope(scopedUserId),
    [scopedUserId],
  );
  const identityKey = downloadScope.type === 'guest'
    ? 'guest'
    : downloadScope.key;
  const identityRef = useRef(identityKey);
  identityRef.current = identityKey;
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const activeKeysRef = useRef(new Map<string, string>());
  const speedRef = useRef(new Map<string, { at: number; written: number; average?: number }>());
  const handlesRef = useRef(new Map<string, ControlledDownloadHandle>());

  useEffect(() => {
    // Download jobs are identity-scoped just like their destination folder.
    // When the account changes, cancel any old in-memory work before exposing
    // the new identity so one account cannot see/control another account's
    // active jobs.
    setJobs([]);
    try {
      cleanupStalePartialDownloads(downloadScope);
    } catch {
      // Stale-file cleanup is best effort and must not block the manager.
    }

    return () => {
      const handles = [...handlesRef.current.values()];
      handlesRef.current.clear();
      activeKeysRef.current.clear();
      for (const handle of handles) {
        try {
          handle.cancel();
        } catch {
          // Best-effort cleanup while changing identity or unmounting.
        }
      }
    };
  }, [downloadScope]);

  const dismiss = useCallback((jobId: string) => {
    if (handlesRef.current.has(jobId)) return;
    setJobs((current) => current.filter((job) => job.id !== jobId));
    for (const [key, value] of activeKeysRef.current.entries()) {
      if (value === jobId) activeKeysRef.current.delete(key);
    }
  }, []);

  const startDownload = useCallback(async (
    source: StreamSource,
    titleHint?: string,
    media?: OfflineMediaSnapshot,
  ): Promise<string> => {
    const requestIdentity = identityKey;
    if (identityRef.current !== requestIdentity) {
      throw new Error('Download account changed');
    }

    const mediaId = strictJobString(media?.mediaId, 512);
    if (media?.mediaId !== undefined && !mediaId) {
      throw new Error('Invalid download media identity');
    }
    const providerId = strictJobString(source.providerId, 512);
    const quality = strictJobString(source.quality, 128);
    const mediaKey = mediaId
      ? `media:${mediaId}`
      : `title:${jobTitle(source, titleHint, media)}:${providerId ?? ''}:${quality ?? ''}`;
    const stableKey = `${requestIdentity}:${mediaKey}`;
    const existingJobId = activeKeysRef.current.get(stableKey);
    if (existingJobId) return existingJobId;

    if (handlesRef.current.size >= MAX_ACTIVE_DOWNLOADS) {
      throw new Error('Too many active downloads');
    }
    if (!source.id?.trim() || !source.url?.trim()) {
      throw new Error('Invalid download source');
    }
    const id = `download-${Date.now()}-${nextJobId++}`;
    const startedAt = new Date().toISOString();
    const title = jobTitle(source, titleHint, media);
    activeKeysRef.current.set(stableKey, id);
    setJobs((current) => boundedJobs([
      {
        id,
        title,
        ...(mediaId ? { mediaId } : {}),
        ...(quality ? { quality } : {}),
        ...(providerId ? { providerId } : {}),
        progress: null,
        status: 'downloading',
        startedAt,
      },
      ...current,
    ]));

    let handle: ControlledDownloadHandle;
    try {
      handle = startDownloadSource(
        source,
        (progress, bytes) => {
          if (activeKeysRef.current.get(stableKey) !== id) return;
          const safeProgress = typeof progress === 'number' && Number.isFinite(progress)
            ? Math.max(0, Math.min(1, progress))
            : null;
          // Speed from the delta between samples, so a slow patch does not make
          // the displayed rate jump around.
          let bytesPerSecond: number | undefined;
          if (bytes && bytes.total > 0) {
            const now = Date.now();
            const last = speedRef.current.get(id);
            if (last && now > last.at && bytes.written >= last.written) {
              const instant = ((bytes.written - last.written) * 1000) / (now - last.at);
              bytesPerSecond = last.average === undefined
                ? instant
                : last.average * 0.7 + instant * 0.3;
            }
            speedRef.current.set(id, {
              at: now,
              written: bytes.written,
              average: bytesPerSecond,
            });
          }
          setJobs((current) => current.map((job) => (
            job.id === id
              ? {
                ...job,
                progress: safeProgress,
                ...(bytes ? { bytesWritten: bytes.written, bytesTotal: bytes.total } : {}),
                ...(bytesPerSecond !== undefined ? { bytesPerSecond } : {}),
              }
              : job
          )));
        },
        titleHint,
        media,
        downloadScope,
      );
    } catch (error) {
      if (activeKeysRef.current.get(stableKey) === id) {
        activeKeysRef.current.delete(stableKey);
      }
      setJobs((current) => current.map((job) => (
        job.id === id
          ? {
            ...job,
            status: 'error',
            error: safeDownloadErrorMessage(error),
          }
          : job
      )));
      throw error;
    }
    handlesRef.current.set(id, handle);
    const actualFileName = strictJobString(handle.fileName, 255);
    if (actualFileName) {
      setJobs((current) => current.map((job) => (
        job.id === id ? { ...job, localFileName: actualFileName } : job
      )));
    }

    void handle.promise.then(() => {
      if (handlesRef.current.get(id) !== handle) return;
      handlesRef.current.delete(id);
      if (activeKeysRef.current.get(stableKey) === id) activeKeysRef.current.delete(stableKey);
      setJobs((current) => current.map((job) => (
        job.id === id
          ? { ...job, progress: 1, status: 'completed' }
          : job
      )));
    }).catch((error) => {
      if (handlesRef.current.get(id) !== handle) return;
      handlesRef.current.delete(id);
      if (activeKeysRef.current.get(stableKey) === id) activeKeysRef.current.delete(stableKey);
      setJobs((current) => current.map((job) => (
        job.id === id
          ? {
            ...job,
            status: 'error',
            error: safeDownloadErrorMessage(error),
          }
          : job
      )));
    });

    return id;
  }, [downloadScope, identityKey]);

  const pause = useCallback(async (jobId: string) => {
    const handle = handlesRef.current.get(jobId);
    if (!handle) return;
    const job = jobs.find((candidate) => candidate.id === jobId);
    if (job?.status !== 'downloading') return;
    try { await handle.pause(); } catch { return; }
    if (handlesRef.current.get(jobId) !== handle) return;
    setJobs((current) => current.map((job) => (
      job.id === jobId && job.status === 'downloading'
        ? { ...job, status: 'paused' }
        : job
    )));
  }, [jobs]);

  const resume = useCallback(async (jobId: string) => {
    const handle = handlesRef.current.get(jobId);
    if (!handle) return;
    const job = jobs.find((candidate) => candidate.id === jobId);
    if (job?.status !== 'paused') return;
    try { await handle.resume(); } catch { return; }
    if (handlesRef.current.get(jobId) !== handle) return;
    setJobs((current) => current.map((job) => (
      job.id === jobId && job.status === 'paused'
        ? { ...job, status: 'downloading' }
        : job
    )));
  }, [jobs]);

  const cancel = useCallback((jobId: string) => {
    if (!jobs.some((job) => job.id === jobId && (job.status === 'downloading' || job.status === 'paused'))) return;
    const handle = handlesRef.current.get(jobId);
    if (!handle) {
      for (const [key, value] of activeKeysRef.current.entries()) {
        if (value === jobId) activeKeysRef.current.delete(key);
      }
      setJobs((current) => current.filter((job) => job.id !== jobId));
      return;
    }
    handle.cancel();
    handlesRef.current.delete(jobId);
    for (const [key, value] of activeKeysRef.current.entries()) {
      if (value === jobId) activeKeysRef.current.delete(key);
    }
    setJobs((current) => current.filter((job) => job.id !== jobId));
  }, [jobs]);

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

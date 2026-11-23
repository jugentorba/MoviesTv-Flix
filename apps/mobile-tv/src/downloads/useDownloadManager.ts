import { createContext, useContext } from 'react';
import type { StreamSource } from '@moviestv/core';
import type { OfflineMediaSnapshot } from './offlineDownloadMetadata';

export type DownloadJobStatus = 'downloading' | 'paused' | 'completed' | 'error';

export interface DownloadJob {
  id: string;
  title: string;
  mediaId?: string;
  quality?: string;
  providerId?: string;
  localFileName?: string;
  progress: number | null;
  /** Bytes received so far, when the platform reports them. */
  bytesWritten?: number;
  /** Expected total size, when the server declares one. */
  bytesTotal?: number;
  /** Smoothed transfer rate in bytes per second. */
  bytesPerSecond?: number;
  status: DownloadJobStatus;
  error?: string;
  startedAt: string;
}

export interface DownloadManagerApi {
  jobs: readonly DownloadJob[];
  startDownload(
    source: StreamSource,
    titleHint?: string,
    media?: OfflineMediaSnapshot,
  ): Promise<string>;
  pause(jobId: string): Promise<void>;
  resume(jobId: string): Promise<void>;
  cancel(jobId: string): void;
  dismiss(jobId: string): void;
}

export const DownloadManagerContext = createContext<DownloadManagerApi | null>(null);

export function useDownloadManager(): DownloadManagerApi {
  const context = useContext(DownloadManagerContext);
  if (!context) {
    throw new Error('useDownloadManager must be used inside DownloadManagerProvider');
  }
  return context;
}

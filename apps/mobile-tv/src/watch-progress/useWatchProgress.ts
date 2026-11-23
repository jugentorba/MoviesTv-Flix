import { createContext, useContext } from 'react';
import type { WatchProgressRecord } from '@moviestv/sync';
import type {
  WatchProgressSnapshot,
} from './WatchProgressController';

export interface WatchProgressContextValue extends WatchProgressSnapshot {
  save(record: WatchProgressRecord): Promise<void>;
  restart(record: WatchProgressRecord, durationSeconds: number): Promise<void>;
  markCompleted(record: WatchProgressRecord): Promise<void>;
  /** Removes one media from this identity's history. */
  forget(record: WatchProgressRecord): Promise<void>;
  /** Removes every record for this identity. */
  forgetAll(): Promise<void>;
}

export const WatchProgressContext = createContext<WatchProgressContextValue | null>(null);

export function useWatchProgress(): WatchProgressContextValue {
  const value = useContext(WatchProgressContext);
  if (value === null) {
    throw new Error('useWatchProgress must be used inside WatchProgressProvider');
  }
  return value;
}

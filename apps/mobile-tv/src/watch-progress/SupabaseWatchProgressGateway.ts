import type { SupabaseClient } from '@supabase/supabase-js';
import type { WatchProgressRecord } from '@moviestv/sync';
import {
  MAX_WATCH_MEDIA_ID_LENGTH,
  MAX_WATCH_PROGRESS_RECORDS,
  sanitizeWatchProgressRecord,
  validWatchProgressTimestamp,
} from './watchProgressValidation';

export interface WatchProgressRemoteGateway {
  list(userId: string): Promise<WatchProgressRecord[]>;
  upsert(userId: string, record: WatchProgressRecord): Promise<void>;
  remove?(
    userId: string,
    mediaId: string,
    notNewerThan?: string,
  ): Promise<boolean | void>;
}

const selectedFields =
  'media_id,kind,title,poster_url,release_year,imdb_id,tmdb_id,series_id,season_number,episode_number,position_seconds,duration_seconds,completed,reset_at,updated_at';

export const DEFAULT_WATCH_PROGRESS_SYNC_TIMEOUT_MS = 8_000;

async function withWatchProgressSyncTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Watch progress synchronization timeout is invalid');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Watch progress synchronization timed out'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve(operation),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizedIdentity(
  value: string,
  label: 'userId' | 'mediaId',
  maxLength: number,
): string {
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > maxLength
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

export class SupabaseWatchProgressGateway
implements WatchProgressRemoteGateway {
  constructor(
    private readonly client: SupabaseClient,
    private readonly timeoutMs = DEFAULT_WATCH_PROGRESS_SYNC_TIMEOUT_MS,
  ) {}

  async list(userId: string): Promise<WatchProgressRecord[]> {
    const normalizedUserId = normalizedIdentity(
      userId,
      'userId',
      512,
    );

    const records: WatchProgressRecord[] = [];
    const pageSize = 1_000;
    for (let offset = 0; offset < MAX_WATCH_PROGRESS_RECORDS; offset += pageSize) {
      const { data, error } = await withWatchProgressSyncTimeout(
        this.client
          .from('user_watch_progress')
          .select(selectedFields)
          .eq('user_id', normalizedUserId)
          .order('updated_at', { ascending: false })
          .order('media_id', { ascending: true })
          .range(offset, Math.min(offset + pageSize, MAX_WATCH_PROGRESS_RECORDS) - 1),
        this.timeoutMs,
      );
      if (error) throw new Error(error.message);
      if (!Array.isArray(data)) break;

      for (const row of data.slice(0, pageSize)) {
        const record = sanitizeWatchProgressRecord(row);
        if (record) records.push(record);
      }
      if (data.length < pageSize) break;
    }
    return records;
  }

  async upsert(
    userId: string,
    record: WatchProgressRecord,
  ): Promise<void> {
    const normalizedUserId = normalizedIdentity(
      userId,
      'userId',
      512,
    );
    const normalized = sanitizeWatchProgressRecord(record);
    if (!normalized) {
      throw new Error('Invalid watch progress record');
    }

    const { error } = await withWatchProgressSyncTimeout(
      this.client
        .from('user_watch_progress')
        .upsert({
        user_id: normalizedUserId,
        media_id: normalized.mediaId,
        kind: normalized.kind,
        title: normalized.title,
        poster_url: normalized.posterUrl ?? null,
        release_year: normalized.year ?? null,
        imdb_id: normalized.externalIds?.imdb ?? null,
        tmdb_id: normalized.externalIds?.tmdb ?? null,
        series_id: normalized.seriesId ?? null,
        season_number: normalized.seasonNumber ?? null,
        episode_number: normalized.episodeNumber ?? null,
        position_seconds: normalized.positionSeconds,
        duration_seconds: normalized.durationSeconds,
        completed: normalized.completed,
        reset_at: normalized.resetAt ?? null,
        updated_at: normalized.updatedAt,
      }, { onConflict: 'user_id,media_id' }),
      this.timeoutMs,
    );

    if (error) throw new Error(error.message);
  }

  async remove(
    userId: string,
    mediaId: string,
    notNewerThan?: string,
  ): Promise<boolean | void> {
    const normalizedUserId = normalizedIdentity(
      userId,
      'userId',
      512,
    );
    const normalizedMediaId = normalizedIdentity(
      mediaId,
      'mediaId',
      MAX_WATCH_MEDIA_ID_LENGTH,
    );
    if (
      notNewerThan !== undefined
      && !validWatchProgressTimestamp(notNewerThan)
    ) {
      throw new Error('Watch progress removal timestamp is invalid');
    }

    let query = this.client
      .from('user_watch_progress')
      .delete()
      .eq('user_id', normalizedUserId)
      .eq('media_id', normalizedMediaId);

    if (!notNewerThan) {
      const { error } = await withWatchProgressSyncTimeout(
        query,
        this.timeoutMs,
      );
      if (error) throw new Error(error.message);
      return;
    }

    query = query.lte('updated_at', notNewerThan);
    const { data, error } = await withWatchProgressSyncTimeout(
      query.select('media_id'),
      this.timeoutMs,
    );
    if (error) throw new Error(error.message);
    return Array.isArray(data) && data.length > 0;
  }
}

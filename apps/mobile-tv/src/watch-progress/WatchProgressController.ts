import {
  dedupeWatchProgressRecords,
  sameWatchProgressMedia,
  type WatchProgressRecord,
} from '@moviestv/sync';
import type {
  WatchProgressRepository,
  WatchProgressScope,
} from './AsyncStorageWatchProgressRepository';
import type { WatchProgressRemoteGateway } from './SupabaseWatchProgressGateway';
import {
  MAX_WATCH_PROGRESS_RECORDS,
  MAX_WATCH_SECONDS,
  sanitizeWatchProgressRecord,
} from './watchProgressValidation';

export type WatchProgressStatus = 'idle' | 'syncing' | 'ready' | 'offline' | 'error';

export interface WatchProgressSnapshot {
  userId?: string;
  records: WatchProgressRecord[];
  status: WatchProgressStatus;
}

type Listener = () => void;

interface RemoteLane {
  pending?: WatchProgressRecord;
  aliases: Map<string, string>;
  /** Set when the record is deleted locally; the drain loop must stop. */
  cancelled?: boolean;
  /** Resolves when the drain loop has exited, so a delete can order after it. */
  settled?: Promise<void>;
}

function remoteLaneIdentity(record: WatchProgressRecord): string {
  const imdb = record.externalIds?.imdb?.trim().toLowerCase();
  const tmdb = record.externalIds?.tmdb?.trim();
  if (record.kind === 'episode') {
    const seriesId = record.seriesId?.trim();
    const seriesIdentity = imdb
      ? `imdb:${imdb}`
      : tmdb
        ? `tmdb:${tmdb}`
        : seriesId
          ? `series:${seriesId}`
          : `media:${record.mediaId.trim()}`;
    return `episode:${seriesIdentity}:${record.seasonNumber ?? ''}:${record.episodeNumber ?? ''}`;
  }
  if (imdb) return `movie:imdb:${imdb}`;
  if (tmdb) return `movie:tmdb:${tmdb}`;
  return `movie:media:${record.mediaId.trim()}`;
}

function scopeFor(userId: string | null): WatchProgressScope {
  const normalized = userId?.trim();
  return normalized ? { type: 'user', userId: normalized } : { type: 'guest' };
}

const MAX_DATE_MS = 8_640_000_000_000_000;

function timestampMs(value: string | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? parsed
    : Number.NEGATIVE_INFINITY;
}

function monotonicIsoTimestamp(
  candidate: string,
  previousValues: readonly (string | undefined)[],
  advanceOnEqual = true,
): string {
  const candidateMs = timestampMs(candidate);
  const previousMs = previousValues.reduce(
    (latest, value) => Math.max(latest, timestampMs(value)),
    Number.NEGATIVE_INFINITY,
  );
  const baseMs = Number.isFinite(candidateMs)
    ? candidateMs
    : Date.now();
  const shouldAdvance = Number.isFinite(previousMs)
    && (
      advanceOnEqual
        ? baseMs <= previousMs
        : baseMs < previousMs
    );
  const nextMs = shouldAdvance
    ? Math.min(previousMs + 1, MAX_DATE_MS)
    : baseMs;
  return new Date(nextMs).toISOString();
}

function reconcile(
  local: readonly WatchProgressRecord[],
  remote: readonly WatchProgressRecord[],
): WatchProgressRecord[] {
  const newest = [
    ...local,
    ...remote,
  ]
    .sort((left, right) => (
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    ))
    .slice(0, MAX_WATCH_PROGRESS_RECORDS);

  return dedupeWatchProgressRecords(newest)
    .slice(0, MAX_WATCH_PROGRESS_RECORDS);
}

export class WatchProgressController {
  private snapshot: WatchProgressSnapshot = { records: [], status: 'idle' };
  private readonly listeners = new Set<Listener>();
  private generation = 0;
  private localWrites: Promise<void> = Promise.resolve();
  private readonly remoteLanes = new Map<string, RemoteLane>();
  private remoteOfflineGeneration: number | null = null;

  constructor(
    private readonly repository: WatchProgressRepository,
    private readonly remote: WatchProgressRemoteGateway | null = null,
    private readonly now: () => number = Date.now,
    private readonly promoteGuestProgress = true,
  ) {}

  getSnapshot = (): WatchProgressSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    try { listener(); } catch { /* isolate subscriber failures */ }
    return () => {
      this.listeners.delete(listener);
    };
  };

  async restore(userId: string | null): Promise<void> {
    this.remoteLanes.clear();
    this.remoteOfflineGeneration = null;
    const normalizedUserId = userId?.trim() || null;
    userId = normalizedUserId;
    const generation = ++this.generation;
    const scope = scopeFor(userId);
    this.publish({
      ...(userId === null ? {} : { userId }),
      records: [],
      status: 'syncing',
    });

    let local: WatchProgressRecord[];
    try {
      local = (await this.repository.list(scope)).slice(0, MAX_WATCH_PROGRESS_RECORDS);
      if (generation !== this.generation) return;

      if (userId !== null && this.promoteGuestProgress) {
        const guestScope = scopeFor(null);
        const guestRecords = (await this.repository.list(guestScope)).slice(0, MAX_WATCH_PROGRESS_RECORDS);
        if (generation !== this.generation) return;

        if (guestRecords.length) {
          await this.localWrites.catch(() => undefined);
          if (generation !== this.generation) return;

          local = reconcile(local, guestRecords);
          await this.repository.replaceAll(scope, local);
          if (generation !== this.generation) return;

          await this.repository.replaceAll(guestScope, []);
          if (generation !== this.generation) return;
        }
      }
    } catch {
      if (generation === this.generation) this.setStatus('error');
      return;
    }
    if (generation !== this.generation) return;

    try {
      local = dedupeWatchProgressRecords(local).slice(0, MAX_WATCH_PROGRESS_RECORDS);
      await this.repository.replaceAll(scope, local);
    } catch {
      if (generation === this.generation) this.setStatus('error');
      return;
    }
    if (generation !== this.generation) return;

    this.publish({
      ...this.snapshot,
      records: local,
      status: 'syncing',
    });
    if (userId === null || this.remote === null) {
      this.setStatus('ready');
      return;
    }

    let remoteRecords: WatchProgressRecord[];
    try {
      remoteRecords = (await this.remote.list(userId)).slice(0, MAX_WATCH_PROGRESS_RECORDS);
    } catch {
      if (generation === this.generation) this.markRemoteOffline(generation);
      return;
    }
    if (generation !== this.generation) return;

    try {
      await this.localWrites.catch(() => undefined);
      if (generation !== this.generation) return;
      local = (await this.repository.list(scope)).slice(0, MAX_WATCH_PROGRESS_RECORDS);
      if (generation !== this.generation) return;
      const merged = reconcile(local, remoteRecords).slice(0, MAX_WATCH_PROGRESS_RECORDS);
      await this.repository.replaceAll(scope, merged);
      if (generation !== this.generation) return;

      for (let index = 0; index < merged.length; index += 25) {
        await Promise.all(
          merged.slice(index, index + 25).map((record) => this.remote!.upsert(userId, record)),
        );
      }
      if (generation !== this.generation) return;

      if (this.remote.remove) {
        const mergedIds = new Set(
          merged.map((record) => record.mediaId),
        );
        const aliases = remoteRecords.filter((remoteRecord) => (
          !mergedIds.has(remoteRecord.mediaId)
          && merged.some((record) => (
            sameWatchProgressMedia(record, remoteRecord)
          ))
        ));

        for (let index = 0; index < aliases.length; index += 25) {
          await Promise.all(aliases.slice(index, index + 25).map((alias) => (
            this.remote!.remove!(userId, alias.mediaId, alias.updatedAt)
          )));
        }
        if (generation !== this.generation) return;
      }

      this.publish({ ...this.snapshot, records: merged, status: 'ready' });
    } catch {
      if (generation === this.generation) this.markRemoteOffline(generation);
    }
  }

  async save(record: WatchProgressRecord): Promise<void> {
    const sanitized = sanitizeWatchProgressRecord(record);
    if (!sanitized) {
      throw new TypeError('Invalid watch progress record');
    }
    const previous = this.snapshot.records.find((candidate) => (
      sameWatchProgressMedia(candidate, sanitized)
    ));
    const normalizedRecord = previous
      ? {
          ...sanitized,
          updatedAt: monotonicIsoTimestamp(
            sanitized.updatedAt,
            [previous.updatedAt],
            false,
          ),
        }
      : sanitized;
    const generation = this.generation;
    const userId = this.snapshot.userId ?? null;
    const scope = scopeFor(userId);
    const operation = this.localWrites
      .catch(() => undefined)
      .then(() => this.repository.put(scope, normalizedRecord));
    this.localWrites = operation;

    try {
      await operation;
    } catch (error) {
      if (generation === this.generation) this.setStatus('error');
      throw error;
    }
    if (generation !== this.generation) return;

    const records = dedupeWatchProgressRecords([
      ...this.snapshot.records,
      normalizedRecord,
    ]).slice(0, MAX_WATCH_PROGRESS_RECORDS);
    const hasCurrentRemoteWrite = [...this.remoteLanes.keys()]
      .some((key) => key.startsWith(`${generation}:`));
    const hasUnreconciledRemoteFailure = (
      this.remoteOfflineGeneration === generation
    );
    this.publish({
      ...this.snapshot,
      records,
      status: hasUnreconciledRemoteFailure
        ? 'offline'
        : hasCurrentRemoteWrite
          ? 'syncing'
          : 'ready',
    });
    if (userId !== null && this.remote !== null) {
      this.queueRemoteWrite(
        userId,
        normalizedRecord,
        generation,
        previous,
      );
    }
  }

  async restart(record: WatchProgressRecord, durationSeconds: number): Promise<void> {
    if (
      !Number.isFinite(durationSeconds)
      || durationSeconds < 0
      || durationSeconds > MAX_WATCH_SECONDS
    ) {
      throw new TypeError('Invalid playback duration');
    }
    const previous = this.snapshot.records.find((candidate) => (
      sameWatchProgressMedia(candidate, record)
    ));
    const nowMs = this.now();
    const current = new Date(
      Number.isFinite(nowMs) ? nowMs : Date.now(),
    ).toISOString();
    const updatedAt = monotonicIsoTimestamp(
      current,
      [
        record.updatedAt,
        record.resetAt,
        previous?.updatedAt,
        previous?.resetAt,
      ],
    );
    await this.save({
      ...record,
      positionSeconds: 0,
      durationSeconds,
      completed: false,
      resetAt: updatedAt,
      updatedAt,
    });
  }

  /**
   * Deletes one record for the current identity.
   *
   * Local storage is authoritative: the delete is applied and published first,
   * then the remote row is removed best-effort. A pending upload for the same
   * media is cancelled first, otherwise the drain loop would re-create the row
   * after the delete.
   */
  async forget(record: WatchProgressRecord): Promise<void> {
    await this.removeMatching((candidate) => (
      sameWatchProgressMedia(candidate, record)
    ));
  }

  /** Deletes every record for the current identity. */
  async forgetAll(): Promise<void> {
    await this.removeMatching(() => true);
  }

  private async removeMatching(
    matches: (record: WatchProgressRecord) => boolean,
  ): Promise<void> {
    const generation = this.generation;
    const userId = this.snapshot.userId ?? null;
    const scope = scopeFor(userId);
    const removed = this.snapshot.records.filter(matches);
    if (!removed.length) return;
    const remaining = this.snapshot.records.filter((record) => !matches(record));

    const cancelledKeys = new Set<string>();
    const settledLanes: Promise<void>[] = [];
    for (const record of removed) {
      const key = `${generation}:${userId ?? ''}:${remoteLaneIdentity(record)}`;
      const lane = this.remoteLanes.get(key);
      if (!lane || lane.cancelled) continue;
      lane.cancelled = true;
      lane.pending = undefined;
      cancelledKeys.add(key);
      if (lane.settled) settledLanes.push(lane.settled);
    }

    const operation = this.localWrites
      .catch(() => undefined)
      .then(() => this.repository.replaceAll(scope, remaining));
    this.localWrites = operation;

    try {
      await operation;
    } catch (error) {
      if (generation === this.generation) this.setStatus('error');
      throw error;
    }
    if (generation !== this.generation) return;

    const hasCurrentRemoteWrite = [...this.remoteLanes.keys()].some((key) => (
      key.startsWith(`${generation}:`) && !cancelledKeys.has(key)
    ));
    this.publish({
      ...this.snapshot,
      records: remaining,
      status: this.remoteOfflineGeneration === generation
        ? 'offline'
        : hasCurrentRemoteWrite
          ? 'syncing'
          : 'ready',
    });

    // A cancelled lane may still have one upload in flight. Wait for it before
    // deleting remotely, otherwise that upload could re-create the row.
    await Promise.allSettled(settledLanes);
    if (generation !== this.generation) return;

    if (userId === null || !this.remote?.remove) {
      this.refreshStatus(generation);
      return;
    }

    const remove = this.remote.remove.bind(this.remote);
    try {
      for (let index = 0; index < removed.length; index += 25) {
        await Promise.all(
          removed.slice(index, index + 25).map((record) => (
            remove(userId, record.mediaId)
          )),
        );
      }
    } catch {
      // The local delete already happened, but the row survives remotely and
      // would come back on the next restore, so report the sync problem.
      if (generation === this.generation) this.markRemoteOffline(generation);
      return;
    }
    this.refreshStatus(generation);
  }

  async markCompleted(record: WatchProgressRecord): Promise<void> {
    if (
      !Number.isFinite(record.positionSeconds)
      || record.positionSeconds < 0
      || record.positionSeconds > MAX_WATCH_SECONDS
    ) {
      throw new TypeError('Invalid playback position');
    }
    const duration = (
      Number.isFinite(record.durationSeconds)
      && record.durationSeconds > 0
      && record.durationSeconds <= MAX_WATCH_SECONDS
    )
      ? record.durationSeconds
      : record.positionSeconds;
    const nowMs = this.now();
    const current = new Date(
      Number.isFinite(nowMs) ? nowMs : Date.now(),
    ).toISOString();
    await this.save({
      ...record,
      positionSeconds: Math.max(record.positionSeconds, duration),
      durationSeconds: duration,
      completed: true,
      updatedAt: current,
    });
  }

  private queueRemoteWrite(
    userId: string,
    record: WatchProgressRecord,
    generation: number,
    previous?: WatchProgressRecord,
  ): void {
    const requestedKey =
      `${generation}:${userId}:${remoteLaneIdentity(record)}`;
    const previousKey = previous
      ? `${generation}:${userId}:${remoteLaneIdentity(previous)}`
      : null;
    const key = this.remoteLanes.has(requestedKey)
      ? requestedKey
      : previousKey && this.remoteLanes.has(previousKey)
        ? previousKey
        : requestedKey;
    const active = this.remoteLanes.get(key);
    if (active !== undefined) {
      if (
        previous
        && previous.mediaId !== record.mediaId
      ) {
        active.aliases.set(previous.mediaId, record.updatedAt);
      }
      active.pending = record;
      return;
    }

    const lane: RemoteLane = {
      aliases: new Map(),
    };
    if (
      previous
      && previous.mediaId !== record.mediaId
    ) {
      lane.aliases.set(previous.mediaId, record.updatedAt);
    }
    this.remoteLanes.set(key, lane);
    if (this.remoteOfflineGeneration !== generation) {
      this.setStatus('syncing');
    }
    lane.settled = this.drainRemoteLane(key, lane, userId, record, generation);
  }

  private async drainRemoteLane(
    key: string,
    lane: RemoteLane,
    userId: string,
    first: WatchProgressRecord,
    generation: number,
  ): Promise<void> {
    let current: WatchProgressRecord | undefined = first;
    let lastUploaded: WatchProgressRecord | undefined;
    try {
      while (generation === this.generation && !lane.cancelled) {
        while (
          current !== undefined
          && generation === this.generation
          && !lane.cancelled
        ) {
          await this.remote!.upsert(userId, current);
          lastUploaded = current;
          current = lane.pending;
          lane.pending = undefined;
        }
        if (generation !== this.generation || lane.cancelled) break;

        if (
          lastUploaded
          && this.remote?.remove
          && lane.aliases.size
        ) {
          const aliases = [...lane.aliases.entries()];
          lane.aliases.clear();
          for (const [mediaId, notNewerThan] of aliases) {
            if (mediaId === lastUploaded.mediaId) continue;
            await this.remote.remove(
              userId,
              mediaId,
              notNewerThan,
            );
            if (generation !== this.generation) break;
          }
        }
        if (generation !== this.generation) break;

        current = lane.pending;
        lane.pending = undefined;
        if (current === undefined) break;
      }

      if (generation === this.generation && !lane.cancelled) {
        this.finishRemoteLane(key, 'ready');
      }
    } catch {
      if (generation === this.generation && !lane.cancelled) {
        this.finishRemoteLane(key, 'offline');
      }
    } finally {
      this.remoteLanes.delete(key);
      // A cancelled lane stopped early, so no finish reported a status.
      if (lane.cancelled) this.refreshStatus(generation);
    }
  }

  private refreshStatus(generation: number): void {
    if (generation !== this.generation) return;
    if (this.remoteOfflineGeneration === generation) {
      this.setStatus('offline');
      return;
    }
    const hasCurrentLane = [...this.remoteLanes.keys()]
      .some((key) => key.startsWith(`${generation}:`));
    this.setStatus(hasCurrentLane ? 'syncing' : 'ready');
  }

  private finishRemoteLane(key: string, status: 'ready' | 'offline'): void {
    if (status === 'offline') {
      this.markRemoteOffline(this.generation);
      return;
    }

    // A successful lane must not hide another failed write from this identity
    // generation. The failed record remains durable locally and will be
    // reconciled by the next restore, so keep the aggregate status offline.
    if (this.remoteOfflineGeneration === this.generation) {
      this.setStatus('offline');
      return;
    }

    const prefix = `${this.generation}:`;
    const hasAnotherCurrentLane = [...this.remoteLanes.keys()]
      .some((candidate) => candidate !== key && candidate.startsWith(prefix));
    if (!hasAnotherCurrentLane) this.setStatus('ready');
  }

  private markRemoteOffline(generation: number): void {
    if (generation !== this.generation) return;
    this.remoteOfflineGeneration = generation;
    this.setStatus('offline');
  }

  private setStatus(status: WatchProgressStatus): void {
    if (this.snapshot.status === status) return;
    this.publish({ ...this.snapshot, status });
  }

  private publish(snapshot: WatchProgressSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* isolate subscriber failures */ }
    }
  }
}

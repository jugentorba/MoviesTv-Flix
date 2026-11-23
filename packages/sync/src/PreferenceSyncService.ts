import {
  defaultUserPreferences,
  migrateUserPreferences,
  type MyListMediaItem,
  type UserPreferences,
} from '../../core/src';
import type { KeyValueStore } from '../../storage/src';
import { chooseLatest, type Timestamped } from './conflicts';

export interface TimestampedPreferences {
  appLocale: Timestamped<string>;
  preferredAudioLanguages: Timestamped<string[]>;
  preferredSubtitleLanguages: Timestamped<string[]>;
  subtitlesEnabled: Timestamped<boolean>;
  autoplay: Timestamped<boolean>;
  favoriteChannelIds: Timestamped<string[]>;
  myListItems: Timestamped<MyListMediaItem[]>;
}

export interface PreferenceRemoteStore {
  read(userId: string): Promise<TimestampedPreferences | null>;
  write(userId: string, state: TimestampedPreferences): Promise<void>;
}

const CACHE_KEY = 'user-preferences';

const EMPTY_TIMESTAMP = '1970-01-01T00:00:00.000Z';

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function fieldValue(value: unknown): unknown {
  const field = recordOf(value);
  return field && 'value' in field ? field.value : undefined;
}

function fieldTimestamp(value: unknown): string {
  const field = recordOf(value);
  const raw = field?.updatedAt;
  if (typeof raw !== 'string') return EMPTY_TIMESTAMP;
  const normalized = raw.trim();
  return normalized
    && normalized.length <= 64
    && !/[\u0000-\u001f\u007f]/.test(normalized)
    && !Number.isNaN(Date.parse(normalized))
    ? normalized
    : EMPTY_TIMESTAMP;
}

function normalizeTimestampedPreferences(
  value: unknown,
): TimestampedPreferences {
  const state = recordOf(value);
  const defaults = defaultUserPreferences();
  if (!state) {
    return {
      appLocale: {
        value: defaults.appLocale,
        updatedAt: EMPTY_TIMESTAMP,
      },
      preferredAudioLanguages: {
        value: defaults.preferredAudioLanguages,
        updatedAt: EMPTY_TIMESTAMP,
      },
      preferredSubtitleLanguages: {
        value: defaults.preferredSubtitleLanguages,
        updatedAt: EMPTY_TIMESTAMP,
      },
      subtitlesEnabled: {
        value: defaults.subtitlesEnabled,
        updatedAt: EMPTY_TIMESTAMP,
      },
      autoplay: {
        value: defaults.autoplay,
        updatedAt: EMPTY_TIMESTAMP,
      },
      favoriteChannelIds: {
        value: defaults.favoriteChannelIds,
        updatedAt: EMPTY_TIMESTAMP,
      },
      myListItems: {
        value: defaults.myListItems,
        updatedAt: EMPTY_TIMESTAMP,
      },
    };
  }

  const plain = migrateUserPreferences({
    appLocale: fieldValue(state.appLocale),
    preferredAudioLanguages:
      fieldValue(state.preferredAudioLanguages),
    preferredSubtitleLanguages:
      fieldValue(state.preferredSubtitleLanguages),
    subtitlesEnabled: fieldValue(state.subtitlesEnabled),
    autoplay: fieldValue(state.autoplay),
    favoriteChannelIds: fieldValue(state.favoriteChannelIds),
    myListItems: fieldValue(state.myListItems),
  });

  return {
    appLocale: {
      value: plain.appLocale,
      updatedAt: fieldTimestamp(state.appLocale),
    },
    preferredAudioLanguages: {
      value: plain.preferredAudioLanguages,
      updatedAt: fieldTimestamp(
        state.preferredAudioLanguages,
      ),
    },
    preferredSubtitleLanguages: {
      value: plain.preferredSubtitleLanguages,
      updatedAt: fieldTimestamp(
        state.preferredSubtitleLanguages,
      ),
    },
    subtitlesEnabled: {
      value: plain.subtitlesEnabled,
      updatedAt: fieldTimestamp(state.subtitlesEnabled),
    },
    autoplay: {
      value: plain.autoplay,
      updatedAt: fieldTimestamp(state.autoplay),
    },
    favoriteChannelIds: {
      value: plain.favoriteChannelIds,
      updatedAt: fieldTimestamp(state.favoriteChannelIds),
    },
    myListItems: {
      value: plain.myListItems,
      updatedAt: fieldTimestamp(state.myListItems),
    },
  };
}

function normalizedUserId(userId: string): string {
  const normalized = userId.trim();
  if (
    !normalized
    || normalized.length > 512
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error('Preference user id is invalid');
  }
  return normalized;
}

function plain(state: TimestampedPreferences): UserPreferences {
  return {
    appLocale: state.appLocale.value,
    preferredAudioLanguages: state.preferredAudioLanguages.value,
    preferredSubtitleLanguages: state.preferredSubtitleLanguages.value,
    subtitlesEnabled: state.subtitlesEnabled.value,
    autoplay: state.autoplay.value,
    favoriteChannelIds: state.favoriteChannelIds.value,
    myListItems: state.myListItems.value,
  };
}

function chooseRemoteOnTie<T>(
  local: Timestamped<T>,
  remote: Timestamped<T>,
): Timestamped<T> {
  return chooseLatest(remote, local);
}

function merge(local: TimestampedPreferences, remote: TimestampedPreferences): TimestampedPreferences {
  return {
    appLocale: chooseRemoteOnTie(local.appLocale, remote.appLocale),
    preferredAudioLanguages: chooseRemoteOnTie(
      local.preferredAudioLanguages,
      remote.preferredAudioLanguages,
    ),
    preferredSubtitleLanguages: chooseRemoteOnTie(
      local.preferredSubtitleLanguages,
      remote.preferredSubtitleLanguages,
    ),
    subtitlesEnabled: chooseRemoteOnTie(local.subtitlesEnabled, remote.subtitlesEnabled),
    autoplay: chooseRemoteOnTie(local.autoplay, remote.autoplay),
    favoriteChannelIds: chooseRemoteOnTie(local.favoriteChannelIds, remote.favoriteChannelIds),
    myListItems: chooseRemoteOnTie(local.myListItems, remote.myListItems),
  };
}

export class PreferenceSyncService {
  constructor(
    private readonly cache: KeyValueStore,
    private readonly remote: PreferenceRemoteStore,
    private readonly cacheKey = CACHE_KEY,
  ) {}

  async sync(
    userId: string,
    onCached?: (preferences: UserPreferences) => void,
  ): Promise<TimestampedPreferences> {
    const identity = normalizedUserId(userId);
    const cachedRaw = await this.cache.get<unknown>(this.cacheKey);
    if (cachedRaw === null) {
      throw new Error(
        'Cached preferences are required before synchronization',
      );
    }
    const cached = normalizeTimestampedPreferences(cachedRaw);
    onCached?.(plain(cached));

    const remoteRaw = await this.remote.read(identity);
    const remote = remoteRaw === null
      ? null
      : normalizeTimestampedPreferences(remoteRaw);
    const merged = remote ? merge(cached, remote) : cached;
    await this.cache.set(this.cacheKey, merged);

    const remoteNeedsRepair = (
      remoteRaw !== null
      && JSON.stringify(remoteRaw) !== JSON.stringify(remote)
    );
    if (
      !remote
      || remoteNeedsRepair
      || JSON.stringify(remote) !== JSON.stringify(merged)
    ) {
      await this.remote.write(identity, merged);

      try {
        const confirmedRaw = await this.remote.read(identity);
        if (confirmedRaw) {
          const confirmed = normalizeTimestampedPreferences(
            confirmedRaw,
          );
          const converged = merge(merged, confirmed);
          await this.cache.set(this.cacheKey, converged);

          if (
            JSON.stringify(confirmed)
            !== JSON.stringify(converged)
          ) {
            try {
              await this.remote.write(identity, converged);
            } catch {
              // Keep the locally converged state. A later sync can retry the
              // repair without losing the concurrent field edit we observed.
            }
          }

          return converged;
        }
      } catch {
        // The write already succeeded. Keep the merged local state and retry
        // reconciliation on the next sync instead of treating this as failure.
      }
    }
    return merged;
  }
}

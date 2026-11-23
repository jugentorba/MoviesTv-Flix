import type { SupabaseClient } from '@supabase/supabase-js';
import { migrateUserPreferences } from '@moviestv/core';
import type {
  PreferenceRemoteStore,
  TimestampedPreferences,
} from '@moviestv/sync';

export const DEFAULT_PREFERENCE_SYNC_TIMEOUT_MS = 8_000;

async function withPreferenceSyncTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Preference synchronization timeout is invalid');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Preference synchronization timed out'));
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

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function userIdentity(value: string): string {
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > 512
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error('Preference user id is invalid');
  }
  return normalized;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Preference row contains an invalid timestamp');
  }
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > 64
    || /[\u0000-\u001f\u007f]/.test(normalized)
    || Number.isNaN(Date.parse(normalized))
  ) {
    throw new Error('Preference row contains an invalid timestamp');
  }
  return normalized;
}

function normalizedState(
  state: TimestampedPreferences,
): TimestampedPreferences {
  const plain = migrateUserPreferences({
    appLocale: state.appLocale?.value,
    preferredAudioLanguages:
      state.preferredAudioLanguages?.value,
    preferredSubtitleLanguages:
      state.preferredSubtitleLanguages?.value,
    subtitlesEnabled: state.subtitlesEnabled?.value,
    autoplay: state.autoplay?.value,
    favoriteChannelIds: state.favoriteChannelIds?.value,
    myListItems: state.myListItems?.value,
  });

  return {
    appLocale: {
      value: plain.appLocale,
      updatedAt: timestamp(state.appLocale?.updatedAt),
    },
    preferredAudioLanguages: {
      value: plain.preferredAudioLanguages,
      updatedAt: timestamp(
        state.preferredAudioLanguages?.updatedAt,
      ),
    },
    preferredSubtitleLanguages: {
      value: plain.preferredSubtitleLanguages,
      updatedAt: timestamp(
        state.preferredSubtitleLanguages?.updatedAt,
      ),
    },
    subtitlesEnabled: {
      value: plain.subtitlesEnabled,
      updatedAt: timestamp(state.subtitlesEnabled?.updatedAt),
    },
    autoplay: {
      value: plain.autoplay,
      updatedAt: timestamp(state.autoplay?.updatedAt),
    },
    favoriteChannelIds: {
      value: plain.favoriteChannelIds,
      updatedAt: timestamp(
        state.favoriteChannelIds?.updatedAt,
      ),
    },
    myListItems: {
      value: plain.myListItems,
      updatedAt: timestamp(state.myListItems?.updatedAt),
    },
  };
}

function fromRow(value: unknown): TimestampedPreferences {
  const row = recordOf(value);
  if (!row) {
    throw new Error('Preference row is invalid');
  }

  const migrated = migrateUserPreferences({
    appLocale: row.app_locale,
    preferredAudioLanguages: row.preferred_audio_languages,
    preferredSubtitleLanguages:
      row.preferred_subtitle_languages,
    subtitlesEnabled: row.subtitles_enabled,
    autoplay: row.autoplay,
    favoriteChannelIds: row.favorite_channel_ids,
    myListItems: row.my_list_items,
  });
  const autoplayUpdatedAt = timestamp(
    row.autoplay_updated_at,
  );

  return {
    appLocale: {
      value: migrated.appLocale,
      updatedAt: timestamp(row.app_locale_updated_at),
    },
    preferredAudioLanguages: {
      value: migrated.preferredAudioLanguages,
      updatedAt: timestamp(
        row.preferred_audio_languages_updated_at,
      ),
    },
    preferredSubtitleLanguages: {
      value: migrated.preferredSubtitleLanguages,
      updatedAt: timestamp(
        row.preferred_subtitle_languages_updated_at,
      ),
    },
    subtitlesEnabled: {
      value: migrated.subtitlesEnabled,
      updatedAt: timestamp(
        row.subtitles_enabled_updated_at,
      ),
    },
    autoplay: {
      value: migrated.autoplay,
      updatedAt: autoplayUpdatedAt,
    },
    favoriteChannelIds: {
      value: migrated.favoriteChannelIds,
      updatedAt: row.favorite_channel_ids_updated_at === undefined
        || row.favorite_channel_ids_updated_at === null
        ? autoplayUpdatedAt
        : timestamp(row.favorite_channel_ids_updated_at),
    },
    myListItems: {
      value: migrated.myListItems,
      updatedAt: row.my_list_items_updated_at === undefined
        || row.my_list_items_updated_at === null
        ? autoplayUpdatedAt
        : timestamp(row.my_list_items_updated_at),
    },
  };
}

export class SupabasePreferenceRemoteStore
implements PreferenceRemoteStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly timeoutMs = DEFAULT_PREFERENCE_SYNC_TIMEOUT_MS,
  ) {}

  async read(
    userId: string,
  ): Promise<TimestampedPreferences | null> {
    const normalizedUserId = userIdentity(userId);
    const { data, error } = await withPreferenceSyncTimeout(
      this.client
        .from('user_preferences')
        .select('*')
        .eq('user_id', normalizedUserId)
        .maybeSingle(),
      this.timeoutMs,
    );

    if (error) throw error;
    if (!data) return null;
    return fromRow(data);
  }

  async write(
    userId: string,
    state: TimestampedPreferences,
  ): Promise<void> {
    const normalizedUserId = userIdentity(userId);
    const normalized = normalizedState(state);
    const { error } = await withPreferenceSyncTimeout(
      this.client
        .from('user_preferences')
        .upsert({
        user_id: normalizedUserId,
        app_locale: normalized.appLocale.value,
        app_locale_updated_at: normalized.appLocale.updatedAt,
        preferred_audio_languages:
          normalized.preferredAudioLanguages.value,
        preferred_audio_languages_updated_at:
          normalized.preferredAudioLanguages.updatedAt,
        preferred_subtitle_languages:
          normalized.preferredSubtitleLanguages.value,
        preferred_subtitle_languages_updated_at:
          normalized.preferredSubtitleLanguages.updatedAt,
        subtitles_enabled: normalized.subtitlesEnabled.value,
        subtitles_enabled_updated_at:
          normalized.subtitlesEnabled.updatedAt,
        autoplay: normalized.autoplay.value,
        autoplay_updated_at: normalized.autoplay.updatedAt,
        favorite_channel_ids:
          normalized.favoriteChannelIds.value,
        favorite_channel_ids_updated_at:
          normalized.favoriteChannelIds.updatedAt,
        my_list_items: normalized.myListItems.value,
        my_list_items_updated_at:
          normalized.myListItems.updatedAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' }),
      this.timeoutMs,
    );

    if (error) throw error;
  }
}

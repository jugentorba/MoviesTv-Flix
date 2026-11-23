/**
 * Bridge between parsed M3U playlists and the Live TV provider contract.
 *
 * A Stremio Live TV provider resolves a channel's stream by calling the add-on
 * over HTTP. An M3U entry already *is* the stream, so a playlist provider is
 * described with `kind: 'playlist'`, an empty catalog list and a
 * `directStreamUrl` on every channel. Nothing here performs I/O; loading a
 * playlist and storing it is the caller's job.
 */

import type {
  LiveTvChannel,
  LiveTvProviderDescriptor,
} from './stremio';
import type { M3uChannel } from './m3u';

export const MAX_M3U_PLAYLIST_ID_LENGTH = 64;
export const MAX_M3U_PLAYLIST_NAME_LENGTH = 120;
export const MAX_M3U_PROVIDER_CHANNELS = 5_000;

const PLAYLIST_ADDON_PREFIX = 'm3u:';
const MAX_TITLE_LENGTH = 500;
const MAX_URL_LENGTH = 2_048;

export interface M3uPlaylistIdentity {
  /** Locally generated, stable across refreshes. */
  id: string;
  name: string;
  /** Higher wins, matching `LiveTvProviderDescriptor.priority`. */
  priority: number;
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

/** Playlist ids are local, but they still come from user input. */
function cleanPlaylistId(value: unknown): string | undefined {
  const normalized = cleanText(value, MAX_M3U_PLAYLIST_ID_LENGTH);
  if (!normalized) return undefined;
  // Keep the id URL- and key-safe: it is embedded in a provider id and in
  // storage keys.
  return /^[A-Za-z0-9._-]+$/.test(normalized) ? normalized : undefined;
}

/**
 * A playable direct stream URL: http(s) only, no credentials in the authority.
 * Path credentials are kept because Xtream-style providers encode them there.
 */
function playableStreamUrl(value: unknown): string | undefined {
  const normalized = cleanText(value, MAX_URL_LENGTH);
  if (!normalized) return undefined;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username || url.password) return undefined;
  return url.href;
}

export function m3uProviderAddonId(playlistId: string): string {
  return `${PLAYLIST_ADDON_PREFIX}${playlistId}`;
}

/**
 * Describe a stored playlist as a Live TV provider.
 *
 * Returns `null` for an unusable id or name so a corrupt stored record cannot
 * become a provider that fails every load.
 */
export function m3uProviderDescriptor(
  identity: M3uPlaylistIdentity,
): LiveTvProviderDescriptor | null {
  const id = cleanPlaylistId(identity?.id);
  const name = cleanText(identity?.name, MAX_M3U_PLAYLIST_NAME_LENGTH);
  if (!id || !name) return null;
  const priority = Number.isFinite(identity.priority)
    ? Math.trunc(identity.priority)
    : 0;

  return {
    addonId: m3uProviderAddonId(id),
    name,
    // A playlist provider has no manifest and no catalog; the field exists so
    // one descriptor type serves both kinds.
    manifestUrl: '',
    priority,
    liveTv: {
      catalogs: [],
      streamTypes: ['channel'],
    },
    kind: 'playlist',
  };
}

/**
 * Map parsed M3U entries into Live TV channels owned by `provider`.
 *
 * Entries with no playable URL, no usable title or a duplicate id are dropped.
 */
export function m3uChannelsToLiveTvChannels(
  provider: LiveTvProviderDescriptor,
  channels: readonly M3uChannel[],
): LiveTvChannel[] {
  if (provider.kind !== 'playlist') return [];
  const providerId = cleanText(provider.addonId, MAX_M3U_PLAYLIST_ID_LENGTH * 4);
  if (!providerId || !providerId.startsWith(PLAYLIST_ADDON_PREFIX)) return [];
  if (!Array.isArray(channels)) return [];

  const result: LiveTvChannel[] = [];
  const seen = new Set<string>();

  for (const entry of channels) {
    if (result.length >= MAX_M3U_PROVIDER_CHANNELS) break;
    if (!entry || typeof entry !== 'object') continue;

    const streamUrl = playableStreamUrl(entry.streamUrl);
    if (!streamUrl) continue;

    // The parser derives `id` from the EPG id or the URL; fall back to the URL
    // hash so a hand-built entry cannot produce a collision with another
    // channel's empty id.
    const id = cleanText(entry.id, 512) ?? `m3u:${streamUrl}`;
    if (seen.has(id)) continue;

    const title = cleanText(entry.name, MAX_TITLE_LENGTH);
    if (!title) continue;

    seen.add(id);
    const posterUrl = cleanText(entry.logoUrl, MAX_URL_LENGTH);
    const countryCode = cleanText(entry.countryCode, 8)?.toUpperCase();
    const group = cleanText(entry.group, 128);

    result.push({
      id,
      providerId,
      remoteId: id,
      resourceType: 'channel',
      title,
      ...(posterUrl ? { posterUrl } : {}),
      ...(countryCode ? { countryCode: countryCode.slice(0, 2) } : {}),
      ...(group ? { genres: [group] } : {}),
      directStreamUrl: streamUrl,
    });
  }

  return result;
}

/** True when a channel belongs to a playlist provider and carries its own URL. */
export function isPlaylistLiveTvChannel(
  channel: LiveTvChannel | null | undefined,
): channel is LiveTvChannel & { directStreamUrl: string } {
  return Boolean(
    channel
    && typeof channel.directStreamUrl === 'string'
    && channel.directStreamUrl.length > 0,
  );
}

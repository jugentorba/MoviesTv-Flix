/**
 * M3U / M3U8 playlist parsing for Live TV.
 *
 * An IPTV playlist and a single HLS stream manifest both start with `#EXTM3U`,
 * so the two are distinguished by their tags rather than their name or MIME
 * type: `#EXT-X-*` means HLS manifest (one stream, not a channel list).
 *
 * The parser is deliberately strict and bounded. A playlist is untrusted input
 * from a user-supplied URL or file, so it is size-capped before parsing, every
 * accepted field is length- and character-checked, only `http:`/`https:` stream
 * URLs are kept, and an entry with embedded URL credentials is dropped instead
 * of being stored.
 */

export const MAX_M3U_TEXT_LENGTH = 4 * 1024 * 1024;
export const MAX_M3U_CHANNELS = 5_000;
const MAX_FIELD_LENGTH = 512;
const MAX_URL_LENGTH = 2_048;

export type M3uPlaylistKind = 'playlist' | 'hls-manifest';

export interface M3uChannel {
  /** Stable across refreshes: derived from the EPG id, else from the stream URL. */
  id: string;
  name: string;
  streamUrl: string;
  logoUrl?: string;
  group?: string;
  countryCode?: string;
  language?: string;
  epgId?: string;
}

export interface M3uPlaylist {
  kind: M3uPlaylistKind;
  channels: M3uChannel[];
  /**
   * Entries that were not turned into a channel: an invalid URL, a missing
   * name, a duplicate stream, or the `MAX_M3U_CHANNELS` bound. Large
   * playlists are common, so this is reported rather than thrown away.
   */
  skipped: number;
  /**
   * True when the playlist held more usable entries than `MAX_M3U_CHANNELS`.
   *
   * The bound protects the channel cache and the UI list on a low-end device,
   * but the user should know that their playlist was not imported in full.
   */
  truncated?: boolean;
}

export interface M3uParseResult {
  playlist: M3uPlaylist | null;
  /** Present when nothing could be parsed; safe to show to the user. */
  error?: 'empty' | 'too-large' | 'missing-header';
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Strip characters that break rendering or log parsing, then bound length. */
function cleanField(value: string, maxLength = MAX_FIELD_LENGTH): string {
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/**
 * FNV-1a. Only used to make a short, deterministic id; not a security hash.
 */
function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function isHttpUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  // Credentials in the authority would end up in storage and logs.
  if (url.username || url.password) return false;
  return true;
}

/**
 * Parse `key="value"` pairs from an `#EXTINF` line. Values may contain commas,
 * equals signs and spaces as long as they stay inside the quotes.
 */
function parseAttributes(line: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (let index = 0; index < line.length; index += 1) {
    const separator = line.indexOf('=', index);
    if (separator === -1) break;
    const key = line.slice(index, separator).trim().toLowerCase();
    const quote = line[separator + 1];
    if (quote !== '"') {
      // Unquoted value: take up to the next space.
      const end = line.indexOf(' ', separator + 1);
      const raw = line.slice(separator + 1, end === -1 ? line.length : end);
      if (key) attributes[key] = raw;
      if (end === -1) break;
      index = end;
      continue;
    }
    const end = line.indexOf('"', separator + 2);
    if (end === -1) break;
    if (key) attributes[key] = line.slice(separator + 2, end);
    index = end;
  }
  return attributes;
}

/** `#EXTINF:-1 tvg-id="a" group-title="News",Channel name` */
function displayName(line: string): string {
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') inQuotes = !inQuotes;
    else if (character === ',' && !inQuotes) return line.slice(index + 1);
  }
  return '';
}

interface Pending {
  name: string;
  attributes: Record<string, string>;
  group?: string;
}

function toChannel(pending: Pending, streamUrl: string): M3uChannel | null {
  const name = cleanField(pending.name) || cleanField(pending.attributes['tvg-name'] ?? '');
  if (!name) return null;

  const epgId = cleanField(pending.attributes['tvg-id'] ?? '');
  const logoRaw = cleanField(pending.attributes['tvg-logo'] ?? '', MAX_URL_LENGTH);
  const group = cleanField(pending.group ?? pending.attributes['group-title'] ?? '');
  const country = cleanField(pending.attributes['tvg-country'] ?? '').toUpperCase();
  const language = cleanField(pending.attributes['tvg-language'] ?? '').toLowerCase();

  const channel: M3uChannel = {
    id: epgId ? `m3u:${epgId}` : `m3u:${stableHash(streamUrl)}`,
    name,
    streamUrl,
  };
  if (logoRaw && isHttpUrl(logoRaw)) channel.logoUrl = logoRaw;
  if (group) channel.group = group;
  if (country) channel.countryCode = country.slice(0, 2);
  if (language) channel.language = language.slice(0, 16);
  if (epgId) channel.epgId = epgId;
  return channel;
}

/**
 * Parse playlist text. Returns `null` in `playlist` for unusable input so the
 * caller can show `error` without inspecting internals.
 */
export function parseM3uPlaylist(text: string): M3uParseResult {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { playlist: null, error: 'empty' };
  }
  if (text.length > MAX_M3U_TEXT_LENGTH) {
    return { playlist: null, error: 'too-large' };
  }

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const firstContentLine = lines.find((line) => line.trim().length > 0)?.trim() ?? '';
  if (!firstContentLine.startsWith('#EXTM3U')) {
    return { playlist: null, error: 'missing-header' };
  }

  const isHlsManifest = lines.some((line) => line.trim().startsWith('#EXT-X-'));
  if (isHlsManifest) {
    return { playlist: { kind: 'hls-manifest', channels: [], skipped: 0 } };
  }

  const channels: M3uChannel[] = [];
  const seenUrls = new Set<string>();
  let skipped = 0;
  let truncated = false;
  let pending: Pending | null = null;
  let pendingGroup: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      // A new entry replaces one that never received a URL.
      if (pending) skipped += 1;
      const body = line.slice('#EXTINF:'.length);
      // Drop the leading duration, keep the attribute section.
      const attributeStart = body.indexOf(' ');
      const attributeSection = attributeStart === -1 ? '' : body.slice(attributeStart + 1);
      pending = {
        name: displayName(body),
        attributes: parseAttributes(attributeSection),
        ...(pendingGroup ? { group: pendingGroup } : {}),
      };
      pendingGroup = undefined;
      continue;
    }

    if (line.startsWith('#EXTGRP:')) {
      pendingGroup = cleanField(line.slice('#EXTGRP:'.length));
      if (pending) pending.group = pendingGroup;
      continue;
    }

    if (line.startsWith('#')) continue;

    // A bare URL line ends the previous entry.
    if (!pending) {
      skipped += 1;
      continue;
    }
    const channel = isHttpUrl(line) ? toChannel(pending, line) : null;
    pending = null;
    if (!channel || seenUrls.has(channel.streamUrl)) {
      skipped += 1;
      continue;
    }
    if (channels.length >= MAX_M3U_CHANNELS) {
      skipped += 1;
      truncated = true;
      continue;
    }
    seenUrls.add(channel.streamUrl);
    channels.push(channel);
  }

  if (pending) skipped += 1;
  return { playlist: { kind: 'playlist', channels, skipped, truncated } };
}

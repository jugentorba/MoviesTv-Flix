import { stableTextCompare } from '@moviestv/core';
import type {
  LiveTvChannel,
  LiveTvProviderDescriptor,
} from '@moviestv/live-tv';

export interface LiveTvChannelVariant {
  provider: LiveTvProviderDescriptor;
  channel: LiveTvChannel;
}

export interface LiveTvBrowserChannel extends LiveTvChannel {
  variants: LiveTvChannelVariant[];
}

export interface LoadedLiveTvProvider {
  provider: LiveTvProviderDescriptor;
  channels: LiveTvChannel[];
}

const MAX_LIVE_TV_PROVIDERS = 100;
const MAX_CHANNELS_PER_LOADED_PROVIDER = 20_000;
const MAX_LOGICAL_LIVE_TV_CHANNELS = 30_000;
const MAX_LIVE_TV_FAVORITE_KEY_LENGTH = 512;

function fnv1a(value: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function compactFavoriteIdentity(value: string): string {
  const first = fnv1a(value).toString(36);
  const second = fnv1a(value, 0x9e3779b9).toString(36);
  return `${first}-${second}-${value.length.toString(36)}`;
}

export function normalizedLiveTvChannelTitle(value: string): string {
  return value
    .slice(0, 500)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizedCountryCode(value: string | undefined): string {
  const normalized = value?.trim().toUpperCase();
  if (!normalized || !/^[A-Z]{2}$/.test(normalized)) return '--';
  if (normalized === 'UK') return 'GB';
  if (normalized === 'KS' || normalized === 'KV') return 'XK';
  return normalized;
}

function mergedVariantGenres(
  variants: readonly LiveTvChannelVariant[],
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const variant of variants) {
    for (const rawGenre of variant.channel.genres ?? []) {
      const genre = rawGenre.trim();
      if (!genre) continue;
      const key = genre.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(genre);
      if (result.length >= 20) return result;
    }
  }

  return result;
}

function safeAggregatedArtwork(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const sensitive =
      /token|key|secret|auth|signature|session|credential/i;
    const hasSensitiveQuery = [...url.searchParams.entries()].some(
      ([key, queryValue]) => (
        sensitive.test(key)
        || sensitive.test(queryValue)
      ),
    );
    let fragment = url.hash.slice(1);
    let pathname: string;
    try {
      fragment = decodeURIComponent(fragment);
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return undefined;
    }
    const credentialSegment =
      /^(?:access[-_]?token|auth[-_]?token|api[-_]?key|apikey|key|token|password|passwd|secret|signature|sig|credential|session|debrid|alldebrid|realdebrid)(?:=|:).+/i;
    const hasSensitivePath = pathname
      .split('/')
      .some((segment) => credentialSegment.test(segment));

    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || hasSensitiveQuery
      || sensitive.test(fragment)
      || hasSensitivePath
      || url.href.length > 2_048
    ) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function aggregationKey(channel: LiveTvChannel): string {
  return normalizedCountryCode(channel.countryCode)
    + '\\u0000'
    + normalizedLiveTvChannelTitle(channel.title);
}

export function liveTvFavoriteKey(channel: LiveTvChannel): string {
  const country = normalizedCountryCode(channel.countryCode);
  const encodedCountry = encodeURIComponent(country);
  const title = normalizedLiveTvChannelTitle(channel.title);

  if (!title) {
    const id = channel.id?.trim() ?? '';
    const direct =
      `live-tv-favorite:${encodedCountry}:id:${encodeURIComponent(id)}`;
    return direct.length <= MAX_LIVE_TV_FAVORITE_KEY_LENGTH
      ? direct
      : `live-tv-favorite:${encodedCountry}:id-hash:${compactFavoriteIdentity(id)}`;
  }

  const direct =
    `live-tv-favorite:${encodedCountry}:${encodeURIComponent(title)}`;
  return direct.length <= MAX_LIVE_TV_FAVORITE_KEY_LENGTH
    ? direct
    : `live-tv-favorite:${encodedCountry}:hash:${compactFavoriteIdentity(title)}`;
}

export function aggregateLiveTvChannels(
  providers: readonly LoadedLiveTvProvider[],
): LiveTvBrowserChannel[] {
  const groups = new Map<string, LiveTvChannelVariant[]>();
  const prioritizedProviders = providers
    .filter((loaded) => Boolean(loaded?.provider?.addonId?.trim()))
    .slice()
    .sort((left, right) => (
      right.provider.priority - left.provider.priority
      || stableTextCompare(left.provider.addonId, right.provider.addonId)
    ))
    .slice(0, MAX_LIVE_TV_PROVIDERS);

  for (const loaded of prioritizedProviders) {
    for (
      const channel
      of loaded.channels.slice(0, MAX_CHANNELS_PER_LOADED_PROVIDER)
    ) {
      const titleKey = normalizedLiveTvChannelTitle(channel.title);
      if (
        !titleKey
        || !channel.id?.trim()
        || !channel.remoteId?.trim()
        || channel.providerId !== loaded.provider.addonId
      ) continue;
      const key = aggregationKey(channel);
      const existing = groups.get(key);
      if (!existing && groups.size >= MAX_LOGICAL_LIVE_TV_CHANNELS) {
        continue;
      }
      const group = existing ?? [];
      const duplicate = group.some((variant) => (
        variant.provider.addonId === loaded.provider.addonId
        && variant.channel.remoteId === channel.remoteId
        && variant.channel.resourceType === channel.resourceType
      ));
      if (duplicate) continue;
      group.push({ provider: loaded.provider, channel });
      groups.set(key, group);
    }
  }

  // A provider can omit country metadata for a channel that another provider
  // identifies correctly. Merge that unknown-country group only when the same
  // normalized title maps to exactly one known country. If the title exists in
  // multiple countries, keep the unknown group separate to avoid combining
  // unrelated stations that happen to share a generic name.
  const knownGroupsByTitle = new Map<string, string[]>();
  for (const key of groups.keys()) {
    const separator = key.indexOf('\\u0000');
    if (separator < 0) continue;
    const country = key.slice(0, separator);
    const title = key.slice(separator + '\\u0000'.length);
    if (country === '--' || !title) continue;
    const keys = knownGroupsByTitle.get(title) ?? [];
    keys.push(key);
    knownGroupsByTitle.set(title, keys);
  }

  for (const [key, unknownVariants] of [...groups.entries()]) {
    if (!key.startsWith('--\\u0000')) continue;
    const title = key.slice('--\\u0000'.length);
    const knownKeys = knownGroupsByTitle.get(title) ?? [];
    if (knownKeys.length !== 1) continue;
    const knownGroup = groups.get(knownKeys[0]!);
    if (!knownGroup) continue;
    for (const variant of unknownVariants) {
      const duplicate = knownGroup.some((existing) => (
        existing.provider.addonId === variant.provider.addonId
        && existing.channel.remoteId === variant.channel.remoteId
        && existing.channel.resourceType === variant.channel.resourceType
      ));
      if (!duplicate) knownGroup.push(variant);
    }
    groups.delete(key);
  }

  const channels: LiveTvBrowserChannel[] = [];
  for (const variants of groups.values()) {
    variants.sort((left, right) =>
      right.provider.priority - left.provider.priority
      || stableTextCompare(left.provider.addonId, right.provider.addonId),
    );

    const primary = variants[0];
    if (!primary) continue;
    const posterUrl = variants
      .map((item) => safeAggregatedArtwork(item.channel.posterUrl))
      .find((value): value is string => Boolean(value));
    const genres = mergedVariantGenres(variants);
    const normalizedCountry = variants
      .map((item) => normalizedCountryCode(item.channel.countryCode))
      .find((country) => country !== '--')
      ?? '--';

    channels.push({
      id: primary.channel.id,
      providerId: primary.channel.providerId,
      remoteId: primary.channel.remoteId,
      resourceType: primary.channel.resourceType,
      title: primary.channel.title,
      ...(normalizedCountry !== '--'
        ? { countryCode: normalizedCountry }
        : {}),
      ...(posterUrl ? { posterUrl } : {}),
      ...(genres.length ? { genres } : {}),
      variants,
    });
  }

  return channels.sort((left, right) => (
    stableTextCompare(
      normalizedLiveTvChannelTitle(left.title),
      normalizedLiveTvChannelTitle(right.title),
    )
    || stableTextCompare(left.title, right.title)
    || stableTextCompare(
      left.countryCode ?? '',
      right.countryCode ?? '',
    )
  ));
}

export function isLiveTvBrowserChannel(
  channel: LiveTvChannel,
): channel is LiveTvBrowserChannel {
  return Array.isArray(
    (channel as LiveTvBrowserChannel).variants,
  );
}

import { stableTextCompare } from '@moviestv/core';
import type { LiveTvChannel } from '@moviestv/live-tv';

const PREFERRED_COUNTRIES = ['AL', 'XK', 'FR'] as const;

const COUNTRY_FALLBACKS: Record<string, Record<string, string>> = {
  AL: { fr: 'Albanie', en: 'Albania', sq: 'Shqipëri' },
  FR: { fr: 'France', en: 'France', sq: 'Francë' },
  XK: { fr: 'Kosovo', en: 'Kosovo', sq: 'Kosovë' },
};

function normalizeCountryCode(value: string | undefined | null): string | null {
  const code = value?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code)) return null;
  if (code === 'UK') return 'GB';
  if (code === 'KS' || code === 'KV') return 'XK';
  return code;
}

function normalizeSearch(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function liveTvCountryLabel(countryCode: string, locale: string): string {
  const normalized = normalizeCountryCode(countryCode)
    ?? countryCode.trim().toUpperCase();
  const language = locale.toLowerCase().split('-')[0] ?? 'en';
  const fallback = COUNTRY_FALLBACKS[normalized]?.[language]
    ?? COUNTRY_FALLBACKS[normalized]?.en
    ?? normalized;

  try {
    const DisplayNamesImpl = (Intl as typeof Intl & {
      DisplayNames?: new (locales?: string | string[], options?: { type: 'region' }) => { of(code: string): string | undefined };
    }).DisplayNames;
    const display = DisplayNamesImpl
      ? new DisplayNamesImpl([locale], { type: 'region' }).of(normalized)
      : undefined;
    return display && display !== normalized ? display : fallback;
  } catch {
    return fallback;
  }
}

export function availableLiveTvCountries(channels: readonly LiveTvChannel[]): string[] {
  const codes = new Set(
    channels
      .map((channel) => normalizeCountryCode(channel.countryCode))
      .filter((code): code is string => Boolean(code)),
  );
  return [...codes].sort((left, right) => {
    const leftIndex = PREFERRED_COUNTRIES.indexOf(left as (typeof PREFERRED_COUNTRIES)[number]);
    const rightIndex = PREFERRED_COUNTRIES.indexOf(right as (typeof PREFERRED_COUNTRIES)[number]);
    if (leftIndex >= 0 || rightIndex >= 0) {
      if (leftIndex < 0) return 1;
      if (rightIndex < 0) return -1;
      return leftIndex - rightIndex;
    }
    return stableTextCompare(left, right);
  });
}

function compareCountryPriority(
  leftCountry: string | undefined | null,
  rightCountry: string | undefined | null,
): number {
  const left = normalizeCountryCode(leftCountry);
  const right = normalizeCountryCode(rightCountry);
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  const leftIndex = PREFERRED_COUNTRIES.indexOf(
    left as (typeof PREFERRED_COUNTRIES)[number],
  );
  const rightIndex = PREFERRED_COUNTRIES.indexOf(
    right as (typeof PREFERRED_COUNTRIES)[number],
  );
  if (leftIndex >= 0 || rightIndex >= 0) {
    if (leftIndex < 0) return 1;
    if (rightIndex < 0) return -1;
    return leftIndex - rightIndex;
  }
  return stableTextCompare(left, right);
}

export function buildLiveTvView<T extends LiveTvChannel>(
  channels: readonly T[],
  query: string,
  countryCode: string | null,
): T[] {
  const normalizedQuery = normalizeSearch(query).slice(0, 200);
  const normalizedCountry = normalizeCountryCode(countryCode);
  return channels
    .filter((channel) => (
      normalizedCountry === null
      || normalizeCountryCode(channel.countryCode) === normalizedCountry
    ))
    .filter((channel) => !normalizedQuery || [
      channel.title,
      channel.countryCode ?? '',
      channel.providerId,
      ...(channel.genres ?? []),
    ].some((value) => normalizeSearch(value).includes(normalizedQuery)))
    .slice()
    .sort((left, right) => (
      (normalizedCountry === null
        ? compareCountryPriority(left.countryCode, right.countryCode)
        : 0)
      || stableTextCompare(normalizeSearch(left.title), normalizeSearch(right.title))
      || stableTextCompare(left.title, right.title)
    ));
}

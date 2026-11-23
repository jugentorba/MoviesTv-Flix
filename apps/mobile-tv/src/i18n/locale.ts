import { languageDirection } from '@moviestv/core';
import type { LayoutDirection } from './types';

function canonicalize(locale: string): string | null {
  const cleaned = locale.trim().replaceAll('_', '-');
  if (!cleaned) return null;
  try {
    return Intl.getCanonicalLocales(cleaned)[0] ?? null;
  } catch {
    return null;
  }
}

function supportedLookup(supported: readonly string[]): Map<string, string> {
  return new Map(supported.map((locale) => [locale.toLowerCase(), locale]));
}

export function resolveAppLocale(
  requestedLocale: string,
  supported: readonly string[],
): string {
  const lookup = supportedLookup(supported);
  const canonical = canonicalize(requestedLocale);
  if (!canonical) return lookup.get('en') ?? 'en';

  const parts = canonical.split('-');
  const base = parts[0].toLowerCase();
  if (base === 'zh') {
    const script = parts.find((part) => part === 'Hans' || part === 'Hant');
    const region = parts.find((part) => /^[A-Z]{2}$/.test(part));
    const desired = script === 'Hant' || ['TW', 'HK', 'MO'].includes(region ?? '')
      ? 'zh-Hant'
      : 'zh-Hans';
    const matchedChinese = lookup.get(desired.toLowerCase());
    if (matchedChinese) return matchedChinese;
  }

  const exact = lookup.get(canonical.toLowerCase());
  if (exact) return exact;

  for (let length = parts.length - 1; length >= 1; length -= 1) {
    const parent = parts.slice(0, length).join('-').toLowerCase();
    const matched = lookup.get(parent);
    if (matched) return matched;
  }

  return lookup.get('en') ?? 'en';
}

export function directionForLocale(locale: string): LayoutDirection {
  return languageDirection(locale);
}

export function runtimeDeviceLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en';
  } catch {
    return 'en';
  }
}

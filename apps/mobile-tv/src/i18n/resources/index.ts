import type { AppTranslationResource, TranslationTree } from '../types';
import { ASIA_PACKS } from './asia';
import { EPISODE_PACKS, EPISODE_RESOURCE_KEYS } from './episodes';
import { EUROPE_PACKS } from './europe';
import { FUNCTIONAL_PACKS, FUNCTIONAL_RESOURCE_KEYS } from './functional';
import { PLAYBACK_PACKS, PLAYBACK_RESOURCE_KEYS } from './playback';
import { SEARCH_PAGINATION_PACKS, SEARCH_PAGINATION_RESOURCE_KEYS } from './search-pagination';
import { LIVE_TV_PACKS, LIVE_TV_RESOURCE_KEYS } from './live-tv';
import { SCREEN_PACKS, SCREEN_RESOURCE_KEYS } from './screens';
import { RTL_SOUTH_PACKS } from './rtl-south';
import { WESTERN_PACKS } from './western';

export const SUPPORTED_APP_LOCALES = [
  'en', 'sq', 'fr', 'de', 'it', 'es', 'pt-BR', 'pt-PT', 'tr', 'nl', 'pl', 'ro',
  'cs', 'sk', 'hu', 'sv', 'da', 'fi', 'no', 'el', 'bg', 'hr', 'bs', 'sr-Latn',
  'sl', 'mk', 'ru', 'uk', 'ar', 'he', 'fa', 'hi', 'bn', 'ur', 'id', 'ms', 'vi',
  'th', 'zh-Hans', 'zh-Hant', 'ja', 'ko',
] as const;

export type AppLocale = (typeof SUPPORTED_APP_LOCALES)[number];

const PACK_VALUES: Record<string, readonly string[]> = {
  ...WESTERN_PACKS,
  ...EUROPE_PACKS,
  ...RTL_SOUTH_PACKS,
  ...ASIA_PACKS,
};

const RESOURCE_KEYS = [
  'nav.home', 'nav.movies', 'nav.series', 'nav.liveTv', 'nav.search', 'nav.settings',
  'settings.title', 'settings.appLanguage', 'settings.audioLanguages',
  'settings.subtitleLanguages', 'settings.followDevice', 'settings.subtitlesEnabled',
  'settings.moveUp', 'settings.moveDown', 'settings.remove', 'settings.languageSearch',
  'common.back', 'common.retry', 'common.loading', 'common.save', 'common.cancel',
  'auth.email', 'auth.password', 'auth.signIn', 'auth.backendNotConfigured',
] as const;

function setPath(tree: TranslationTree, path: string, value: string): void {
  const parts = path.split('.');
  let current = tree;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (typeof existing === 'object' && existing !== null) {
      current = existing;
    } else {
      const child: TranslationTree = {};
      current[part] = child;
      current = child;
    }
  }
  current[parts.at(-1)!] = value;
}

function setPack(
  resource: TranslationTree,
  locale: AppLocale,
  keys: readonly string[],
  values: readonly string[] | undefined,
  packName: string,
): void {
  if (!values || values.length !== keys.length) {
    throw new Error(`Incomplete ${packName} translation pack: ${locale}`);
  }
  keys.forEach((key, index) => setPath(resource, key, values[index]));
}

function buildResource(locale: AppLocale): AppTranslationResource {
  const resource: TranslationTree = {};
  setPack(resource, locale, RESOURCE_KEYS, PACK_VALUES[locale], 'base');
  setPack(resource, locale, FUNCTIONAL_RESOURCE_KEYS, FUNCTIONAL_PACKS[locale], 'functional');
  setPack(resource, locale, PLAYBACK_RESOURCE_KEYS, PLAYBACK_PACKS[locale], 'playback');
  setPack(resource, locale, SEARCH_PAGINATION_RESOURCE_KEYS, SEARCH_PAGINATION_PACKS[locale] ?? SEARCH_PAGINATION_PACKS.en, 'search-pagination');
  setPack(resource, locale, EPISODE_RESOURCE_KEYS, EPISODE_PACKS[locale] ?? EPISODE_PACKS.en, 'episodes');
  setPack(resource, locale, LIVE_TV_RESOURCE_KEYS, LIVE_TV_PACKS[locale] ?? LIVE_TV_PACKS.en, 'live-tv');
  setPack(resource, locale, SCREEN_RESOURCE_KEYS, SCREEN_PACKS[locale] ?? SCREEN_PACKS.en, 'screens');
  return resource as AppTranslationResource;
}

export const APP_RESOURCES = Object.fromEntries(
  SUPPORTED_APP_LOCALES.map((locale) => [locale, buildResource(locale)]),
) as Record<AppLocale, AppTranslationResource>;

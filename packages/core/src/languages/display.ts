import { LANGUAGE_DEFINITIONS, type LanguageDefinition } from './language-data';
import { normalizeLanguageTag } from './normalize';

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase();
}

function definitionFor(tag: string): LanguageDefinition | undefined {
  const normalized = normalizeLanguageTag(tag);
  if (!normalized) return undefined;
  const base = normalized.split('-')[0].toLowerCase();
  return LANGUAGE_DEFINITIONS.find((language) => language.canonicalTag === base);
}

export function displayLanguageName(tag: string, locale: string): string {
  const normalized = normalizeLanguageTag(tag) ?? tag.trim();
  if (!normalized) return tag;

  try {
    const displayNames = new Intl.DisplayNames([locale], { type: 'language' });
    const label = displayNames.of(normalized);
    if (label) return label;
  } catch {
    // Runtime or locale may not support Intl.DisplayNames; use checked-in metadata below.
  }

  const definition = definitionFor(normalized);
  return definition?.nativeName ?? definition?.englishName ?? normalized;
}

export function searchLanguages(query: string, locale: string): LanguageDefinition[] {
  const needle = fold(query.trim());
  if (!needle) return [...LANGUAGE_DEFINITIONS];

  return LANGUAGE_DEFINITIONS.filter((language) => {
    const values = [
      displayLanguageName(language.canonicalTag, locale),
      language.englishName,
      language.nativeName ?? '',
      ...language.aliases,
    ];
    return values.some((value) => fold(value).includes(needle));
  });
}

import { LANGUAGE_DEFINITIONS } from './language-data';

const ALIAS_TO_CANONICAL = new Map<string, string>();

for (const language of LANGUAGE_DEFINITIONS) {
  for (const alias of [
    language.canonicalTag,
    language.iso6391,
    ...language.iso6392,
    ...language.aliases,
    language.englishName,
    language.nativeName,
  ]) {
    if (alias) ALIAS_TO_CANONICAL.set(alias.trim().toLowerCase(), language.canonicalTag);
  }
}

export function normalizeLanguageTag(input: string): string | null {
  const cleaned = input.trim().replaceAll('_', '-');
  if (!cleaned) return null;

  const directAlias = ALIAS_TO_CANONICAL.get(cleaned.toLowerCase());
  if (directAlias) return directAlias;

  const [rawBase, ...rest] = cleaned.split('-');
  const normalizedBase = ALIAS_TO_CANONICAL.get(rawBase.toLowerCase()) ?? rawBase;
  const candidate = [normalizedBase, ...rest].join('-');

  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? null;
  } catch {
    return null;
  }
}

export function languageDirection(tag: string): 'ltr' | 'rtl' {
  const normalized = normalizeLanguageTag(tag);
  if (!normalized) return 'ltr';
  const base = normalized.split('-')[0].toLowerCase();
  return LANGUAGE_DEFINITIONS.find((language) => language.canonicalTag === base)?.direction ?? 'ltr';
}

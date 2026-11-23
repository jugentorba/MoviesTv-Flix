import type { TranslationNode, TranslationParams, TranslationTree } from './types';

/** Substitutes `{name}` tokens; an absent value leaves the token visible. */
export function interpolateTranslation(
  template: string,
  params?: TranslationParams,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export function translationAt(
  tree: TranslationTree,
  key: string,
): string | undefined {
  let current: TranslationNode = tree;
  for (const part of key.split('.')) {
    if (typeof current === 'string') return undefined;
    const next: TranslationNode | undefined = current[part];
    if (next === undefined) return undefined;
    current = next;
  }
  return typeof current === 'string' ? current : undefined;
}

/**
 * Resolves `key` in `resource`, then in `english`, then falls back to the key
 * itself, and finally substitutes `{name}` tokens.
 */
export function translateFrom(
  resource: TranslationTree,
  english: TranslationTree,
  key: string,
  params?: TranslationParams,
): string {
  const template = translationAt(resource, key)
    ?? translationAt(english, key)
    ?? key;
  return interpolateTranslation(template, params);
}

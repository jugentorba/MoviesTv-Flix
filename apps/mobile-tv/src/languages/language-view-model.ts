import {
  searchLanguages,
  type LanguageDefinition,
} from '@moviestv/core';

export function moveLanguage(
  languages: string[],
  tag: string,
  offset: -1 | 1,
): string[] {
  const index = languages.indexOf(tag);
  if (index < 0) return languages;
  const target = index + offset;
  if (target < 0 || target >= languages.length) return languages;

  const next = [...languages];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function addLanguage(languages: string[], tag: string): string[] {
  return languages.includes(tag) ? languages : [...languages, tag];
}

export function removeLanguage(languages: string[], tag: string): string[] {
  return languages.filter((language) => language !== tag);
}

export function filterLanguages(query: string, locale: string): LanguageDefinition[] {
  return searchLanguages(query, locale);
}

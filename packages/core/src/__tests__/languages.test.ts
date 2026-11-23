import {
  LANGUAGE_DEFINITIONS,
  languageDirection,
  normalizeLanguageTag,
} from '../languages';

test('ships the complete ISO 639-1 catalog', () => {
  expect(LANGUAGE_DEFINITIONS.length).toBeGreaterThanOrEqual(180);
  expect(LANGUAGE_DEFINITIONS.some((language) => language.canonicalTag === 'sq')).toBe(true);
  expect(LANGUAGE_DEFINITIONS.some((language) => language.canonicalTag === 'zh')).toBe(true);
});

test.each([
  ['EN', 'en'],
  ['eng', 'en'],
  ['fre', 'fr'],
  ['fra', 'fr'],
  ['alb', 'sq'],
  ['sqi', 'sq'],
  ['chi', 'zh'],
  ['zho', 'zh'],
  ['pt_BR', 'pt-BR'],
  ['zh-hant', 'zh-Hant'],
])('normalizes %s to %s', (input, expected) => {
  expect(normalizeLanguageTag(input)).toBe(expected);
});

test('marks RTL languages', () => {
  expect(languageDirection('ar')).toBe('rtl');
  expect(languageDirection('he')).toBe('rtl');
  expect(languageDirection('en')).toBe('ltr');
});

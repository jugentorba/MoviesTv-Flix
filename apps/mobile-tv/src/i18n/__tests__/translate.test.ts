import {
  interpolateTranslation,
  translationAt,
  translateFrom,
} from '../translate';
import type { TranslationTree } from '../types';

const english: TranslationTree = {
  greet: 'Hello {name}',
  onlyEnglish: 'English only',
  nested: { deep: 'Nested value' },
};

const french: TranslationTree = {
  greet: 'Bonjour {name}',
  nested: {},
};

describe('interpolateTranslation', () => {
  test('substitutes every placeholder', () => {
    expect(interpolateTranslation('{a} of {b}', { a: 1, b: 2 })).toBe('1 of 2');
  });

  test('leaves a placeholder visible when its value is missing', () => {
    expect(interpolateTranslation('Hello {name}', {})).toBe('Hello {name}');
  });

  test('returns the template untouched without params', () => {
    expect(interpolateTranslation('Hello {name}')).toBe('Hello {name}');
  });
});

describe('translationAt', () => {
  test('walks dotted keys and ignores sections', () => {
    expect(translationAt(english, 'nested.deep')).toBe('Nested value');
    expect(translationAt(english, 'nested')).toBeUndefined();
    expect(translationAt(english, 'nested.missing')).toBeUndefined();
  });
});

describe('translateFrom', () => {
  test('prefers the locale resource', () => {
    expect(translateFrom(french, english, 'greet', { name: 'Ada' }))
      .toBe('Bonjour Ada');
  });

  test('falls back to English, then to the key', () => {
    expect(translateFrom(french, english, 'onlyEnglish')).toBe('English only');
    expect(translateFrom(french, english, 'missing.key')).toBe('missing.key');
  });

  test('falls back when the locale section exists but the leaf does not', () => {
    expect(translateFrom(french, english, 'nested.deep')).toBe('Nested value');
  });
});

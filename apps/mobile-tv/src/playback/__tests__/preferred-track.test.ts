import { preferredLanguageTrackIndex } from '../preferredTrack';

test('selects the first configured preferred language regardless of track order', () => {
  expect(preferredLanguageTrackIndex(
    [{ language: 'de' }, { language: 'fr-FR' }, { language: 'en' }],
    ['en', 'fr', 'de'],
  )).toBe(2);
});

test('matches language aliases and base tags', () => {
  expect(preferredLanguageTrackIndex(
    [{ language: 'fra' }, { language: 'de-DE' }],
    ['fr-CA'],
  )).toBe(0);
});

test('falls back to the first track with a declared language', () => {
  expect(preferredLanguageTrackIndex(
    [{ language: undefined }, { language: 'it' }, { language: 'es' }],
    ['sq'],
  )).toBe(1);
});


test('ignores blank preferences and trims language tags', () => {
  expect(preferredLanguageTrackIndex(
    [{ language: ' de ' }, { language: ' en-US ' }],
    [' ', ' en '],
  )).toBe(1);
});

test('ignores blank track language when choosing fallback', () => {
  expect(preferredLanguageTrackIndex(
    [{ language: '   ' }, { language: 'it' }],
    ['sq'],
  )).toBe(1);
});

test('matches common English French and German ISO-639-2 media track labels', () => {
  expect(preferredLanguageTrackIndex(
    [
      { language: 'ger' },
      { language: 'fre' },
      { language: 'eng' },
    ],
    ['en', 'fr', 'de'],
  )).toBe(2);

  expect(preferredLanguageTrackIndex(
    [
      { language: 'eng' },
      { language: 'deu' },
      { language: 'fra' },
    ],
    ['fr', 'de', 'en'],
  )).toBe(2);
});


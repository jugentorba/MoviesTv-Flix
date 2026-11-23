import {
  addLanguage,
  filterLanguages,
  moveLanguage,
  removeLanguage,
} from '../language-view-model';

test('moves a selected language one position at a time', () => {
  expect(moveLanguage(['sq', 'fr', 'en'], 'en', -1)).toEqual(['sq', 'en', 'fr']);
  expect(moveLanguage(['sq', 'fr', 'en'], 'sq', -1)).toEqual(['sq', 'fr', 'en']);
  expect(moveLanguage(['sq', 'fr', 'en'], 'en', 1)).toEqual(['sq', 'fr', 'en']);
});

test('adds a language once and removes it without disturbing order', () => {
  expect(addLanguage(['sq', 'fr'], 'sq')).toEqual(['sq', 'fr']);
  expect(addLanguage(['sq', 'fr'], 'en')).toEqual(['sq', 'fr', 'en']);
  expect(removeLanguage(['sq', 'fr', 'en'], 'fr')).toEqual(['sq', 'en']);
});

test('searches by language aliases as well as names', () => {
  expect(filterLanguages('alb', 'en').some((language) => language.canonicalTag === 'sq')).toBe(true);
  expect(filterLanguages('chinese', 'en').some((language) => language.canonicalTag === 'zh')).toBe(true);
});

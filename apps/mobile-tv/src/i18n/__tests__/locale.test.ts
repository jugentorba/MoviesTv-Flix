import {
  directionForLocale,
  resolveAppLocale,
} from '../locale';
import { SUPPORTED_APP_LOCALES } from '../resources';

test('resolves Chinese region locales to the correct script', () => {
  expect(resolveAppLocale('zh-TW', SUPPORTED_APP_LOCALES)).toBe('zh-Hant');
  expect(resolveAppLocale('zh-HK', SUPPORTED_APP_LOCALES)).toBe('zh-Hant');
  expect(resolveAppLocale('zh-CN', SUPPORTED_APP_LOCALES)).toBe('zh-Hans');
  expect(resolveAppLocale('zh-SG', SUPPORTED_APP_LOCALES)).toBe('zh-Hans');
});

test('falls back from a regional locale to a supported parent', () => {
  expect(resolveAppLocale('fr-CA', SUPPORTED_APP_LOCALES)).toBe('fr');
  expect(resolveAppLocale('de-AT', SUPPORTED_APP_LOCALES)).toBe('de');
});

test('falls back to English when no translation pack matches', () => {
  expect(resolveAppLocale('xx-ZZ', SUPPORTED_APP_LOCALES)).toBe('en');
});

test('reports right-to-left app locale direction', () => {
  expect(directionForLocale('ar')).toBe('rtl');
  expect(directionForLocale('he')).toBe('rtl');
  expect(directionForLocale('fa')).toBe('rtl');
  expect(directionForLocale('ur')).toBe('rtl');
  expect(directionForLocale('sq')).toBe('ltr');
});

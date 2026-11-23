import React, { useCallback, useMemo, type ReactNode } from 'react';
import { displayLanguageName } from '@moviestv/core';
import { usePreferences } from '../preferences/usePreferences';
import { directionForLocale, resolveAppLocale, runtimeDeviceLocale } from './locale';
import {
  APP_RESOURCES,
  SUPPORTED_APP_LOCALES,
  type AppLocale,
} from './resources';
import type { TranslationParams } from './types';
import { translateFrom } from './translate';
import { I18nContext } from './useI18n';

export function I18nProvider({
  children,
  deviceLocale,
}: {
  children: ReactNode;
  deviceLocale?: string;
}) {
  const { preferences } = usePreferences();
  const requestedLocale = preferences.appLocale === 'system'
    ? (deviceLocale ?? runtimeDeviceLocale())
    : preferences.appLocale;
  const locale = resolveAppLocale(requestedLocale, SUPPORTED_APP_LOCALES) as AppLocale;
  const direction = directionForLocale(locale);
  const selectedResource = APP_RESOURCES[locale];
  const englishResource = APP_RESOURCES.en;

  const t = useCallback((key: string, params?: TranslationParams) => (
    translateFrom(selectedResource, englishResource, key, params)
  ), [englishResource, selectedResource]);

  const value = useMemo(() => ({
    locale,
    direction,
    t,
    formatNumber: (number: number) => new Intl.NumberFormat(locale).format(number),
    formatDate: (date: Date | number) => new Intl.DateTimeFormat(locale).format(date),
    languageName: (tag: string) => displayLanguageName(tag, locale),
  }), [direction, locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

import { createContext, useContext } from 'react';
import type { I18nApi } from './types';

export const I18nContext = createContext<I18nApi | null>(null);

export function useI18n(): I18nApi {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}

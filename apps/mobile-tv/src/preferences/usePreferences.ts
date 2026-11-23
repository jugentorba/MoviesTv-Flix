import { createContext, useContext } from 'react';
import type { MyListMediaItem, UserPreferences } from '@moviestv/core';

export interface PreferencesApi {
  preferences: UserPreferences;
  ready: boolean;
  setAppLocale(value: string | 'system'): Promise<void>;
  setPreferredAudioLanguages(value: string[]): Promise<void>;
  setPreferredSubtitleLanguages(value: string[]): Promise<void>;
  setSubtitlesEnabled(value: boolean): Promise<void>;
  setAutoplay(value: boolean): Promise<void>;
  setFavoriteChannelIds(value: string[]): Promise<void>;
  setMyListItems(value: MyListMediaItem[]): Promise<void>;
}

export const PreferencesContext = createContext<PreferencesApi | null>(null);

export function usePreferences(): PreferencesApi {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferences must be used inside PreferencesProvider');
  return context;
}

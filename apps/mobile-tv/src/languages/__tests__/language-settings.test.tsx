import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppLanguageScreen } from '../AppLanguageScreen';
import { OrderedLanguageScreen } from '../OrderedLanguageScreen';
import { I18nContext } from '../../i18n/useI18n';

const names: Record<string, string> = {
  en: 'English',
  sq: 'Albanian',
  fr: 'French',
  'zh-Hans': 'Chinese (Simplified)',
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <I18nContext.Provider value={{
      locale: 'en',
      direction: 'ltr',
      t: (key) => ({
        'settings.followDevice': 'Follow device language',
        'settings.languageSearch': 'Search languages',
        'settings.moveUp': 'Move up',
        'settings.moveDown': 'Move down',
        'settings.remove': 'Remove',
        'settings.subtitlesEnabled': 'Subtitles enabled',
        'common.back': 'Back',
      }[key] ?? key),
      formatNumber: String,
      formatDate: (value) => String(value),
      languageName: (tag) => names[tag] ?? tag,
    }}>
      {children}
    </I18nContext.Provider>
  );
}

test('app language offers device default and searchable translated app locales', () => {
  const onSelect = jest.fn();
  render(
    <AppLanguageScreen selected="system" onSelect={onSelect} onBack={() => undefined} />,
    { wrapper: Wrapper },
  );

  expect(screen.getByText('Follow device language')).toBeTruthy();
  expect(screen.getByText('Albanian')).toBeTruthy();

  fireEvent.changeText(screen.getByLabelText('Search languages'), 'Chinese');
  expect(screen.getByText('Chinese (Simplified)')).toBeTruthy();

  fireEvent.changeText(screen.getByLabelText('Search languages'), 'Albanian');
  fireEvent.press(screen.getByTestId('app-language-sq'));
  expect(onSelect).toHaveBeenCalledWith('sq');
});

test('ordered language screen moves priority with explicit remote-friendly controls', () => {
  const onChange = jest.fn();
  render(
    <OrderedLanguageScreen
      kind="audio"
      selected={['sq', 'fr', 'en']}
      onChange={onChange}
      onBack={() => undefined}
    />,
    { wrapper: Wrapper },
  );

  fireEvent.press(screen.getByTestId('language-move-up-en'));
  expect(onChange).toHaveBeenCalledWith(['sq', 'en', 'fr']);
});

test('subtitle screen exposes an independent subtitles enabled control', () => {
  const onSubtitlesEnabledChange = jest.fn();
  render(
    <OrderedLanguageScreen
      kind="subtitle"
      selected={['sq', 'en']}
      onChange={() => undefined}
      subtitlesEnabled={true}
      onSubtitlesEnabledChange={onSubtitlesEnabledChange}
      onBack={() => undefined}
    />,
    { wrapper: Wrapper },
  );

  fireEvent.press(screen.getByTestId('subtitles-enabled-toggle'));
  expect(onSubtitlesEnabledChange).toHaveBeenCalledWith(false);
});

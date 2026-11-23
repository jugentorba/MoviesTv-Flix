import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SubtitleChooser } from '../SubtitleChooser';

jest.mock('../../i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'playback.subtitles': 'Subtitles',
      'playback.embeddedSubtitles': 'Embedded subtitles',
      'playback.addonSubtitles': 'Add-on subtitles',
      'playback.off': 'Off',
      'playback.close': 'Close',
      'playback.selected': 'Selected',
    } as Record<string, string>)[key] ?? key,
    languageName: (tag: string) => tag === 'fr' ? 'French' : tag === 'en' ? 'English' : tag,
  }),
}));

test('shows Off, embedded tracks and add-on tracks in one subtitle chooser', () => {
  const onSelectExternal = jest.fn();
  const onSelectEmbedded = jest.fn();
  const onSelectOff = jest.fn();

  render(
    <SubtitleChooser
      externalTracks={[
        { id: 'addon-fr', language: 'fr', label: 'Provider FR', url: 'https://subs.example/fr.vtt' },
      ]}
      embeddedTracks={[
        { id: 'embedded-en', language: 'en', label: 'English CC' },
      ]}
      selectedExternalSubtitleId={null}
      selectedEmbeddedSubtitleId="embedded-en"
      subtitlesOff={false}
      onSelectExternal={onSelectExternal}
      onSelectEmbedded={onSelectEmbedded}
      onSelectOff={onSelectOff}
      onClose={jest.fn()}
    />,
  );

  expect(screen.getByText('Embedded subtitles')).toBeTruthy();
  expect(screen.getByText('Add-on subtitles')).toBeTruthy();
  expect(screen.getByText('English')).toBeTruthy();
  expect(screen.getByText('French')).toBeTruthy();

  fireEvent.press(screen.getByTestId('embedded-subtitle-embedded-en'));
  expect(onSelectEmbedded).toHaveBeenCalledWith('embedded-en');

  fireEvent.press(screen.getByTestId('subtitle-addon-fr'));
  expect(onSelectExternal).toHaveBeenCalledWith('addon-fr');

  fireEvent.press(screen.getByTestId('subtitle-off'));
  expect(onSelectOff).toHaveBeenCalledTimes(1);
});

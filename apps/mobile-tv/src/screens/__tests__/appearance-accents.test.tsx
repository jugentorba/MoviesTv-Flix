import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AppearanceSettingsScreen } from '../AppearanceSettingsScreen';
import { I18nContext } from '../../i18n/useI18n';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { ThemeProvider, useThemeController } from '../../theme/ThemeProvider';

function Probe() {
  const { accentHue } = useThemeController();
  return <Text testID="probe-hue">{String(accentHue)}</Text>;
}

function renderScreen() {
  return render(
    <ThemeProvider>
      <I18nContext.Provider value={{
        locale: 'en',
        direction: 'ltr',
        t: (key: string, params?: Record<string, string | number>) => translateFrom(
          APP_RESOURCES.en,
          APP_RESOURCES.en,
          key,
          params,
        ),
        formatNumber: String,
        formatDate: (value) => String(value),
        languageName: (tag) => tag,
      }}>
        <AppearanceSettingsScreen onBack={jest.fn()} />
        <Probe />
      </I18nContext.Provider>
    </ThemeProvider>,
  );
}

test('offers the colour wheel and the classic reset', () => {
  renderScreen();
  expect(screen.getByTestId('colour-wheel')).toBeTruthy();
  expect(screen.getByTestId('appearance-accent-default')).toBeTruthy();
});

test('pressing the reset returns to the classic violet', () => {
  renderScreen();
  fireEvent.press(screen.getByTestId('appearance-accent-default'));
  expect(screen.getByTestId('probe-hue').props.children).toBe('253');
});

test('subtitle size and background are adjustable from the same screen', () => {
  renderScreen();

  fireEvent.press(screen.getByTestId('appearance-subtitle-size-large'));
  expect(screen.getByTestId('appearance-subtitle-size-large').props.accessibilityState)
    .toEqual({ selected: true });

  fireEvent.press(screen.getByTestId('appearance-subtitle-background-off'));
  expect(screen.getByTestId('appearance-subtitle-background-off').props.accessibilityState)
    .toEqual({ selected: true });
});

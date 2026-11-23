import React from 'react';
import { Text } from 'react-native';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { themes } from '@moviestv/ui';
import {
  THEME_STORAGE_KEY,
  ThemeProvider,
  useTheme,
  useThemeController,
} from '../ThemeProvider';

function Probe() {
  const theme = useTheme();
  const { themeName, setThemeName, accentHue, setAccentHue, ready } = useThemeController();
  return (
    <>
      <Text testID="name">{themeName}</Text>
      <Text testID="bg">{theme.colors.background}</Text>
      <Text testID="ready">{String(ready)}</Text>
      <Text testID="accent">{theme.colors.accent}</Text>
      <Text testID="accent-hue">{String(accentHue)}</Text>
      <Text testID="pick-teal" onPress={() => setAccentHue(174)}>teal</Text>
      <Text testID="pick-amoled" onPress={() => setThemeName('amoled')}>amoled</Text>
      <Text testID="pick-light" onPress={() => setThemeName('light')}>light</Text>
    </>
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('ThemeProvider', () => {
  it('starts on the dark theme', async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('name').props.children).toBe('dark');
    expect(screen.getByTestId('bg').props.children).toBe(themes.dark.colors.background);
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'));
  });

  it('switches the theme for every consumer at once', async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'));

    await act(async () => {
      screen.getByTestId('pick-amoled').props.onPress();
    });

    expect(screen.getByTestId('name').props.children).toBe('amoled');
    expect(screen.getByTestId('bg').props.children).toBe('#000000');
  });

  it('remembers the choice on the device', async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'));

    await act(async () => {
      screen.getByTestId('pick-light').props.onPress();
    });

    await waitFor(async () => {
      expect(await AsyncStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    });
  });

  it('restores a stored theme on the next launch', async () => {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, 'amoled');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('name').props.children).toBe('amoled'));
  });

  it('ignores a corrupted stored value instead of failing to start', async () => {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, 'neon-pink');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'));
    expect(screen.getByTestId('name').props.children).toBe('dark');
  });

  it('gives screens the default theme outside a provider rather than crashing', () => {
    function Orphan() {
      const theme = useTheme();
      return <Text testID="orphan">{theme.colors.text}</Text>;
    }
    render(<Orphan />);
    expect(screen.getByTestId('orphan').props.children).toBe(themes.dark.colors.text);
  });
});

test('a chosen hue replaces the theme accent and is remembered', async () => {
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'));

  await act(async () => {
    screen.getByTestId('pick-teal').props.onPress();
  });

  expect(screen.getByTestId('accent-hue').props.children).toBe('174');
  // The accent must actually change with the hue.
  const accent = screen.getByTestId('accent').props.children;
  expect(accent).not.toBe(themes.dark.colors.accent);
  expect(await AsyncStorage.getItem('moviestv:accent-hue:v1')).toBe('174');
});

test('an invalid stored hue falls back to the default', async () => {
  await AsyncStorage.setItem('moviestv:accent-hue:v1', 'banana');
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('ready').props.children).toBe('true'));
  expect(screen.getByTestId('accent-hue').props.children).toBe('253');
});

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { I18nContext } from '../i18n/useI18n';
import { AppNavigator } from '../navigation/AppNavigator';
import {
  beginImmersiveSurface,
  resetImmersiveSurfacesForTests,
} from '../playback/immersiveSurface';

// The phone tab bar collapses itself while a film is playing, so the navigator
// reads playback state. These tests render the navigator alone.
let mockSelectedSource: unknown = null;
jest.mock('../playback/usePlayback', () => ({
  usePlayback: () => ({ selectedSource: mockSelectedSource }),
}));

jest.mock('../catalog/CatalogScreen', () => {
  const ReactModule = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    CatalogScreen: ({
      route,
      onSelectMedia,
    }: {
      route: string;
      onSelectMedia(mediaId: string): void;
    }) => {
      const [count, setCount] = ReactModule.useState(0);
      return ReactModule.createElement(
        View,
        null,
        ReactModule.createElement(Text, null, `catalog-${route}`),
        ReactModule.createElement(
          Pressable,
          {
            testID: `catalog-state-${route}`,
            onPress: () => setCount((value: number) => value + 1),
          },
          ReactModule.createElement(Text, null, `state-${route}-${count}`),
        ),
        ReactModule.createElement(
          Pressable,
          {
            testID: `catalog-open-details-${route}`,
            onPress: () => onSelectMedia('movie:1'),
          },
          ReactModule.createElement(Text, null, 'Open details'),
        ),
      );
    },
  };
});

jest.mock('../catalog/MediaDetailsScreen', () => {
  const ReactModule = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    MediaDetailsScreen: ({
      mediaId,
      onBack,
    }: {
      mediaId: string;
      onBack(): void;
    }) => ReactModule.createElement(
      Pressable,
      { testID: 'details-back', onPress: onBack },
      ReactModule.createElement(Text, null, `details-${mediaId}`),
    ),
  };
});

jest.mock('../catalog/SearchScreen', () => {
  const ReactModule = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    SearchScreen: ({
      onSelectMedia,
    }: {
      onSelectMedia(mediaId: string): void;
    }) => {
      const [count, setCount] = ReactModule.useState(0);
      return ReactModule.createElement(
        View,
        null,
        ReactModule.createElement(
          Pressable,
          {
            testID: 'search-state',
            onPress: () => setCount((value: number) => value + 1),
          },
          ReactModule.createElement(Text, null, `search-state-${count}`),
        ),
        ReactModule.createElement(
          Pressable,
          {
            testID: 'search-open-details',
            onPress: () => onSelectMedia('movie:search'),
          },
          ReactModule.createElement(Text, null, 'Open search details'),
        ),
      );
    },
  };
});

jest.mock('../live-tv/LiveTvScreen', () => ({
  LiveTvScreen: () => null,
}));

jest.mock('../screens/SettingsScreen', () => ({
  SettingsScreen: () => null,
}));

const copy: Record<string, string> = {
  'nav.home': 'Home',
  'nav.movies': 'Movies',
  'nav.series': 'Series',
  'nav.liveTv': 'Live TV',
  'nav.search': 'Search',
  'nav.settings': 'Settings',
};

function renderNavigator(formFactor: 'phone' | 'tablet' | 'tv') {
  return render(
    <I18nContext.Provider value={{
      locale: 'en',
      direction: 'ltr',
      t: (key) => copy[key] ?? key,
      formatNumber: String,
      formatDate: (value) => String(value),
      languageName: (tag) => tag,
    }}>
        <AppNavigator formFactor={formFactor} />
    </I18nContext.Provider>,
  );
}

test('phone navigation exposes Home and Live TV', () => {
  renderNavigator('phone');
  expect(screen.getAllByText('Home').length).toBeGreaterThan(0);
  expect(screen.getByText('Live TV')).toBeTruthy();
});

test('phone tab bar collapses while a film is playing', () => {
  mockSelectedSource = { id: 'stream-1' };
  try {
    renderNavigator('phone');
    // The screen keeps rendering; only the bar goes away.
    expect(screen.getByText('catalog-home')).toBeTruthy();
    expect(screen.queryByText('Home')).toBeNull();
  } finally {
    mockSelectedSource = null;
  }
});

test('phone tab bar collapses for the offline player too', () => {
  let release: () => void = () => {};
  act(() => {
    release = beginImmersiveSurface();
  });
  try {
    renderNavigator('phone');
    expect(screen.getByText('catalog-home')).toBeTruthy();
    expect(screen.queryByText('Home')).toBeNull();
  } finally {
    act(() => release());
    resetImmersiveSurfacesForTests();
  }
});

test('phone tab bar returns when the player closes', () => {
  renderNavigator('phone');
  expect(screen.getByText('Home')).toBeVisible();
});

test('TV navigation uses a focusable left rail', () => {
  renderNavigator('tv');
  expect(screen.getByTestId('tv-nav-rail')).toBeTruthy();
  expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
});


test('tablet and desktop widths use the wide side rail', () => {
  renderNavigator('tablet');
  expect(screen.getByTestId('wide-nav-rail')).toBeTruthy();
  expect(screen.queryByTestId('tv-nav-rail')).toBeNull();
});


test('TV preferred focus follows the rail item the remote actually focused', () => {
  renderNavigator('tv');

  fireEvent(screen.getByTestId('tv-nav-movies'), 'focus');

  expect(
    screen.getByTestId('tv-nav-home').props.hasTVPreferredFocus,
  ).toBe(false);
  expect(
    screen.getByTestId('tv-nav-movies').props.hasTVPreferredFocus,
  ).toBe(true);
});

test('TV rail gives Home deterministic initial remote focus only on TVs', () => {
  const tvView = renderNavigator('tv');
  expect(
    screen.getByTestId('tv-nav-home').props.hasTVPreferredFocus,
  ).toBe(true);
  expect(
    screen.getByTestId('tv-nav-movies').props.hasTVPreferredFocus,
  ).toBe(false);

  tvView.unmount();
  renderNavigator('tablet');

  expect(
    screen.getByTestId('tv-nav-home').props.hasTVPreferredFocus,
  ).toBe(false);
});

test('phone details preserve the originating catalog screen state', () => {
  renderNavigator('phone');

  fireEvent.press(screen.getByTestId('catalog-state-home'));
  expect(screen.getByText('state-home-1')).toBeTruthy();

  fireEvent.press(screen.getByTestId('catalog-open-details-home'));
  expect(screen.getByText('details-movie:1')).toBeTruthy();

  fireEvent.press(screen.getByTestId('details-back'));
  expect(screen.getByText('state-home-1')).toBeTruthy();
});

test('TV details preserve the originating catalog screen state', () => {
  renderNavigator('tv');

  fireEvent.press(screen.getByTestId('catalog-state-home'));
  expect(screen.getByText('state-home-1')).toBeTruthy();

  fireEvent.press(screen.getByTestId('catalog-open-details-home'));
  expect(screen.getByText('details-movie:1')).toBeTruthy();

  fireEvent.press(screen.getByTestId('details-back'));
  expect(screen.getByText('state-home-1')).toBeTruthy();
});

test('phone search state survives opening and closing details', () => {
  renderNavigator('phone');

  fireEvent.press(screen.getByText('Search'));
  fireEvent.press(screen.getByTestId('search-state'));
  expect(screen.getByText('search-state-1')).toBeTruthy();

  fireEvent.press(screen.getByTestId('search-open-details'));
  expect(screen.getByText('details-movie:search')).toBeTruthy();

  fireEvent.press(screen.getByTestId('details-back'));
  expect(screen.getByText('search-state-1')).toBeTruthy();
});

test('TV search state survives opening and closing details', () => {
  renderNavigator('tv');

  fireEvent.press(screen.getByTestId('tv-nav-search'));
  fireEvent.press(screen.getByTestId('search-state'));
  expect(screen.getByText('search-state-1')).toBeTruthy();

  fireEvent.press(screen.getByTestId('search-open-details'));
  expect(screen.getByText('details-movie:search')).toBeTruthy();

  fireEvent.press(screen.getByTestId('details-back'));
  expect(screen.getByText('search-state-1')).toBeTruthy();
});


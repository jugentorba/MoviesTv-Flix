import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { CatalogMediaItem } from '@moviestv/catalog';
import { MediaQuickActions } from '../MediaQuickActions';
import { I18nContext } from '../../i18n/useI18n';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { ThemeProvider } from '../../theme/ThemeProvider';

const item = {
  id: 'tt1234567',
  title: 'Modern Family',
  kind: 'series',
  providerId: 'com.stremio.cinemeta',
  externalIds: { imdb: 'tt1234567' },
  year: 2009,
} as unknown as CatalogMediaItem;

function renderSheet(overrides: Partial<React.ComponentProps<typeof MediaQuickActions>> = {}) {
  const props = {
    item,
    inMyList: false,
    onToggleMyList: jest.fn(),
    onOpenDetails: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
  render(
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
        <MediaQuickActions {...props} />
      </I18nContext.Provider>
    </ThemeProvider>,
  );
  return props;
}

test('shows the title and both quick actions', () => {
  renderSheet();
  expect(screen.getByText('Modern Family')).toBeTruthy();
  expect(screen.getByText('Add to My List')).toBeTruthy();
  expect(screen.getByText('Details')).toBeTruthy();
});

test('offers to remove when the media is already saved', () => {
  renderSheet({ inMyList: true });
  expect(screen.getByText('Remove from My List')).toBeTruthy();
});

test('each action calls its handler', () => {
  const props = renderSheet();

  fireEvent.press(screen.getByTestId('quick-actions-my-list'));
  expect(props.onToggleMyList).toHaveBeenCalledTimes(1);

  fireEvent.press(screen.getByTestId('quick-actions-details'));
  expect(props.onOpenDetails).toHaveBeenCalledTimes(1);

  fireEvent.press(screen.getByTestId('quick-actions-close'));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

test('tapping outside the sheet closes it', () => {
  const props = renderSheet();
  fireEvent.press(screen.getByTestId('quick-actions-backdrop'));
  expect(props.onClose).toHaveBeenCalled();
});

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { MediaCard } from '../MediaCard';
import { ThemeProvider } from '../../theme/ThemeProvider';
import type { CatalogMediaItem } from '@moviestv/catalog';

const item = {
  id: 'movie-1',
  title: 'A Film',
  kind: 'movie',
  providerId: 'com.linvo.cinemeta',
  externalIds: { imdb: 'tt1' },
  posterUrl: 'https://images.example/p.jpg',
} as unknown as CatalogMediaItem;

test('a card with progress draws the bar', () => {
  render(
    <ThemeProvider>
      <MediaCard item={item} onPress={jest.fn()} progressRatio={0.35} />
    </ThemeProvider>,
  );
  expect(screen.getByTestId('media-card-progress')).toBeTruthy();
});

test('a card without progress draws no bar', () => {
  render(
    <ThemeProvider>
      <MediaCard item={item} onPress={jest.fn()} />
    </ThemeProvider>,
  );
  expect(screen.queryByTestId('media-card-progress')).toBeNull();
});

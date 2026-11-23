import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { WatchProgressRecord } from '@moviestv/sync';
import { APP_RESOURCES } from '../../i18n/resources';
import { translateFrom } from '../../i18n/translate';
import { I18nContext } from '../../i18n/useI18n';
import {
  PlaybackContext,
  type PlaybackApi,
} from '../../playback/usePlayback';
import {
  WatchProgressContext,
  type WatchProgressContextValue,
} from '../useWatchProgress';
import { WatchHistoryScreen } from '../WatchHistoryScreen';

const i18n = {
  locale: 'en',
  direction: 'ltr' as const,
  t: (key: string, params?: Record<string, string | number>) => (
    translateFrom(APP_RESOURCES.en, APP_RESOURCES.en, key, params)
  ),
  formatNumber: String,
  formatDate: String,
  languageName: String,
};

const NOW = '2026-11-15T12:00:00.000Z';

function record(overrides: Partial<WatchProgressRecord> = {}): WatchProgressRecord {
  return {
    mediaId: 'movie-1',
    kind: 'movie',
    title: 'Dune',
    positionSeconds: 600,
    durationSeconds: 1_200,
    completed: false,
    updatedAt: NOW,
    ...overrides,
  };
}

function watchProgressValue(
  records: WatchProgressRecord[],
  overrides: Partial<WatchProgressContextValue> = {},
): WatchProgressContextValue {
  return {
    records,
    status: 'ready',
    save: jest.fn(async () => undefined),
    restart: jest.fn(async () => undefined),
    markCompleted: jest.fn(async () => undefined),
    forget: jest.fn(async () => undefined),
    forgetAll: jest.fn(async () => undefined),
    ...overrides,
  };
}

function playbackValue(
  overrides: Partial<PlaybackApi> = {},
): PlaybackApi {
  return {
    status: 'idle',
    media: null,
    sources: [],
    selectedSourceId: null,
    errorMessage: null,
    progress: null,
    openPlayback: jest.fn(),
    selectSource: jest.fn(),
    closePlayback: jest.fn(),
    reportProgress: jest.fn(),
    resumeProgress: jest.fn(async () => true),
    activeAudioLanguage: null,
    activeSubtitleLanguage: null,
    ...overrides,
  } as PlaybackApi;
}

function renderScreen(
  watchProgress: WatchProgressContextValue,
  playback = playbackValue(),
  onBack = jest.fn(),
) {
  return render(
    <I18nContext.Provider value={i18n}>
      <PlaybackContext.Provider value={playback}>
        <WatchProgressContext.Provider value={watchProgress}>
          <WatchHistoryScreen onBack={onBack} />
        </WatchProgressContext.Provider>
      </PlaybackContext.Provider>
    </I18nContext.Provider>,
  );
}

test('lists records newest first with progress and an episode code', () => {
  renderScreen(watchProgressValue([
    record({
      mediaId: 'episode-1',
      kind: 'episode',
      title: 'Severance',
      seasonNumber: 2,
      episodeNumber: 3,
      positionSeconds: 900,
      durationSeconds: 3_000,
      updatedAt: '2026-11-14T12:00:00.000Z',
    }),
    record({ updatedAt: NOW }),
  ]));

  expect(screen.getByText('Dune')).toBeTruthy();
  expect(screen.getByText('Severance')).toBeTruthy();
  expect(screen.getByText('S2E3 · 15 min watched')).toBeTruthy();
  expect(screen.getByText('10 min watched')).toBeTruthy();

  const rows = screen.getAllByTestId(/^watch-history-row-/);
  expect(rows).toHaveLength(2);
});

test('shows an empty state with no records and hides clear all', () => {
  renderScreen(watchProgressValue([]));

  expect(screen.getByText('No watch history yet.')).toBeTruthy();
  expect(screen.queryByTestId('watch-history-clear')).toBeNull();
});

test('removes one record through the context', async () => {
  const forget = jest.fn(async () => undefined);
  renderScreen(watchProgressValue([record()], { forget }));

  await act(async () => {
    fireEvent.press(screen.getByTestId('watch-history-remove-movie-1'));
  });

  expect(forget).toHaveBeenCalledWith(expect.objectContaining({
    mediaId: 'movie-1',
  }));
  expect(screen.getByText('Removed from watch history.')).toBeTruthy();
});

test('clears everything only after the confirmation step', async () => {
  const forgetAll = jest.fn(async () => undefined);
  renderScreen(watchProgressValue([record()], { forgetAll }));

  await act(async () => {
    fireEvent.press(screen.getByTestId('watch-history-clear'));
  });
  expect(forgetAll).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(screen.getByTestId('watch-history-clear-cancel'));
  });
  expect(screen.queryByTestId('watch-history-clear-confirm')).toBeNull();
  expect(forgetAll).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(screen.getByTestId('watch-history-clear'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('watch-history-clear-confirm'));
  });

  expect(forgetAll).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Watch history cleared.')).toBeTruthy();
});

test('reports a failed delete without hiding the row', async () => {
  const forget = jest.fn(async () => { throw new Error('storage unavailable'); });
  renderScreen(watchProgressValue([record()], { forget }));

  await act(async () => {
    fireEvent.press(screen.getByTestId('watch-history-remove-movie-1'));
  });

  expect(screen.getByText('Watch history could not be updated.')).toBeTruthy();
  expect(screen.getByText('Dune')).toBeTruthy();
});

test('resumes a record and explains when that is impossible', async () => {
  const resumeProgress = jest
    .fn<Promise<boolean>, [WatchProgressRecord]>()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  const closePlayback = jest.fn();
  renderScreen(
    watchProgressValue([record()]),
    playbackValue({ resumeProgress, closePlayback }),
  );

  await act(async () => {
    fireEvent.press(screen.getByTestId('watch-history-resume-movie-1'));
  });
  expect(resumeProgress).toHaveBeenCalledWith(expect.objectContaining({
    mediaId: 'movie-1',
  }));
  expect(closePlayback).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.press(screen.getByTestId('watch-history-resume-movie-1'));
  });
  expect(closePlayback).toHaveBeenCalledTimes(1);
  expect(screen.getByText('This title cannot be resumed right now.')).toBeTruthy();
});

test('surfaces sync status and returns through the back button', async () => {
  const onBack = jest.fn();
  renderScreen(
    watchProgressValue([record()], { status: 'offline' }),
    playbackValue(),
    onBack,
  );

  expect(screen.getByText('Offline — changes stay on this device.')).toBeTruthy();

  fireEvent.press(screen.getByTestId('watch-history-back'));

  expect(onBack).toHaveBeenCalledTimes(1);
});

test('marks a completed record and fills its bar', async () => {
  renderScreen(watchProgressValue([
    record({ completed: true, positionSeconds: 1_200 }),
  ]));

  await waitFor(() => {
    expect(screen.getByText('Completed')).toBeTruthy();
  });
  const bar = screen.getByTestId('watch-history-progress-movie-1');
  const flattened = [bar.props.style].flat(Infinity) as { width?: string }[];
  expect(flattened.some((style) => style?.width === '100%')).toBe(true);
});

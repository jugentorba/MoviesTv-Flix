import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Directory, File } from 'expo-file-system';
import { DownloadsScreen } from '../DownloadsScreen.native';
import type { DownloadJob } from '../useDownloadManager';

jest.mock('../../auth/useAccount', () => ({
  useAccount: () => ({ userId: null }),
}));

jest.mock('../../i18n/useI18n', () => {
  const { APP_RESOURCES } = require('../../i18n/resources');
  const { translateFrom } = require('../../i18n/translate');
  return {
    useI18n: () => ({
      locale: 'en',
      t: (key: string, params?: Record<string, string | number>) => (
        translateFrom(APP_RESOURCES.en, APP_RESOURCES.en, key, params)
      ),
    }),
  };
});

jest.mock('../../preferences/usePreferences', () => ({
  usePreferences: () => ({
    preferences: {
      preferredAudioLanguages: [],
      preferredSubtitleLanguages: [],
      subtitlesEnabled: true,
    },
  }),
}));

const mockDismiss = jest.fn();
let mockJobs: DownloadJob[] = [];
jest.mock('../useDownloadManager', () => ({
  useDownloadManager: () => ({
    jobs: mockJobs,
    dismiss: mockDismiss,
    pause: jest.fn(),
    resume: jest.fn(),
    cancel: jest.fn(),
  }),
}));

afterEach(() => {
  jest.restoreAllMocks();
  mockDismiss.mockClear();
  mockJobs = [];
});

test('native Downloads stays usable when its directory cannot be opened', async () => {
  jest.spyOn(Directory.prototype, 'create')
    .mockImplementation(() => {
      throw new Error('storage unavailable');
    });

  render(<DownloadsScreen onBack={jest.fn()} />);

  await waitFor(() => {
    expect(screen.getByText('No downloads yet')).toBeTruthy();
  });
});

test('native Downloads survives an undeletable offline file', async () => {
  const video = new File(
    'file:///documents/MoviesTv-Flix/Downloads',
    'movie.mp4',
  );
  Object.assign(video, {
    exists: true,
    size: 1024,
    lastModified: 10,
  });

  jest.spyOn(Directory.prototype, 'list')
    .mockReturnValue([video] as never);
  jest.spyOn(File.prototype, 'delete')
    .mockImplementation(() => {
      throw new Error('read-only filesystem');
    });

  render(<DownloadsScreen onBack={jest.fn()} />);

  await screen.findByText('movie');
  expect(() => {
    fireEvent.press(screen.getByText('Delete'), {
      stopPropagation: jest.fn(),
    });
  }).not.toThrow();

  await waitFor(() => {
    expect(screen.getByText('movie')).toBeTruthy();
  });
});


test('hides the partial file represented by an active native download job', async () => {
  const video = new File(
    'file:///documents/MoviesTv-Flix/Downloads',
    'Movie.mp4',
  );
  Object.assign(video, {
    exists: true,
    size: 512,
    lastModified: 20,
  });

  jest.spyOn(Directory.prototype, 'list')
    .mockReturnValue([video] as never);
  mockJobs = [{
    id: 'active-1',
    title: 'Movie',
    localFileName: 'Movie.mp4',
    progress: 0.5,
    status: 'paused',
    startedAt: '2026-10-01T07:30:00.000Z',
  }];

  render(<DownloadsScreen onBack={jest.fn()} />);

  await waitFor(() => {
    expect(screen.getByTestId('download-job-active-1')).toBeTruthy();
  });
  expect(screen.queryByText('Delete')).toBeNull();
  expect(screen.getByText('Paused')).toBeTruthy();
});

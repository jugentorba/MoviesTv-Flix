import type { DownloadJob } from '../useDownloadManager';
import {
  isActiveNativeDownloadFile,
  isOfflineLibraryFileName,
} from '../DownloadsScreen.native';

function job(
  status: DownloadJob['status'],
  localFileName?: string,
): DownloadJob {
  return {
    id: `job-${status}`,
    title: 'Movie',
    ...(localFileName ? { localFileName } : {}),
    progress: null,
    status,
    startedAt: '2026-10-01T00:00:00.000Z',
  };
}

test('active and paused native download files stay out of the completed library', () => {
  expect(isActiveNativeDownloadFile(
    'Movie.mp4',
    [job('downloading', 'Movie.mp4')],
  )).toBe(true);
  expect(isActiveNativeDownloadFile(
    'Movie.mp4',
    [job('paused', 'Movie.mp4')],
  )).toBe(true);
});

test('completed, failed, and unrelated files remain eligible for the library', () => {
  expect(isActiveNativeDownloadFile(
    'Movie.mp4',
    [job('completed', 'Movie.mp4')],
  )).toBe(false);
  expect(isActiveNativeDownloadFile(
    'Movie.mp4',
    [job('error', 'Movie.mp4')],
  )).toBe(false);
  expect(isActiveNativeDownloadFile(
    'Legacy.mp4',
    [job('paused', 'Movie.mp4')],
  )).toBe(false);
  expect(isActiveNativeDownloadFile('', [
    job('downloading', 'Movie.mp4'),
  ])).toBe(false);
});


test('partial and metadata sidecars stay out of the offline library', () => {
  expect(isOfflineLibraryFileName('Movie.mp4')).toBe(true);
  expect(isOfflineLibraryFileName('Legacy File.mkv')).toBe(true);
  expect(isOfflineLibraryFileName('Movie.mp4.moviestv.json')).toBe(false);
  expect(isOfflineLibraryFileName('Movie.mp4.moviestv-partial')).toBe(false);
  expect(isOfflineLibraryFileName('')).toBe(false);
});

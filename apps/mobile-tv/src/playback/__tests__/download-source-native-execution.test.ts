import { Directory, File } from 'expo-file-system';
import type { StreamSource } from '@moviestv/core';
import {
  cleanupStalePartialDownloads,
  startDownloadSource,
} from '../downloadSource.native';

test('native download executes the normalized validated URL', async () => {
  const createDownloadTask = jest.spyOn(
    File,
    'createDownloadTask',
  );
  const source: StreamSource = {
    id: 'source',
    url: '  https://cdn.example/movie.mp4  ',
  };

  const handle = startDownloadSource(source);
  expect(handle.fileName).toBe('movie.mp4');
  const destination = createDownloadTask.mock.calls[0]?.[1] as File;
  expect(destination.name).toBe('movie.mp4.moviestv-partial');

  await handle.promise;
  expect(destination.name).toBe('movie.mp4');

  expect(createDownloadTask).toHaveBeenCalledWith(
    'https://cdn.example/movie.mp4',
    expect.anything(),
    expect.any(Object),
  );

  createDownloadTask.mockRestore();
});


test('native download executes normalized validated request headers', async () => {
  const createDownloadTask = jest.spyOn(
    File,
    'createDownloadTask',
  );
  const source: StreamSource = {
    id: 'source',
    url: 'https://cdn.example/movie.mp4',
    headers: {
      ' Authorization ': ' Bearer runtime-only ',
      ' Referer ': ' https://player.example/ ',
    },
  };

  const handle = startDownloadSource(source);
  await handle.promise;

  expect(createDownloadTask).toHaveBeenCalledWith(
    'https://cdn.example/movie.mp4',
    expect.anything(),
    expect.objectContaining({
      headers: {
        Authorization: 'Bearer runtime-only',
        Referer: 'https://player.example/',
      },
    }),
  );

  createDownloadTask.mockRestore();
});


test('native download pause preserves resumable state instead of failing on Expo null result', async () => {
  const createDownloadTask = jest.spyOn(
    File,
    'createDownloadTask',
  );
  let resolveInitial!: (value: File | null) => void;
  let destination!: File;
  const task = {
    state: 'idle',
    downloadAsync: jest.fn(() => {
      task.state = 'active';
      return new Promise<File | null>((resolve) => {
        resolveInitial = resolve;
      });
    }),
    pauseAsync: jest.fn(async () => {
      task.state = 'paused';
      resolveInitial(null);
    }),
    resumeAsync: jest.fn(async () => {
      task.state = 'completed';
      const mutableDestination = destination as unknown as {
        exists: boolean;
        size: number;
      };
      mutableDestination.exists = true;
      mutableDestination.size = 100;
      return destination;
    }),
    cancel: jest.fn(),
  };
  createDownloadTask.mockImplementationOnce((_url, nextDestination) => {
    destination = nextDestination as File;
    return task as unknown as ReturnType<typeof File.createDownloadTask>;
  });

  const source: StreamSource = {
    id: 'source',
    url: 'https://cdn.example/movie.mp4',
  };
  const handle = startDownloadSource(source);

  await handle.pause();
  expect(task.state).toBe('paused');

  await expect(handle.resume()).resolves.toBeUndefined();
  await expect(handle.promise).resolves.toBeUndefined();
  expect(task.resumeAsync).toHaveBeenCalledTimes(1);

  createDownloadTask.mockRestore();
});

test('native download still rejects an unexpected null completion', async () => {
  const createDownloadTask = jest.spyOn(
    File,
    'createDownloadTask',
  );
  createDownloadTask.mockImplementationOnce(() => ({
    state: 'completed',
    downloadAsync: async () => null,
    pauseAsync: async () => undefined,
    resumeAsync: async () => null,
    cancel: () => undefined,
  }) as ReturnType<typeof File.createDownloadTask>);

  const handle = startDownloadSource({
    id: 'source',
    url: 'https://cdn.example/movie.mp4',
  });

  await expect(handle.promise).rejects.toThrow(
    'Download did not produce a file',
  );

  createDownloadTask.mockRestore();
});


test('stale native partial cleanup preserves recent transfers', () => {
  const list = jest.spyOn(Directory.prototype, 'list');
  const oldPartial = new File(
    'file:///documents',
    'old.mp4.moviestv-partial',
  );
  const recentPartial = new File(
    'file:///documents',
    'recent.mp4.moviestv-partial',
  );
  const completed = new File(
    'file:///documents',
    'completed.mp4',
  );
  const nowMs = 10_000;
  (oldPartial as unknown as { lastModified: number }).lastModified = 1_000;
  (recentPartial as unknown as { lastModified: number }).lastModified = 9_500;
  (completed as unknown as { lastModified: number }).lastModified = 1_000;
  list.mockReturnValue([
    oldPartial,
    recentPartial,
    completed,
  ]);

  cleanupStalePartialDownloads(
    { type: 'guest' },
    nowMs,
    2_000,
  );

  expect(oldPartial.exists).toBe(false);
  expect(recentPartial.exists).toBe(true);
  expect(completed.exists).toBe(true);

  list.mockRestore();
});

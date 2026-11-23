import React, { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { StreamSource } from '@moviestv/core';
import { DownloadManagerProvider } from '../DownloadManagerProvider.native';
import { useDownloadManager, type DownloadManagerApi } from '../useDownloadManager';

let mockCompleteDownload: (() => void) | null = null;
let mockReportProgress: ((progress: number | null) => void) | null = null;
let mockUserId: string | null = null;
let mockCapturedScope: unknown = null;
const mockPauseTask = jest.fn(async () => undefined);
const mockResumeTask = jest.fn(async () => undefined);
const mockCancelTask = jest.fn();

jest.mock('../../auth/useAccount', () => ({
  useAccount: () => ({ userId: mockUserId }),
}));

jest.mock('../../playback/downloadSource', () => ({
  cleanupStalePartialDownloads: jest.fn(),
  startDownloadSource: jest.fn((
    _source: unknown,
    onProgress?: (progress: number | null) => void,
    _titleHint?: string,
    _media?: unknown,
    scope?: unknown,
  ) => {
    mockCapturedScope = scope;
    const promise = new Promise<void>((resolve) => {
      mockReportProgress = onProgress ?? null;
      mockCompleteDownload = resolve;
    });
    return {
      promise,
      fileName: 'Movie.mp4',
      pause: mockPauseTask,
      resume: mockResumeTask,
      cancel: mockCancelTask,
    };
  }),
}));

function Probe({ onApi }: { onApi(api: DownloadManagerApi): void }) {
  const api = useDownloadManager();
  useEffect(() => onApi(api), [api, onApi]);
  return (
    <Text testID="job-state">
      {api.jobs.map((job) => `${job.status}:${job.progress}`).join(',')}
    </Text>
  );
}

const source: StreamSource = {
  id: 'stream-1',
  url: 'https://cdn.example/movie.mp4',
  quality: '1080p',
  providerId: 'provider-a',
};

beforeEach(() => {
  mockCompleteDownload = null;
  mockReportProgress = null;
  mockUserId = null;
  mockCapturedScope = null;
  const sourceModule = jest.requireMock(
    '../../playback/downloadSource',
  ) as {
    cleanupStalePartialDownloads: jest.Mock;
    startDownloadSource: jest.Mock;
  };
  sourceModule.cleanupStalePartialDownloads.mockClear();
  sourceModule.startDownloadSource.mockClear();
  mockPauseTask.mockClear();
  mockResumeTask.mockClear();
  mockCancelTask.mockClear();
});

test('native download manager cleans stale partials for the active identity scope', async () => {
  mockUserId = 'user-a';
  render(
    <DownloadManagerProvider>
      <Probe onApi={() => undefined} />
    </DownloadManagerProvider>,
  );

  const sourceModule = jest.requireMock(
    '../../playback/downloadSource',
  ) as {
    cleanupStalePartialDownloads: jest.Mock;
  };
  await waitFor(() => {
    expect(sourceModule.cleanupStalePartialDownloads).toHaveBeenCalledTimes(1);
  });
  expect(sourceModule.cleanupStalePartialDownloads).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'user' }),
  );
  expect(Object.values(
    sourceModule.cleanupStalePartialDownloads.mock.calls[0]?.[0] as Record<string, unknown>,
  )).not.toContain('user-a');
});

test('native download job remains owned by the app provider and reports progress to consumers', async () => {
  let api: DownloadManagerApi | null = null;
  render(
    <DownloadManagerProvider>
      <Probe onApi={(value) => { api = value; }} />
    </DownloadManagerProvider>,
  );

  await act(async () => {
    await api!.startDownload(source, 'Movie', {
      mediaId: 'movie:1',
      kind: 'movie',
      title: 'Movie',
    });
  });

  expect(screen.getByTestId('job-state').props.children).toBe('downloading:null');

  act(() => {
    mockReportProgress?.(0.42);
  });
  expect(screen.getByTestId('job-state').props.children).toBe('downloading:0.42');

  await act(async () => {
    mockCompleteDownload?.();
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(screen.getByTestId('job-state').props.children).toBe('completed:1');
  });
});

test('native download manager associates active jobs with the safe local filename', async () => {
  let api: DownloadManagerApi | null = null;
  render(
    <DownloadManagerProvider>
      <Probe onApi={(value) => { api = value; }} />
    </DownloadManagerProvider>,
  );

  await act(async () => {
    await api!.startDownload(source, 'Movie');
  });

  expect(api!.jobs[0]?.localFileName).toBe('Movie.mp4');
});

test('native download jobs can pause, resume, and cancel', async () => {
  let api: DownloadManagerApi | null = null;
  render(
    <DownloadManagerProvider>
      <Probe onApi={(value) => { api = value; }} />
    </DownloadManagerProvider>,
  );

  let jobId = '';
  await act(async () => {
    jobId = await api!.startDownload(source, 'Movie');
  });

  await act(async () => {
    await api!.pause(jobId);
  });
  expect(mockPauseTask).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('job-state').props.children).toBe('paused:null');

  await act(async () => {
    await api!.resume(jobId);
  });
  expect(mockResumeTask).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('job-state').props.children).toBe('downloading:null');

  act(() => {
    api!.cancel(jobId);
  });
  expect(mockCancelTask).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('job-state').props.children).toBe('');
});


test('native download progress is clamped to a valid fraction', async () => {
  let api: DownloadManagerApi | null = null;
  render(<DownloadManagerProvider><Probe onApi={(value) => { api = value; }} /></DownloadManagerProvider>);
  await act(async () => { await api!.startDownload(source, 'Movie'); });
  act(() => { mockReportProgress?.(2); });
  expect(screen.getByTestId('job-state').props.children).toBe('downloading:1');
  act(() => { mockReportProgress?.(-1); });
  expect(screen.getByTestId('job-state').props.children).toBe('downloading:0');
});

test('completed native downloads ignore later cancellation', async () => {
  let api: DownloadManagerApi | null = null;
  render(<DownloadManagerProvider><Probe onApi={(value) => { api = value; }} /></DownloadManagerProvider>);
  let jobId = '';
  await act(async () => { jobId = await api!.startDownload(source, 'Movie'); });
  await act(async () => { mockCompleteDownload?.(); await Promise.resolve(); });
  act(() => { api!.cancel(jobId); });
  expect(screen.getByTestId('job-state').props.children).toBe('completed:1');
});


test('unmounting the native download manager cancels active account-owned downloads', async () => {
  let api: DownloadManagerApi | null = null;
  const view = render(
    <DownloadManagerProvider>
      <Probe onApi={(value) => { api = value; }} />
    </DownloadManagerProvider>,
  );

  await act(async () => {
    await api!.startDownload(source, 'Movie');
  });
  expect(screen.getByTestId('job-state').props.children).toBe(
    'downloading:null',
  );

  act(() => {
    view.unmount();
  });

  expect(mockCancelTask).toHaveBeenCalledTimes(1);
});


test('native download manager passes the signed-in account scope to storage', async () => {
  mockUserId = 'user-a';
  let api: DownloadManagerApi | null = null;
  render(
    <DownloadManagerProvider>
      <Probe onApi={(value) => { api = value; }} />
    </DownloadManagerProvider>,
  );

  await act(async () => {
    await api!.startDownload(source, 'Movie');
  });

  expect(mockCapturedScope).toEqual(expect.objectContaining({
    type: 'user',
  }));
  expect(Object.values(mockCapturedScope as Record<string, unknown>))
    .not.toContain('user-a');
});


test('native download manager caps concurrent active downloads', async () => {
  let api: DownloadManagerApi | null = null;
  const view = render(
    <DownloadManagerProvider>
      <Probe onApi={(value) => { api = value; }} />
    </DownloadManagerProvider>,
  );

  for (let index = 0; index < 10; index += 1) {
    await act(async () => {
      await api!.startDownload(
        { ...source, id: `stream-${index}` },
        `Movie ${index}`,
      );
    });
  }

  await expect(api!.startDownload(
    { ...source, id: 'stream-11' },
    'Movie 11',
  )).rejects.toThrow('Too many active downloads');

  act(() => {
    view.unmount();
  });
  expect(mockCancelTask).toHaveBeenCalledTimes(10);
});

test('native download manager recovers from synchronous filesystem setup failures', async () => {
  const sourceModule = jest.requireMock(
    '../../playback/downloadSource',
  ) as {
    startDownloadSource: jest.Mock;
  };
  sourceModule.startDownloadSource.mockImplementationOnce(() => {
    throw new Error('filesystem unavailable');
  });

  let api: DownloadManagerApi | null = null;
  render(
    <DownloadManagerProvider>
      <Probe onApi={(value) => { api = value; }} />
    </DownloadManagerProvider>,
  );

  await expect(api!.startDownload(
    source,
    'Movie',
    {
      mediaId: 'movie:retry',
      kind: 'movie',
      title: 'Movie',
    },
  )).rejects.toThrow('filesystem unavailable');

  await waitFor(() => {
    expect(screen.getByTestId('job-state').props.children)
      .toBe('error:null');
  });

  await act(async () => {
    await api!.startDownload(
      source,
      'Movie',
      {
        mediaId: 'movie:retry',
        kind: 'movie',
        title: 'Movie',
      },
    );
  });

  expect(sourceModule.startDownloadSource).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('job-state').props.children)
    .toContain('downloading:null');
});

test('native download manager rejects malformed media identity before creating a job', async () => {
  let api: DownloadManagerApi | null = null;
  render(
    <DownloadManagerProvider>
      <Probe onApi={(value) => { api = value; }} />
    </DownloadManagerProvider>,
  );

  await expect(api!.startDownload(source, 'Movie', {
    mediaId: 'bad\u0000media',
    kind: 'movie',
    title: 'Movie',
  })).rejects.toThrow('Invalid download media identity');

  expect(screen.getByTestId('job-state').props.children).toBe('');
});


test('stale native download API cannot start work in the previous account scope', async () => {
  mockUserId = 'user-a';
  let api: DownloadManagerApi | null = null;
  const tree = () => (
    <DownloadManagerProvider>
      <Probe onApi={(value) => { api = value; }} />
    </DownloadManagerProvider>
  );
  const view = render(tree());
  const accountAApi = api!;

  mockUserId = 'user-b';
  await act(async () => {
    view.rerender(tree());
    await Promise.resolve();
  });

  await expect(accountAApi.startDownload(
    source,
    'Old account download',
    {
      mediaId: 'movie:old-account',
      kind: 'movie',
      title: 'Old account download',
    },
  )).rejects.toThrow('Download account changed');

  const sourceModule = jest.requireMock(
    '../../playback/downloadSource',
  ) as {
    startDownloadSource: jest.Mock;
  };
  expect(sourceModule.startDownloadSource).not.toHaveBeenCalled();
});

test('account switch cancels and hides active downloads from the previous identity', async () => {
  mockUserId = 'user-a';
  let api: DownloadManagerApi | null = null;
  const renderTree = () => (
    <DownloadManagerProvider>
      <Probe onApi={(value) => { api = value; }} />
    </DownloadManagerProvider>
  );
  const view = render(renderTree());

  await act(async () => {
    await api!.startDownload(source, 'Private A Download', {
      mediaId: 'movie:a',
      kind: 'movie',
      title: 'Private A Download',
    });
  });
  const accountAScope = mockCapturedScope;
  expect(screen.getByTestId('job-state').props.children)
    .toBe('downloading:null');

  mockUserId = 'user-b';
  await act(async () => {
    view.rerender(renderTree());
    await Promise.resolve();
  });

  expect(mockCancelTask).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('job-state').props.children).toBe('');

  await act(async () => {
    await api!.startDownload(source, 'Private B Download', {
      mediaId: 'movie:b',
      kind: 'movie',
      title: 'Private B Download',
    });
  });

  expect(mockCapturedScope).not.toEqual(accountAScope);
  expect(Object.values(mockCapturedScope as Record<string, unknown>))
    .not.toContain('user-b');
});

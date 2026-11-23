import React, { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { StreamSource } from '@moviestv/core';
import { DownloadManagerProvider } from '../DownloadManagerProvider.web';
import {
  useDownloadManager,
  type DownloadManagerApi,
} from '../useDownloadManager';

let mockUserId: string | null = null;
const pendingResolvers: Array<() => void> = [];
const mockDownloadSource = jest.fn((..._args: unknown[]) => new Promise<void>((resolve) => {
  pendingResolvers.push(resolve);
}));

jest.mock('../../auth/useAccount', () => ({
  useAccount: () => ({ userId: mockUserId }),
}));

jest.mock('../../playback/downloadSource', () => ({
  downloadSource: (...args: unknown[]) => mockDownloadSource(...args),
}));

function Probe({ onApi }: { onApi(api: DownloadManagerApi): void }) {
  const api = useDownloadManager();
  useEffect(() => onApi(api), [api, onApi]);
  return (
    <Text testID="web-download-jobs">
      {api.jobs.map((job) => `${job.title}:${job.status}`).join(',')}
    </Text>
  );
}

const source: StreamSource = {
  id: 'stream-1',
  url: 'https://cdn.example/movie.mp4',
  providerId: 'provider-a',
  quality: '1080p',
};

beforeEach(() => {
  mockUserId = 'user-a';
  pendingResolvers.splice(0);
  mockDownloadSource.mockClear();
});

test('web download manager rejects oversized media identities before starting', async () => {
  let api: DownloadManagerApi | null = null;
  render(
    <DownloadManagerProvider>
      <Probe onApi={(value) => { api = value; }} />
    </DownloadManagerProvider>,
  );

  await expect(api!.startDownload(source, 'Too large', {
    mediaId: 'x'.repeat(513),
    kind: 'movie',
    title: 'Too large',
  })).rejects.toThrow('Invalid download media identity');

  expect(mockDownloadSource).not.toHaveBeenCalled();
  expect(screen.getByTestId('web-download-jobs').props.children).toBe('');
});

test('web download manager caps simultaneously active downloads', async () => {
  let api: DownloadManagerApi | null = null;
  render(
    <DownloadManagerProvider>
      <Probe onApi={(value) => { api = value; }} />
    </DownloadManagerProvider>,
  );

  const active: Promise<string>[] = [];
  await act(async () => {
    for (let index = 0; index < 10; index += 1) {
      active.push(api!.startDownload(
        { ...source, id: `stream-${index}` },
        `Movie ${index}`,
        {
          mediaId: `movie:${index}`,
          kind: 'movie',
          title: `Movie ${index}`,
        },
      ));
    }
    await Promise.resolve();
  });

  await expect(api!.startDownload(
    { ...source, id: 'stream-overflow' },
    'Overflow',
    {
      mediaId: 'movie:overflow',
      kind: 'movie',
      title: 'Overflow',
    },
  )).rejects.toThrow('Too many active downloads');

  expect(mockDownloadSource).toHaveBeenCalledTimes(10);

  await act(async () => {
    pendingResolvers.forEach((resolve) => resolve());
    await Promise.all(active);
  });
});

test('web download jobs are cleared on account switch and stale completion stays hidden', async () => {
  let api: DownloadManagerApi | null = null;
  const tree = () => (
    <DownloadManagerProvider>
      <Probe onApi={(value) => { api = value; }} />
    </DownloadManagerProvider>
  );
  const view = render(tree());

  let accountADownload!: Promise<string>;
  await act(async () => {
    accountADownload = api!.startDownload(source, 'Private A', {
      mediaId: 'movie:1',
      kind: 'movie',
      title: 'Private A',
    });
    await Promise.resolve();
  });

  expect(screen.getByTestId('web-download-jobs').props.children)
    .toBe('Private A:downloading');

  mockUserId = 'user-b';
  await act(async () => {
    view.rerender(tree());
    await Promise.resolve();
  });

  expect(screen.getByTestId('web-download-jobs').props.children).toBe('');

  await act(async () => {
    pendingResolvers[0]?.();
    await accountADownload;
  });

  expect(screen.getByTestId('web-download-jobs').props.children).toBe('');
});

test('new account can start the same media while the previous account request is stale', async () => {
  let api: DownloadManagerApi | null = null;
  const tree = () => (
    <DownloadManagerProvider>
      <Probe onApi={(value) => { api = value; }} />
    </DownloadManagerProvider>
  );
  const view = render(tree());

  let accountADownload!: Promise<string>;
  await act(async () => {
    accountADownload = api!.startDownload(source, 'Shared title', {
      mediaId: 'movie:1',
      kind: 'movie',
      title: 'Shared title',
    });
    await Promise.resolve();
  });

  mockUserId = 'user-b';
  await act(async () => {
    view.rerender(tree());
    await Promise.resolve();
  });

  let accountBDownload!: Promise<string>;
  await act(async () => {
    accountBDownload = api!.startDownload(source, 'Shared title', {
      mediaId: 'movie:1',
      kind: 'movie',
      title: 'Shared title',
    });
    await Promise.resolve();
  });

  expect(mockDownloadSource).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('web-download-jobs').props.children)
    .toBe('Shared title:downloading');

  await act(async () => {
    pendingResolvers[0]?.();
    await accountADownload;
  });
  expect(screen.getByTestId('web-download-jobs').props.children)
    .toBe('Shared title:downloading');

  await act(async () => {
    pendingResolvers[1]?.();
    await accountBDownload;
  });
  expect(screen.getByTestId('web-download-jobs').props.children)
    .toBe('Shared title:completed');
});

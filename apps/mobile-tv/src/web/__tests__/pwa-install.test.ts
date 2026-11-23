import {
  getPwaInstallSnapshot,
  registerPwaInstallLifecycle,
  requestPwaInstall,
  subscribePwaInstall,
} from '../pwaInstall';

test('captures the browser install prompt and tracks installation', async () => {
  const handlers: Record<string, (event: any) => void> = {};
  const windowObject = {
    addEventListener: (
      type: string,
      listener: (event: any) => void,
    ) => {
      handlers[type] = listener;
    },
    matchMedia: () => ({ matches: false }),
  } as unknown as Window;
  const navigatorObject = {
    userAgent: 'Mozilla/5.0 Chrome/140.0',
    platform: 'Linux armv8l',
    maxTouchPoints: 1,
  } as unknown as Navigator;
  const snapshots: Array<ReturnType<typeof getPwaInstallSnapshot>> = [];
  const unsubscribe = subscribePwaInstall((value) => {
    snapshots.push(value);
  });

  registerPwaInstallLifecycle(windowObject, navigatorObject);
  expect(getPwaInstallSnapshot()).toEqual({
    installed: false,
    promptAvailable: false,
    ios: false,
  });

  const preventDefault = jest.fn();
  const prompt = jest.fn(async () => undefined);
  handlers.beforeinstallprompt?.({
    preventDefault,
    prompt,
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  });

  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(getPwaInstallSnapshot().promptAvailable).toBe(true);

  await expect(requestPwaInstall()).resolves.toBe('accepted');
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(getPwaInstallSnapshot().promptAvailable).toBe(false);

  handlers.appinstalled?.({});
  expect(getPwaInstallSnapshot()).toEqual({
    installed: true,
    promptAvailable: false,
    ios: false,
  });
  expect(snapshots.some((value) => value.promptAvailable)).toBe(true);
  expect(snapshots.at(-1)?.installed).toBe(true);

  unsubscribe();
});

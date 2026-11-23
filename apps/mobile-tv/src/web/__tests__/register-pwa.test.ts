import { registerPwa } from '../registerPwa';

test('registers manifest metadata and service worker once', async () => {
  const appended: Array<Record<string, unknown>> = [];
  const update = jest.fn(async () => undefined);
  const register = jest.fn(async () => ({ update }));
  const document = {
    head: { appendChild: (node: unknown) => { appended.push(node as Record<string, unknown>); } },
    createElement: (tag: string) => ({ tag }),
    querySelector: () => null,
  } as unknown as Document;
  const navigator = { serviceWorker: { register } } as unknown as Navigator;

  registerPwa({ document, navigator });

  expect(appended.some((item) => item.rel === 'manifest' && item.href === '/manifest.webmanifest')).toBe(true);
  expect(appended.some(
    (item) => item.name === 'viewport'
      && item.content === 'width=device-width, initial-scale=1, viewport-fit=cover',
  )).toBe(true);
  expect(appended.some((item) => item.name === 'theme-color' && item.content === '#09090b')).toBe(true);
  expect(appended.some((item) => item.rel === 'apple-touch-icon' && item.href === '/icon-192.png')).toBe(true);
  expect(appended.some((item) => item.name === 'apple-mobile-web-app-capable' && item.content === 'yes')).toBe(true);
  expect(appended.some((item) => item.name === 'apple-mobile-web-app-status-bar-style' && item.content === 'black-translucent')).toBe(true);
  expect(appended.some((item) => item.name === 'apple-mobile-web-app-title' && item.content === 'MoviesTv-Flix')).toBe(true);
  expect(register).toHaveBeenCalledWith('/service-worker.js', {
    updateViaCache: 'none',
  });
  await Promise.resolve();
  expect(update).toHaveBeenCalledTimes(1);
});

test('is a no-op when browser globals are unavailable', () => {
  expect(() => registerPwa({})).not.toThrow();
});


test('checks for a service worker update again when the PWA returns to the foreground', async () => {
  const update = jest.fn(async () => undefined);
  const register = jest.fn(async () => ({ update }));
  let visibilityHandler: (() => void) | undefined;
  const document = {
    visibilityState: 'hidden',
    head: { appendChild: () => undefined },
    createElement: (tag: string) => ({ tag }),
    querySelector: () => ({}),
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'visibilitychange') visibilityHandler = listener;
    },
  } as unknown as Document;
  const navigator = {
    serviceWorker: { register },
  } as unknown as Navigator;

  registerPwa({ document, navigator });
  await Promise.resolve();
  await Promise.resolve();

  expect(update).toHaveBeenCalledTimes(1);
  expect(visibilityHandler).toBeDefined();

  (document as unknown as { visibilityState: string }).visibilityState = 'visible';
  visibilityHandler?.();
  await Promise.resolve();

  expect(update).toHaveBeenCalledTimes(2);
});


test('keeps foreground update retries after the initial update check fails', async () => {
  const update = jest.fn()
    .mockRejectedValueOnce(new Error('temporary network failure'))
    .mockResolvedValue(undefined);
  const register = jest.fn(async () => ({ update }));
  let visibilityHandler: (() => void) | undefined;
  let markListenerRegistered!: () => void;
  const listenerRegistered = new Promise<void>((resolve) => {
    markListenerRegistered = resolve;
  });
  const document = {
    visibilityState: 'hidden',
    head: { appendChild: () => undefined },
    createElement: (tag: string) => ({ tag }),
    querySelector: () => ({}),
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'visibilitychange') {
        visibilityHandler = listener;
        markListenerRegistered();
      }
    },
  } as unknown as Document;
  const navigator = {
    serviceWorker: { register },
  } as unknown as Navigator;

  registerPwa({ document, navigator });
  await listenerRegistered;

  expect(update).toHaveBeenCalledTimes(1);
  expect(visibilityHandler).toBeDefined();

  (document as unknown as { visibilityState: string }).visibilityState = 'visible';
  visibilityHandler?.();
  await Promise.resolve();

  expect(update).toHaveBeenCalledTimes(2);
});


test('foreground update retry is registered even while the initial update check is stalled', async () => {
  const update = jest.fn()
    .mockImplementationOnce(() => new Promise<void>(() => undefined))
    .mockResolvedValue(undefined);
  const register = jest.fn(async () => ({ update }));
  let visibilityHandler: (() => void) | undefined;
  const document = {
    visibilityState: 'hidden',
    head: { appendChild: () => undefined },
    createElement: (tag: string) => ({ tag }),
    querySelector: () => ({}),
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'visibilitychange') visibilityHandler = listener;
    },
  } as unknown as Document;
  const navigator = {
    serviceWorker: { register },
  } as unknown as Navigator;

  registerPwa({ document, navigator });
  await Promise.resolve();

  expect(update).toHaveBeenCalledTimes(1);
  expect(visibilityHandler).toBeDefined();

  (document as unknown as { visibilityState: string }).visibilityState = 'visible';
  visibilityHandler?.();
  await Promise.resolve();

  expect(update).toHaveBeenCalledTimes(2);
});


test('does not force-reload an active PWA when an updated worker takes control', async () => {
  const update = jest.fn(async () => undefined);
  const register = jest.fn(async () => ({ update }));
  const reload = jest.fn();
  const addEventListener = jest.fn();
  const document = {
    head: { appendChild: () => undefined },
    createElement: (tag: string) => ({ tag }),
    querySelector: () => ({}),
    addEventListener: () => undefined,
  } as unknown as Document;
  const navigator = {
    serviceWorker: {
      controller: {},
      register,
      addEventListener,
    },
  } as unknown as Navigator;
  const window = {
    location: { reload },
  } as unknown as Window;

  registerPwa({ document, navigator, window });
  await Promise.resolve();

  expect(addEventListener).not.toHaveBeenCalledWith(
    'controllerchange',
    expect.any(Function),
  );
  expect(reload).not.toHaveBeenCalled();
});

test('does not reload on first service worker installation', async () => {
  const update = jest.fn(async () => undefined);
  const register = jest.fn(async () => ({ update }));
  const reload = jest.fn();
  const addEventListener = jest.fn();
  const document = {
    head: { appendChild: () => undefined },
    createElement: (tag: string) => ({ tag }),
    querySelector: () => ({}),
    addEventListener: () => undefined,
  } as unknown as Document;
  const navigator = {
    serviceWorker: {
      controller: null,
      register,
      addEventListener,
    },
  } as unknown as Navigator;
  const window = {
    location: { reload },
  } as unknown as Window;

  registerPwa({ document, navigator, window });
  await Promise.resolve();

  expect(addEventListener).not.toHaveBeenCalledWith(
    'controllerchange',
    expect.any(Function),
  );
  expect(reload).not.toHaveBeenCalled();
});


test('repairs an existing viewport meta without a string content value', () => {
  const viewport: { name: string; content?: string } = {
    name: 'viewport',
  };
  const document = {
    head: { appendChild: () => undefined },
    createElement: (tag: string) => ({ tag }),
    querySelector: (selector: string) => (
      selector === 'meta[name="viewport"]'
        ? viewport
        : {}
    ),
  } as unknown as Document;

  expect(() => registerPwa({ document })).not.toThrow();
  expect(viewport.content).toBe(
    'width=device-width, initial-scale=1, viewport-fit=cover',
  );
});

test('adds viewport-fit cover to an existing Expo viewport meta tag', () => {
  const viewport = {
    name: 'viewport',
    content: 'width=device-width, initial-scale=1',
  };
  const appended: unknown[] = [];
  const document = {
    head: {
      appendChild: (node: unknown) => {
        appended.push(node);
      },
    },
    createElement: (tag: string) => ({ tag }),
    querySelector: (selector: string) => (
      selector === 'meta[name="viewport"]'
        ? viewport
        : {}
    ),
  } as unknown as Document;

  registerPwa({ document });

  expect(viewport.content).toBe(
    'width=device-width, initial-scale=1, viewport-fit=cover',
  );
  expect(appended).toEqual([]);
});

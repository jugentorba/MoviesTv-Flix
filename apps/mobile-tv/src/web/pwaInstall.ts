export type PwaInstallOutcome =
  | 'accepted'
  | 'dismissed'
  | 'installed'
  | 'unavailable';

export interface PwaInstallSnapshot {
  installed: boolean;
  promptAvailable: boolean;
  ios: boolean;
}

interface BeforeInstallPromptEventLike extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome?: string }>;
}

type Listener = (snapshot: PwaInstallSnapshot) => void;

let deferredPrompt: BeforeInstallPromptEventLike | null = null;
let installed = false;
let ios = false;
const listeners = new Set<Listener>();
const registeredTargets = new WeakSet<object>();

function browserWindow(): Window | undefined {
  const root = globalThis as typeof globalThis & { window?: Window };
  return root.window;
}

function browserNavigator(): Navigator | undefined {
  const root = globalThis as typeof globalThis & { navigator?: Navigator };
  return root.navigator;
}

function iosNavigator(navigatorObject?: Navigator): boolean {
  if (!navigatorObject) return false;
  const userAgent = navigatorObject.userAgent ?? '';
  const platform = navigatorObject.platform ?? '';
  const maxTouchPoints = navigatorObject.maxTouchPoints ?? 0;
  return /iPhone|iPad|iPod/i.test(userAgent)
    || (platform === 'MacIntel' && maxTouchPoints > 1);
}

function standaloneMode(
  windowObject?: Window,
  navigatorObject?: Navigator,
): boolean {
  const iosStandalone = Boolean(
    (navigatorObject as Navigator & { standalone?: boolean } | undefined)
      ?.standalone,
  );
  let displayModeStandalone = false;
  try {
    displayModeStandalone = Boolean(
      windowObject?.matchMedia?.('(display-mode: standalone)').matches,
    );
  } catch {
    displayModeStandalone = false;
  }
  return iosStandalone || displayModeStandalone;
}

function snapshot(): PwaInstallSnapshot {
  return {
    installed,
    promptAvailable: !installed && deferredPrompt !== null,
    ios,
  };
}

function emit(): void {
  const next = snapshot();
  for (const listener of [...listeners]) {
    try { listener(next); } catch { /* isolate install UI listeners */ }
  }
}

export function registerPwaInstallLifecycle(
  windowObject = browserWindow(),
  navigatorObject = browserNavigator(),
): void {
  if (!windowObject) return;
  if (registeredTargets.has(windowObject)) return;
  registeredTargets.add(windowObject);

  installed = standaloneMode(windowObject, navigatorObject);
  ios = iosNavigator(navigatorObject);
  if (installed) deferredPrompt = null;

  windowObject.addEventListener('beforeinstallprompt', (event) => {
    if (installed) return;
    const candidate = event as BeforeInstallPromptEventLike;
    if (
      typeof candidate.preventDefault !== 'function'
      || typeof candidate.prompt !== 'function'
      || !candidate.userChoice
    ) return;

    candidate.preventDefault();
    deferredPrompt = candidate;
    emit();
  });

  windowObject.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    emit();
  });

  emit();
}

export function getPwaInstallSnapshot(): PwaInstallSnapshot {
  if (!installed) {
    installed = standaloneMode(browserWindow(), browserNavigator());
  }
  ios = ios || iosNavigator(browserNavigator());
  if (installed) deferredPrompt = null;
  return snapshot();
}

export function subscribePwaInstall(
  listener: Listener,
): () => void {
  listeners.add(listener);
  try { listener(snapshot()); } catch { /* isolate install UI listeners */ }
  return () => {
    listeners.delete(listener);
  };
}

export async function requestPwaInstall(): Promise<PwaInstallOutcome> {
  if (installed) return 'installed';
  const prompt = deferredPrompt;
  if (!prompt) return 'unavailable';

  deferredPrompt = null;
  emit();

  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice?.outcome === 'accepted') return 'accepted';
    return 'dismissed';
  } catch {
    return 'unavailable';
  }
}

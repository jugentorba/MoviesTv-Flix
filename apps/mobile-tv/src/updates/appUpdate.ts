import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  downloadAndInstallAndroidUpdate,
  downloadIosUpdateToFiles,
} from './updateDownload';
import {
  compareVersions,
  desktopHostVersion,
  desktopReleaseEndpoint,
  installDesktopUpdate,
  isDesktopHost,
  latestDesktopRelease,
} from './desktopUpdate';

const runtimeExtra = (Constants.expoConfig?.extra ?? {}) as {
  appVersion?: unknown;
  buildNumber?: unknown;
  updateManifestUrl?: unknown;
};

const extraManifestUrl = typeof runtimeExtra.updateManifestUrl === 'string'
  ? runtimeExtra.updateManifestUrl.trim()
  : '';
const extraAppVersion = typeof runtimeExtra.appVersion === 'string'
  ? runtimeExtra.appVersion.trim()
  : '';

export const DEFAULT_UPDATE_MANIFEST_URL =
  extraManifestUrl
  || process.env.EXPO_PUBLIC_UPDATE_MANIFEST_URL?.trim()
  || 'https://main.moviestv-flix.pages.dev/api/app-update/manifest';

export const CURRENT_APP_VERSION =
  extraAppVersion
  || process.env.EXPO_PUBLIC_APP_VERSION?.trim()
  || '0.1.0';

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const extraBuildNumber = typeof runtimeExtra.buildNumber === 'number'
  ? String(runtimeExtra.buildNumber)
  : typeof runtimeExtra.buildNumber === 'string'
    ? runtimeExtra.buildNumber
    : undefined;

export const CURRENT_BUILD_NUMBER = positiveInteger(
  extraBuildNumber ?? process.env.EXPO_PUBLIC_BUILD_NUMBER,
  1,
);

export const ANDROID_PREVIEW_SIGNER_SHA256 =
  '0FD5A50BBEE30D1D3BBC7F1B5DDEE351A70C0F7BDA7F99EA17590F9311422D1D';
export const ANDROID_PACKAGE_NAME = 'com.jugentorba.moviestvflix';
export const APPLE_BUNDLE_IDENTIFIER = 'com.jugentorba.moviestvflix';

export type NativeUpdatePlatform = 'android' | 'ios' | 'android-tv' | 'tvos';

export interface NativeUpdateEntry {
  version: string;
  build: number;
  downloadUrl?: string;
  releasePageUrl?: string;
  sha256?: string;
  signingCertificateSha256?: string;
  packageName?: string;
  bundleIdentifier?: string;
  resignable?: boolean;
  releaseNotes?: string;
}

export interface UpdateManifest {
  schemaVersion: 1;
  channel: string;
  android?: NativeUpdateEntry;
  androidTv?: NativeUpdateEntry;
  ios?: NativeUpdateEntry;
  tvos?: NativeUpdateEntry;
}

export type AppUpdateResult =
  | {
      kind: 'up-to-date';
      platform: 'web' | 'desktop' | NativeUpdatePlatform;
      currentVersion: string;
      currentBuild: number | string;
      latestVersion: string;
      latestBuild: number | string;
    }
  | {
      kind: 'available';
      platform: 'web' | 'desktop' | NativeUpdatePlatform;
      currentVersion: string;
      currentBuild: number | string;
      latestVersion: string;
      latestBuild: number | string;
      downloadUrl?: string;
      releasePageUrl?: string;
      releaseNotes?: string;
      resignable?: boolean;
      sha256?: string;
    }
  | {
      kind: 'unavailable';
      platform: 'web' | 'desktop' | NativeUpdatePlatform;
      message: string;
    };

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!clean || clean.length > maxLength) return undefined;
  return clean;
}

function cleanSha256(value: unknown): string | undefined {
  const clean = cleanString(value, 128)?.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  return clean && /^[A-F0-9]{64}$/.test(clean) ? clean : undefined;
}

function cleanDownloadUrl(value: unknown): string | undefined {
  const clean = cleanString(value, 2048);
  if (!clean) return undefined;
  try {
    const url = new URL(clean);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseEntry(value: unknown): NativeUpdateEntry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const version = cleanString(record.version, 64);
  const build = typeof record.build === 'number'
    ? record.build
    : Number.parseInt(String(record.build ?? ''), 10);
  if (!version || !Number.isFinite(build) || build < 1) return undefined;

  const downloadUrl = cleanDownloadUrl(record.downloadUrl);
  const releasePageUrl = cleanDownloadUrl(record.releasePageUrl);
  const sha256 = cleanSha256(record.sha256);
  const signingCertificateSha256 = cleanSha256(
    record.signingCertificateSha256,
  );
  const releaseNotes = cleanString(record.releaseNotes, 1000);
  const packageName = cleanString(record.packageName, 160);
  const bundleIdentifier = cleanString(record.bundleIdentifier, 160);

  return {
    version,
    build: Math.floor(build),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(releasePageUrl ? { releasePageUrl } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(signingCertificateSha256 ? { signingCertificateSha256 } : {}),
    ...(packageName ? { packageName } : {}),
    ...(bundleIdentifier ? { bundleIdentifier } : {}),
    ...(record.resignable === true ? { resignable: true } : {}),
    ...(releaseNotes ? { releaseNotes } : {}),
  };
}

export function parseUpdateManifest(value: unknown): UpdateManifest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) return null;
  const channel = cleanString(record.channel, 64);
  if (!channel) return null;

  const android = parseEntry(record.android);
  const androidTv = parseEntry(record.androidTv);
  const ios = parseEntry(record.ios);
  const tvos = parseEntry(record.tvos);
  return {
    schemaVersion: 1,
    channel,
    ...(android ? { android } : {}),
    ...(androidTv ? { androidTv } : {}),
    ...(ios ? { ios } : {}),
    ...(tvos ? { tvos } : {}),
  };
}

export function isNativeUpdateNewer(
  entry: NativeUpdateEntry,
  currentBuild = CURRENT_BUILD_NUMBER,
): boolean {
  return entry.build > currentBuild;
}

export function androidUpdateSignerMatches(
  entry: NativeUpdateEntry,
): boolean {
  if (!entry.downloadUrl) return true;
  return entry.signingCertificateSha256 === ANDROID_PREVIEW_SIGNER_SHA256;
}

export function nativeUpdateIdentityMatches(
  platform: NativeUpdatePlatform,
  entry: NativeUpdateEntry,
): boolean {
  if (platform === 'android' || platform === 'android-tv') {
    return entry.packageName === ANDROID_PACKAGE_NAME;
  }
  return entry.bundleIdentifier === APPLE_BUNDLE_IDENTIFIER;
}

function currentPwaBuildId(): string | null {
  if (typeof document === 'undefined') return null;
  const node = document.querySelector(
    'meta[name="moviestv-build-id"]',
  ) as HTMLMetaElement | null;
  const value = node?.content?.trim();
  return value && /^[a-f0-9]{16}$/i.test(value) ? value.toLowerCase() : null;
}

function pwaBuildIdFromHtml(html: string): string | null {
  const match = html.match(
    /<meta\s+[^>]*name=["']moviestv-build-id["'][^>]*content=["']([a-f0-9]{16})["'][^>]*>/i,
  ) ?? html.match(
    /<meta\s+[^>]*content=["']([a-f0-9]{16})["'][^>]*name=["']moviestv-build-id["'][^>]*>/i,
  );
  return match?.[1]?.toLowerCase() ?? null;
}

async function checkPwaUpdate(
  fetcher: typeof fetch,
): Promise<AppUpdateResult> {
  const current = currentPwaBuildId();
  if (!current) {
    return {
      kind: 'unavailable',
      platform: 'web',
      message: 'Current PWA build ID is unavailable.',
    };
  }

  try {
    const response = await fetcher(
      `/?__moviestv_update_check=${Date.now()}`,
      {
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      },
    );
    if (!response.ok) {
      return {
        kind: 'unavailable',
        platform: 'web',
        message: `Update check failed (HTTP ${response.status}).`,
      };
    }
    const latest = pwaBuildIdFromHtml(await response.text());
    if (!latest) {
      return {
        kind: 'unavailable',
        platform: 'web',
        message: 'Latest PWA build ID is unavailable.',
      };
    }
    return latest === current
      ? {
          kind: 'up-to-date',
          platform: 'web',
          currentVersion: 'PWA',
          currentBuild: current,
          latestVersion: 'PWA',
          latestBuild: latest,
        }
      : {
          kind: 'available',
          platform: 'web',
          currentVersion: 'PWA',
          currentBuild: current,
          latestVersion: 'PWA',
          latestBuild: latest,
        };
  } catch {
    return {
      kind: 'unavailable',
      platform: 'web',
      message: 'Could not reach the update server.',
    };
  }
}

async function checkNativeUpdate(
  platform: NativeUpdatePlatform,
  fetcher: typeof fetch,
): Promise<AppUpdateResult> {
  try {
    const separator = DEFAULT_UPDATE_MANIFEST_URL.includes('?') ? '&' : '?';
    const response = await fetcher(
      `${DEFAULT_UPDATE_MANIFEST_URL}${separator}t=${Date.now()}`,
      {
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      },
    );
    if (!response.ok) {
      return {
        kind: 'unavailable',
        platform,
        message: `Update check failed (HTTP ${response.status}).`,
      };
    }
    const manifest = parseUpdateManifest(await response.json());
    if (!manifest) {
      return {
        kind: 'unavailable',
        platform,
        message: 'The update manifest is invalid.',
      };
    }

    const manifestKey = platform === 'android-tv'
      ? 'androidTv'
      : platform;
    const entry = manifest[manifestKey];
    if (!entry) {
      return {
        kind: 'unavailable',
        platform,
        message: 'No update channel is published for this platform yet.',
      };
    }

    if ((platform === 'android' || platform === 'android-tv')
      && !androidUpdateSignerMatches(entry)) {
      return {
        kind: 'unavailable',
        platform,
        message: 'The published APK is not on the trusted signing channel.',
      };
    }

    if (!nativeUpdateIdentityMatches(platform, entry)) {
      return {
        kind: 'unavailable',
        platform,
        message: 'The published update does not match this app identity.',
      };
    }

    if (!isNativeUpdateNewer(entry)) {
      return {
        kind: 'up-to-date',
        platform,
        currentVersion: CURRENT_APP_VERSION,
        currentBuild: CURRENT_BUILD_NUMBER,
        latestVersion: entry.version,
        latestBuild: entry.build,
      };
    }

    return {
      kind: 'available',
      platform,
      currentVersion: CURRENT_APP_VERSION,
      currentBuild: CURRENT_BUILD_NUMBER,
      latestVersion: entry.version,
      latestBuild: entry.build,
      ...(entry.downloadUrl ? { downloadUrl: entry.downloadUrl } : {}),
      ...(entry.releasePageUrl ? { releasePageUrl: entry.releasePageUrl } : {}),
      ...(entry.releaseNotes ? { releaseNotes: entry.releaseNotes } : {}),
      ...(entry.resignable ? { resignable: true } : {}),
      ...(entry.sha256 ? { sha256: entry.sha256 } : {}),
    };
  } catch {
    return {
      kind: 'unavailable',
      platform,
      message: 'Could not reach the update server.',
    };
  }
}

async function checkDesktopUpdate(
  fetcher: typeof fetch,
): Promise<AppUpdateResult> {
  const currentVersion = desktopHostVersion() ?? CURRENT_APP_VERSION;
  try {
    const response = await fetcher(desktopReleaseEndpoint(), {
      headers: {
        Accept: 'application/vnd.github+json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });
    if (!response.ok) {
      return {
        kind: 'unavailable',
        platform: 'desktop',
        message: `Update check failed (HTTP ${response.status}).`,
      };
    }
    const release = latestDesktopRelease(await response.json());
    if (!release) {
      return {
        kind: 'unavailable',
        platform: 'desktop',
        message: 'No published desktop release was found.',
      };
    }
    const order = compareVersions(release.version, currentVersion);
    if (order === null) {
      return {
        kind: 'unavailable',
        platform: 'desktop',
        message: 'The published version could not be compared.',
      };
    }
    if (order <= 0) {
      return {
        kind: 'up-to-date',
        platform: 'desktop',
        currentVersion,
        currentBuild: currentVersion,
        latestVersion: release.version,
        latestBuild: release.version,
      };
    }
    return {
      kind: 'available',
      platform: 'desktop',
      currentVersion,
      currentBuild: currentVersion,
      latestVersion: release.version,
      latestBuild: release.version,
      ...(release.downloadUrl ? { downloadUrl: release.downloadUrl } : {}),
      ...(release.releasePageUrl ? { releasePageUrl: release.releasePageUrl } : {}),
      ...(release.releaseNotes ? { releaseNotes: release.releaseNotes } : {}),
    };
  } catch {
    return {
      kind: 'unavailable',
      platform: 'desktop',
      message: 'Could not reach the update server.',
    };
  }
}

export async function checkForAppUpdate(
  fetcher: typeof fetch = fetch,
): Promise<AppUpdateResult> {
  if (Platform.OS === 'web') {
    if (isDesktopHost()) return checkDesktopUpdate(fetcher);
    return checkPwaUpdate(fetcher);
  }
  if (Platform.OS === 'android') {
    return checkNativeUpdate(Platform.isTV ? 'android-tv' : 'android', fetcher);
  }
  return checkNativeUpdate(Platform.isTV ? 'tvos' : 'ios', fetcher);
}

export type ApplyUpdateResult =
  | 'completed'
  | 'permission-required'
  | false;

export type UpdateProgressCallback = (
  progress: number | null,
) => void;

export async function applyAvailableUpdate(
  result: Extract<AppUpdateResult, { kind: 'available' }>,
  onProgress?: UpdateProgressCallback,
): Promise<ApplyUpdateResult> {
  if (result.platform === 'desktop') {
    if (!result.downloadUrl) return false;
    return installDesktopUpdate(result.downloadUrl) ? 'completed' : false;
  }

  if (result.platform === 'web') {
    if (typeof navigator === 'undefined') return false;
    try {
      const registration = await navigator.serviceWorker?.getRegistration?.();
      await registration?.update?.();
    } catch {
      // A direct network reload can still pick up the new app shell.
    }
    if (typeof window === 'undefined') return false;
    window.location.reload();
    return 'completed';
  }

  try {
    if (
      (result.platform === 'android' || result.platform === 'android-tv')
      && result.downloadUrl
    ) {
      if (
        result.sha256
        && typeof result.latestBuild === 'number'
      ) {
        const installResult = await downloadAndInstallAndroidUpdate(
          result.downloadUrl,
          result.sha256,
          result.latestBuild,
          onProgress,
        );
        return installResult === 'permission-required'
          ? 'permission-required'
          : 'completed';
      }

      const supported = await Linking.canOpenURL(result.downloadUrl);
      if (!supported) return false;
      await Linking.openURL(result.downloadUrl);
      return 'completed';
    }

    if (result.platform === 'ios' && result.downloadUrl) {
      await downloadIosUpdateToFiles(
        result.downloadUrl,
        onProgress,
      );
      return 'completed';
    }

    const targetUrl = result.downloadUrl ?? result.releasePageUrl;
    if (!targetUrl) return false;
    const supported = await Linking.canOpenURL(targetUrl);
    if (!supported) return false;
    await Linking.openURL(targetUrl);
    return 'completed';
  } catch {
    return false;
  }
}

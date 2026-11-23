/**
 * Desktop update discovery.
 *
 * The packaged app is not a service worker: it cannot pick up a new shell by
 * reloading. Its releases live on GitHub, so the check reads the latest release
 * there, compares it with the version the host reports, and hands the DMG to the
 * native installer when the user accepts.
 */

export interface DesktopRelease {
  version: string;
  downloadUrl?: string;
  releasePageUrl?: string;
  releaseNotes?: string;
}

interface GithubReleaseJson {
  tag_name?: unknown;
  html_url?: unknown;
  body?: unknown;
  assets?: unknown;
}

const GITHUB_LATEST_RELEASE =
  'https://api.github.com/repos/jugentorba/MoviesTv-Flix/releases/latest';

export function desktopReleaseEndpoint(): string {
  return GITHUB_LATEST_RELEASE;
}

export function isDesktopHost(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as { __MOVIESTV_DESKTOP__?: unknown }).__MOVIESTV_DESKTOP__);
}

/** The version the native host reports for its own bundle. */
export function desktopHostVersion(): string | null {
  if (!isDesktopHost()) return null;
  const flag = (window as {
    __MOVIESTV_DESKTOP__?: { version?: unknown };
  }).__MOVIESTV_DESKTOP__;
  const value = flag?.version;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Parses `0.7.10` into `[0, 7, 10]`; a tag may carry a leading `v`. */
export function parseVersion(value: string): number[] | null {
  const raw = value.trim().replace(/^v/i, '');
  if (!/^\d+(\.\d+)*$/.test(raw)) return null;
  return raw.split('.').map((part) => Number.parseInt(part, 10));
}

/** Negative when `a` is older, positive when newer, 0 when equal. */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function latestDesktopRelease(payload: unknown): DesktopRelease | null {
  if (!payload || typeof payload !== 'object') return null;
  const release = payload as GithubReleaseJson;
  if (typeof release.tag_name !== 'string') return null;
  const version = release.tag_name.trim().replace(/^v/i, '');
  if (!parseVersion(version)) return null;

  let downloadUrl: string | undefined;
  if (Array.isArray(release.assets)) {
    for (const asset of release.assets) {
      if (!asset || typeof asset !== 'object') continue;
      const candidate = asset as { name?: unknown; browser_download_url?: unknown };
      if (
        typeof candidate.name === 'string'
        && /-macos\.dmg$/i.test(candidate.name)
        && typeof candidate.browser_download_url === 'string'
      ) {
        downloadUrl = candidate.browser_download_url;
        break;
      }
    }
  }

  return {
    version,
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(typeof release.html_url === 'string' ? { releasePageUrl: release.html_url } : {}),
    ...(typeof release.body === 'string' && release.body.trim()
      ? { releaseNotes: release.body.trim().slice(0, 600) }
      : {}),
  };
}

/** Only GitHub-hosted DMGs may reach the native installer. */
export function isTrustedDesktopDownload(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return parsed.hostname === 'github.com'
      || parsed.hostname.endsWith('.githubusercontent.com');
  } catch {
    return false;
  }
}

export function installDesktopUpdate(url: string): boolean {
  if (!isTrustedDesktopDownload(url)) return false;
  const bridge = (window as {
    __MOVIESTV_NATIVE__?: { installUpdate?: (value: string) => void };
  }).__MOVIESTV_NATIVE__;
  if (!bridge?.installUpdate) return false;
  bridge.installUpdate(url);
  return true;
}

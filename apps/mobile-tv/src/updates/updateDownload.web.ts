function safeHttpsUrl(value: string): URL {
  const parsed = new URL(value);
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
  ) {
    throw new Error('Update download URL is not allowed');
  }
  return parsed;
}

export interface DownloadedUpdate {
  uri: string;
  fileName: string;
}

export type AndroidInstallResult =
  | 'installer-opened'
  | 'permission-required'
  | 'browser-opened';

export async function downloadIosUpdateToFiles(
  url: string,
  _onProgress?: (progress: number | null) => void,
): Promise<DownloadedUpdate> {
  const validated = safeHttpsUrl(url);
  globalThis.location?.assign?.(validated.href);
  return {
    uri: validated.href,
    fileName: 'MoviesTv-Flix-latest.ipa',
  };
}

export async function downloadAndInstallAndroidUpdate(
  url: string,
  _expectedSha256: string,
  _expectedVersionCode: number,
  _onProgress?: (progress: number | null) => void,
): Promise<AndroidInstallResult> {
  const validated = safeHttpsUrl(url);
  globalThis.location?.assign?.(validated.href);
  return 'browser-opened';
}

export async function openAndroidUpdateDownload(
  url: string,
): Promise<void> {
  const validated = safeHttpsUrl(url);
  globalThis.location?.assign?.(validated.href);
}

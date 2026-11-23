import { Linking, NativeModules, Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

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

interface AndroidPreviewUpdaterBridge {
  installVerifiedApk(
    fileUri: string,
    expectedSha256: string,
    expectedVersionCode: number,
  ): Promise<'installer-opened' | 'permission-required'>;
}

function androidPreviewUpdater(): AndroidPreviewUpdaterBridge | null {
  const bridge = NativeModules.MoviesTvFlixPreviewUpdater as
    | AndroidPreviewUpdaterBridge
    | undefined;
  return bridge?.installVerifiedApk ? bridge : null;
}

async function downloadUpdateFile(
  url: string,
  fileName: string,
  onProgress?: (progress: number | null) => void,
): Promise<DownloadedUpdate> {
  const validated = safeHttpsUrl(url);
  const directory = new Directory(Paths.document, 'updates');
  directory.create({ idempotent: true, intermediates: true });
  const file = new File(directory, fileName);
  if (file.exists) file.delete();

  const task = File.createDownloadTask(
    validated.href,
    file,
    {
      onProgress: ({ bytesWritten, totalBytes }) => {
        onProgress?.(
          totalBytes > 0
            ? Math.max(0, Math.min(1, bytesWritten / totalBytes))
            : null,
        );
      },
    },
  );
  const downloaded = await task.downloadAsync();
  if (!downloaded?.exists || (downloaded.size ?? 0) <= 0) {
    throw new Error('Update download did not produce a file');
  }
  onProgress?.(1);
  return {
    uri: downloaded.uri,
    fileName: downloaded.name,
  };
}

export async function downloadIosUpdateToFiles(
  url: string,
  onProgress?: (progress: number | null) => void,
): Promise<DownloadedUpdate> {
  if (Platform.OS !== 'ios') {
    throw new Error('IPA download is only available on iOS');
  }
  return downloadUpdateFile(
    url,
    'MoviesTv-Flix-latest.ipa',
    onProgress,
  );
}

export async function downloadAndInstallAndroidUpdate(
  url: string,
  expectedSha256: string,
  expectedVersionCode: number,
  onProgress?: (progress: number | null) => void,
): Promise<AndroidInstallResult> {
  if (Platform.OS !== 'android') {
    throw new Error('APK installation is only available on Android');
  }

  const bridge = androidPreviewUpdater();
  if (!bridge) {
    await openAndroidUpdateDownload(url);
    return 'browser-opened';
  }

  if (!/^[A-Fa-f0-9]{64}$/.test(expectedSha256.replace(/:/g, ''))) {
    throw new Error('Expected APK hash is invalid');
  }
  if (!Number.isInteger(expectedVersionCode) || expectedVersionCode <= 0) {
    throw new Error('Expected APK version is invalid');
  }

  const downloaded = await downloadUpdateFile(
    url,
    'MoviesTv-Flix-latest.apk',
    onProgress,
  );
  return bridge.installVerifiedApk(
    downloaded.uri,
    expectedSha256,
    expectedVersionCode,
  );
}

export async function openAndroidUpdateDownload(
  url: string,
): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('APK installation is only available on Android');
  }
  const validated = safeHttpsUrl(url);
  await Linking.openURL(validated.href);
}

const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('expo/config-plugins');

const PATCH_MARKER = 'MoviesTv-Flix preview updater package';
const INSTALL_PERMISSION = 'android.permission.REQUEST_INSTALL_PACKAGES';
const FILE_PROVIDER = 'androidx.core.content.FileProvider';
const PROVIDER_AUTHORITY = '${applicationId}.updates';

function normalizeUpdaterManifest(androidManifest) {
  const manifest = androidManifest?.manifest;
  const application = manifest?.application?.[0];
  if (!manifest || !application) {
    throw new Error('Unable to locate Android manifest for preview updater');
  }

  const permissions = Array.isArray(manifest['uses-permission'])
    ? manifest['uses-permission']
    : [];
  manifest['uses-permission'] = permissions;
  if (!permissions.some(
    (entry) => entry?.$?.['android:name'] === INSTALL_PERMISSION,
  )) {
    permissions.push({
      $: {
        'android:name': INSTALL_PERMISSION,
      },
    });
  }

  const providers = Array.isArray(application.provider)
    ? application.provider
    : [];
  application.provider = providers;

  const existing = providers.find(
    (entry) => entry?.$?.['android:authorities'] === PROVIDER_AUTHORITY,
  );
  const provider = existing ?? {
    $: {},
    'meta-data': [],
  };
  provider.$ = {
    ...(provider.$ ?? {}),
    'android:name': FILE_PROVIDER,
    'android:authorities': PROVIDER_AUTHORITY,
    'android:exported': 'false',
    'android:grantUriPermissions': 'true',
  };

  const metadata = Array.isArray(provider['meta-data'])
    ? provider['meta-data']
    : [];
  provider['meta-data'] = metadata;
  const pathsMetadata = metadata.find(
    (entry) => entry?.$?.['android:name'] === 'android.support.FILE_PROVIDER_PATHS',
  );
  if (pathsMetadata) {
    pathsMetadata.$ = {
      ...(pathsMetadata.$ ?? {}),
      'android:name': 'android.support.FILE_PROVIDER_PATHS',
      'android:resource': '@xml/moviestv_update_paths',
    };
  } else {
    metadata.push({
      $: {
        'android:name': 'android.support.FILE_PROVIDER_PATHS',
        'android:resource': '@xml/moviestv_update_paths',
      },
    });
  }

  if (!existing) providers.push(provider);
  return androidManifest;
}

function patchMainApplication(contents) {
  if (contents.includes(PATCH_MARKER)) return contents;

  const packagesApply = /PackageList\(this\)\.packages\.apply\s*\{/;
  if (!packagesApply.test(contents)) {
    throw new Error(
      'Unable to locate PackageList(this).packages.apply in MainApplication',
    );
  }

  return contents.replace(
    packagesApply,
    (match) => `${match}
        // ${PATCH_MARKER}
        add(MoviesTvFlixPreviewUpdaterPackage())`,
  );
}

function updateModuleSource(packageName) {
  return `package ${packageName}

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

class MoviesTvFlixPreviewUpdaterModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  companion object {
    private const val EXPECTED_PACKAGE = "com.jugentorba.moviestvflix"
    private const val EXPECTED_SIGNER =
      "0FD5A50BBEE30D1D3BBC7F1B5DDEE351A70C0F7BDA7F99EA17590F9311422D1D"
  }

  override fun getName(): String = "MoviesTvFlixPreviewUpdater"

  private fun normalizeHex(value: String): String =
    value.replace(":", "").trim().uppercase()

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(1024 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read <= 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02X".format(it) }
  }

  private fun signatureDigest(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256")
      .digest(bytes)
      .joinToString("") { "%02X".format(it) }

  @Suppress("DEPRECATION")
  private fun archivePackageInfo(file: File) =
    context.packageManager.getPackageArchiveInfo(
      file.absolutePath,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        PackageManager.GET_SIGNING_CERTIFICATES
      } else {
        PackageManager.GET_SIGNATURES
      },
    ) ?: throw IllegalArgumentException("Update APK is not a valid package")

  private fun archiveVersionCode(file: File): Long {
    val info = archivePackageInfo(file)
    if (
      info.packageName != EXPECTED_PACKAGE
      || info.packageName != context.packageName
    ) {
      throw IllegalArgumentException("Update APK package does not match this app")
    }

    val signerDigests = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val signingInfo = info.signingInfo
        ?: throw IllegalArgumentException("Update APK has no signing information")
      signingInfo.apkContentsSigners
        .map { signatureDigest(it.toByteArray()) }
    } else {
      @Suppress("DEPRECATION")
      info.signatures
        ?.map { signatureDigest(it.toByteArray()) }
        ?: emptyList()
    }

    if (signerDigests.none { normalizeHex(it) == EXPECTED_SIGNER }) {
      throw IllegalArgumentException(
        "Update APK signing certificate does not match",
      )
    }

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      info.longVersionCode
    } else {
      @Suppress("DEPRECATION")
      info.versionCode.toLong()
    }
  }

  private fun currentVersionCode(): Long {
    val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.packageManager.getPackageInfo(
        context.packageName,
        PackageManager.PackageInfoFlags.of(0),
      )
    } else {
      @Suppress("DEPRECATION")
      context.packageManager.getPackageInfo(context.packageName, 0)
    }
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      info.longVersionCode
    } else {
      @Suppress("DEPRECATION")
      info.versionCode.toLong()
    }
  }

  private fun updateFile(rawUri: String): File {
    val parsed = Uri.parse(rawUri)
    val rawPath = if (parsed.scheme == "file") parsed.path else rawUri
    if (rawPath.isNullOrBlank()) {
      throw IllegalArgumentException("Update APK path is invalid")
    }

    val file = File(rawPath).canonicalFile
    val filesRoot = context.filesDir.canonicalFile
    val cacheRoot = context.cacheDir.canonicalFile
    val allowed = file.path.startsWith(filesRoot.path + File.separator)
      || file.path.startsWith(cacheRoot.path + File.separator)
    if (!allowed) {
      throw IllegalArgumentException("Update APK is outside app storage")
    }
    if (!file.isFile || file.length() <= 0L) {
      throw IllegalArgumentException("Update APK file is missing or empty")
    }
    return file
  }

  @ReactMethod
  fun installVerifiedApk(
    fileUri: String,
    expectedSha256: String,
    expectedVersionCode: Double,
    promise: Promise,
  ) {
    try {
      val file = updateFile(fileUri)
      val expectedHash = normalizeHex(expectedSha256)
      if (!Regex("^[A-F0-9]{64}$").matches(expectedHash)) {
        throw IllegalArgumentException("Expected APK hash is invalid")
      }
      if (sha256(file) != expectedHash) {
        throw IllegalArgumentException("Downloaded APK hash does not match")
      }

      val expectedVersion = expectedVersionCode.toLong()
      val archiveVersion = archiveVersionCode(file)
      if (
        expectedVersion <= 0L
        || archiveVersion != expectedVersion
        || archiveVersion <= currentVersionCode()
      ) {
        throw IllegalArgumentException("Update APK version is not newer")
      }

      if (
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        && !context.packageManager.canRequestPackageInstalls()
      ) {
        val permissionIntent = Intent(
          Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:\${context.packageName}"),
        ).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(permissionIntent)
        promise.resolve("permission-required")
        return
      }

      val contentUri = FileProvider.getUriForFile(
        context,
        "\${context.packageName}.updates",
        file,
      )
      val installIntent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(
          contentUri,
          "application/vnd.android.package-archive",
        )
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      context.startActivity(installIntent)
      promise.resolve("installer-opened")
    } catch (error: Throwable) {
      promise.reject(
        "UPDATE_INSTALL_FAILED",
        error.message ?: "Unable to install update",
        error,
      )
    }
  }
}
`;
}

function updatePackageSource(packageName) {
  return `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class MoviesTvFlixPreviewUpdaterPackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext,
  ): List<NativeModule> = listOf(
    MoviesTvFlixPreviewUpdaterModule(reactContext),
  )

  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
`;
}

async function writeUpdaterFiles(config) {
  const packageName = config.android?.package;
  if (!packageName) {
    throw new Error('Android package is required for preview updater');
  }

  const packagePath = packageName.replace(/\./g, path.sep);
  const javaDir = path.join(
    config.modRequest.platformProjectRoot,
    'app',
    'src',
    'main',
    'java',
    packagePath,
  );
  const xmlDir = path.join(
    config.modRequest.platformProjectRoot,
    'app',
    'src',
    'main',
    'res',
    'xml',
  );

  fs.mkdirSync(javaDir, { recursive: true });
  fs.mkdirSync(xmlDir, { recursive: true });

  fs.writeFileSync(
    path.join(javaDir, 'MoviesTvFlixPreviewUpdaterModule.kt'),
    updateModuleSource(packageName),
  );
  fs.writeFileSync(
    path.join(javaDir, 'MoviesTvFlixPreviewUpdaterPackage.kt'),
    updatePackageSource(packageName),
  );
  fs.writeFileSync(
    path.join(xmlDir, 'moviestv_update_paths.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
  <files-path name="updates" path="updates/" />
  <cache-path name="update-cache" path="updates/" />
</paths>
`,
  );

  return config;
}

function withAndroidPreviewUpdater(config) {
  let next = withAndroidManifest(config, (nextConfig) => {
    nextConfig.modResults = normalizeUpdaterManifest(nextConfig.modResults);
    return nextConfig;
  });

  next = withMainApplication(next, (nextConfig) => {
    if (nextConfig.modResults.language !== 'kt') {
      throw new Error('Android preview updater requires Kotlin MainApplication');
    }
    nextConfig.modResults.contents = patchMainApplication(
      nextConfig.modResults.contents,
    );
    return nextConfig;
  });

  return withDangerousMod(next, [
    'android',
    writeUpdaterFiles,
  ]);
}

module.exports = withAndroidPreviewUpdater;
module.exports.normalizeUpdaterManifest = normalizeUpdaterManifest;
module.exports.patchMainApplication = patchMainApplication;
module.exports.updateModuleSource = updateModuleSource;

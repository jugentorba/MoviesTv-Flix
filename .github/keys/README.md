# Android preview signing key

`moviestv-preview.jks` is intentionally versioned for **preview APKs only**.

Its purpose is to keep the preview signing identity stable so a newer MoviesTv-Flix preview APK can be installed over an older preview without uninstalling the app and losing local data.

Do not use this key for Play Store or other production releases. Production signing must use a separate protected release key.

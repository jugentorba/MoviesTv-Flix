#!/bin/bash
# Packages an unsigned .ipa from a built .app bundle.
#
#   apps/mobile-tv/scripts/package-ipa.sh <path-to-.app> [output.ipa]
#
# The result is unsigned on purpose. Sign it on the device with a tool such as
# ESign, Feather, AltStore or Sideloadly, which supply their own certificate.
# An unsigned IPA cannot be installed by iOS directly, and cannot be uploaded to
# the App Store: that needs a paid Apple Developer account and notarization.
set -euo pipefail

APP="${1:-}"
OUT="${2:-MoviesTv-Flix.ipa}"

if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "usage: $0 <path-to-.app> [output.ipa]" >&2
  exit 2
fi

APP_NAME="$(basename "$APP")"
if [ "$APP_NAME" = ".app" ] || [ ! -d "$APP/Contents" ] && [ ! -f "$APP/Info.plist" ]; then
  echo "error: '$APP' does not look like an iOS app bundle" >&2
  exit 2
fi

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# The IPA layout is fixed: an unencrypted zip whose single top-level directory
# is Payload/ containing the .app.
mkdir -p "$WORK/Payload"
cp -R "$APP" "$WORK/Payload/"

# Remove signatures so the re-signing tool does not inherit our identity.
rm -rf "$WORK/Payload/$APP_NAME/_CodeSignature" \
       "$WORK/Payload/$APP_NAME/embedded.mobileprovision" \
       "$WORK/Payload/$APP_NAME/CodeResources" 2>/dev/null || true

( cd "$WORK" && zip -qry "$OUT" Payload )
if [ -f "$WORK/$OUT" ]; then
  mv "$WORK/$OUT" "$OUT"
fi

echo "built $OUT ($(du -h "$OUT" | cut -f1), unsigned)"
echo
echo "Install with a signing tool:"
echo "  ESign / Feather: copy the .ipa to the device and sign in the app"
echo "  Sideloadly / AltStore (from a Mac): signs with your Apple ID, 7-day expiry"

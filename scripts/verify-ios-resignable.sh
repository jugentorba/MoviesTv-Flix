#!/usr/bin/env bash
set -euo pipefail

IPA="${1:?usage: verify-ios-resignable.sh <ipa> [expected-build-sha]}"
EXPECTED_BUILD_SHA="${2:-}"
test -f "$IPA"
unzip -t "$IPA" >/dev/null

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -q "$IPA" -d "$WORK"

APP_COUNT="$(find "$WORK/Payload" -maxdepth 1 -type d -name '*.app' | wc -l | tr -d ' ')"
test "$APP_COUNT" -eq 1
APP="$(find "$WORK/Payload" -maxdepth 1 -type d -name '*.app' -print -quit)"

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")"
EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Info.plist")"
PLATFORM="$(/usr/libexec/PlistBuddy -c 'Print :DTPlatformName' "$APP/Info.plist")"
DEVICE_FAMILY="$(/usr/libexec/PlistBuddy -c 'Print :UIDeviceFamily' "$APP/Info.plist")"
MINIMUM_OS="$(/usr/libexec/PlistBuddy -c 'Print :MinimumOSVersion' "$APP/Info.plist")"
HTTP_MEDIA="$(/usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity:NSAllowsArbitraryLoadsForMedia' "$APP/Info.plist")"

test "$BUNDLE_ID" = 'com.jugentorba.moviestvflix'
test "$PLATFORM" = 'iphoneos'
test "$MINIMUM_OS" = '16.4'
test "$HTTP_MEDIA" = 'true'
grep -q '1' <<<"$DEVICE_FAMILY"
grep -q '2' <<<"$DEVICE_FAMILY"
if grep -q '3' <<<"$DEVICE_FAMILY"; then
  echo "Unexpected Apple TV device family in iOS preview" >&2
  exit 1
fi

test -x "$APP/$EXECUTABLE"
ARCH_INFO="$(lipo -info "$APP/$EXECUTABLE")"
grep -q 'arm64' <<<"$ARCH_INFO"
JS_BUNDLE="$(find "$APP" -type f -name 'main.jsbundle' -print -quit)"
test -n "$JS_BUNDLE"
test -s "$JS_BUNDLE"

if [ -n "$EXPECTED_BUILD_SHA" ]; then
  if ! grep -Eq '^[0-9a-fA-F]{7,40}$' <<<"$EXPECTED_BUILD_SHA"; then
    echo "Invalid expected iOS build revision" >&2
    exit 1
  fi
  if ! LC_ALL=C grep -aFq "$EXPECTED_BUILD_SHA" "$JS_BUNDLE"; then
    echo "iOS preview is missing build revision $EXPECTED_BUILD_SHA" >&2
    exit 1
  fi
fi

test ! -e "$APP/embedded.mobileprovision"
test ! -d "$APP/_CodeSignature"
test -z "$(find "$APP" -name 'embedded.mobileprovision' -print -quit)"
test -z "$(find "$APP" -type d -name '_CodeSignature' -print -quit)"
if codesign -dv --verbose=4 "$APP" >/dev/null 2>&1; then
  echo "Unexpected code signature in re-signable iOS preview" >&2
  exit 1
fi

while IFS= read -r -d '' CODE_OBJECT; do
  if codesign -dv --verbose=4 "$CODE_OBJECT" >/dev/null 2>&1; then
    echo "Unexpected nested code signature in re-signable iOS preview: $CODE_OBJECT" >&2
    exit 1
  fi
done < <(
  find "$APP" -mindepth 1 \
    \( -type d \( -name '*.framework' -o -name '*.appex' -o -name '*.xpc' \) \
       -o -type f -name '*.dylib' \) \
    -print0
)

echo "iOS re-signable IPA verified: $IPA"

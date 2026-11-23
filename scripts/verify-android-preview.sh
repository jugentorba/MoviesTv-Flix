#!/usr/bin/env bash
set -euo pipefail

APK="${1:?usage: verify-android-preview.sh <apk> [phone|tv] [expected-build-sha] [expected-signer-sha256] [expected-version-code]}"
TARGET="${2:-phone}"
EXPECTED_BUILD_SHA="${3:-}"
EXPECTED_SIGNER_SHA256="${4:-}"
EXPECTED_VERSION_CODE="${5:-}"

if [ "$TARGET" != "phone" ] && [ "$TARGET" != "tv" ]; then
  echo "Unknown Android preview target: $TARGET" >&2
  exit 1
fi

test -f "$APK"
unzip -t "$APK" >/dev/null
APK_ENTRIES="$(unzip -Z1 "$APK")"
grep -qx 'assets/index.android.bundle' <<<"$APK_ENTRIES"

if [ -n "$EXPECTED_BUILD_SHA" ]; then
  if ! grep -Eq '^[0-9a-fA-F]{7,40}$' <<<"$EXPECTED_BUILD_SHA"; then
    echo "Invalid expected Android build revision" >&2
    exit 1
  fi
  JS_BUNDLE="$(mktemp)"
  trap 'rm -f "$JS_BUNDLE"' EXIT
  unzip -p "$APK" assets/index.android.bundle > "$JS_BUNDLE"
  if ! LC_ALL=C grep -aFq "$EXPECTED_BUILD_SHA" "$JS_BUNDLE"; then
    echo "Android preview is missing build revision $EXPECTED_BUILD_SHA" >&2
    exit 1
  fi
fi

SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
test -n "$SDK_ROOT"
BUILD_TOOLS="$(python3 - "$SDK_ROOT/build-tools" <<'PY'
import os
import re
import sys

root = sys.argv[1]
candidates = [
    os.path.join(root, name)
    for name in os.listdir(root)
    if os.path.isdir(os.path.join(root, name))
]

def version_key(path):
    name = os.path.basename(path)
    numbers = tuple(int(value) for value in re.findall(r'\d+', name))
    return (numbers, name)

print(max(candidates, key=version_key) if candidates else '')
PY
)"
test -n "$BUILD_TOOLS"
test -x "$BUILD_TOOLS/apksigner"
test -x "$BUILD_TOOLS/aapt"
test -x "$BUILD_TOOLS/zipalign"

"$BUILD_TOOLS/apksigner" verify --verbose "$APK" >/dev/null
if [ -n "$EXPECTED_SIGNER_SHA256" ]; then
  EXPECTED_SIGNER_SHA256="$(tr '[:lower:]' '[:upper:]' <<<"$EXPECTED_SIGNER_SHA256" | tr -d ':[:space:]')"
  SIGNER_REPORT="$("$BUILD_TOOLS/apksigner" verify --print-certs "$APK")"
  NORMALIZED_SIGNER_REPORT="$(tr '[:lower:]' '[:upper:]' <<<"$SIGNER_REPORT" | tr -d ':[:space:]')"
  if ! grep -Fq "$EXPECTED_SIGNER_SHA256" <<<"$NORMALIZED_SIGNER_REPORT"; then
    echo "Android preview signer mismatch" >&2
    echo "$SIGNER_REPORT" >&2
    exit 1
  fi
fi
"$BUILD_TOOLS/zipalign" -c -P 16 4 "$APK" >/dev/null
BADGING="$("$BUILD_TOOLS/aapt" dump badging "$APK")"
if [ -n "$EXPECTED_VERSION_CODE" ]; then
  if ! grep -Eq "^[0-9]+$" <<<"$EXPECTED_VERSION_CODE"; then
    echo "Invalid expected Android version code" >&2
    exit 1
  fi
  grep -q "versionCode='$EXPECTED_VERSION_CODE'" <<<"$BADGING"
fi
MANIFEST_XML="$("$BUILD_TOOLS/aapt" dump xmltree "$APK" AndroidManifest.xml)"
MANIFEST_XML_FILE="$(mktemp)"
printf '%s\n' "$MANIFEST_XML" > "$MANIFEST_XML_FILE"
trap 'rm -f "${JS_BUNDLE:-}" "${MANIFEST_XML_FILE:-}"' EXIT

feature_state() {
  python3 - "$MANIFEST_XML_FILE" "$1" "$2" <<'PY'
import re
import sys
from pathlib import Path

path, feature_name, expected = sys.argv[1:]
lines = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
states = []

for index, line in enumerate(lines):
    stripped = line.lstrip()
    if not stripped.startswith("E: uses-feature"):
        continue
    indent = len(line) - len(stripped)
    block = []
    for candidate in lines[index + 1:]:
        candidate_stripped = candidate.lstrip()
        candidate_indent = len(candidate) - len(candidate_stripped)
        if candidate_stripped.startswith("E:") and candidate_indent <= indent:
            break
        block.append(candidate)
    text = "\n".join(block)
    name_match = re.search(r'android:name[^=]*="([^"]+)"', text)
    if not name_match or name_match.group(1) != feature_name:
        continue
    required_match = re.search(
        r'android:required[^=]*=.*?(0xffffffff|0x0|true|false)',
        text,
        flags=re.IGNORECASE,
    )
    if required_match is None:
        state = "true"
    else:
        raw = required_match.group(1).lower()
        state = "false" if raw in {"0x0", "false"} else "true"
    states.append(state)

if expected == "absent":
    if states:
        print(
            f"{feature_name}: expected absent, found {states}",
            file=sys.stderr,
        )
        raise SystemExit(1)
elif states != [expected]:
    print(
        f"{feature_name}: expected exactly one {expected} declaration, found {states or 'none'}",
        file=sys.stderr,
    )
    raise SystemExit(1)
PY
}

grep -q "package: name='com.jugentorba.moviestvflix'" <<<"$BADGING"
grep -q "uses-permission: name='android.permission.INTERNET'" <<<"$BADGING"
grep -q 'A: android:icon' <<<"$MANIFEST_XML"
grep -Eq 'A: android:usesCleartextTraffic.*0xffffffff' <<<"$MANIFEST_XML"

if [ "$TARGET" = "tv" ]; then
  if ! grep -q 'A: android:banner' <<<"$MANIFEST_XML"; then
    echo "Android TV preview is missing the application banner" >&2
    exit 1
  fi
  if ! grep -q "^leanback-launchable-activity:" <<<"$BADGING"; then
    echo "Android TV preview is missing the Leanback launcher activity" >&2
    exit 1
  fi
  feature_state android.software.leanback true
  feature_state android.hardware.touchscreen false
  feature_state android.hardware.faketouch false
else
  if grep -q "^leanback-launchable-activity:" <<<"$BADGING"; then
    echo "Unexpected Leanback launcher in Android phone preview" >&2
    exit 1
  fi
  # A phone build must not REQUIRE TV hardware. `@lunarr/vlc-player` declares
  # leanback as optional (required="false"), which is harmless: the APK still
  # installs on a phone. Accept absent-or-optional, reject required.
  if ! feature_state android.software.leanback absent 2>/dev/null \
    && ! feature_state android.software.leanback false 2>/dev/null; then
    echo "Android phone preview requires Android TV hardware" >&2
    exit 1
  fi
fi

echo "Android $TARGET preview verified: $APK"

#!/bin/bash
# Signs an .ipa with a distribution certificate and an Ad Hoc provisioning
# profile, so the result installs on a registered device without a signing
# service (ESign, Feather, Sideloadly).
#
#   apps/mobile-tv/scripts/sign-adhoc.sh <input.ipa> \
#     --profile <AdHoc.mobileprovision> \
#     [--identity "Apple Distribution: Name (TEAMID)"] \
#     [--device <UDID>] \
#     [--output <out.ipa>]
#
# The profile decides the bundle id: its `application-identifier` must match
# the app's `CFBundleIdentifier`. A profile for another App ID is rejected here
# instead of failing on the device with "Unable to Install".
#
# Entitlements are taken from the profile itself, which is what the device
# validates against. Nothing is fetched from the network and no credential is
# written anywhere.
set -euo pipefail

INPUT="${1:-}"
shift || true

PROFILE=""
IDENTITY=""
DEVICE_UDID=""
OUTPUT=""
APP_ID_OVERRIDE=""
DISPLAY_NAME=""

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --identity) IDENTITY="${2:-}"; shift 2 ;;
    --device) DEVICE_UDID="${2:-}"; shift 2 ;;
    --output) OUTPUT="${2:-}"; shift 2 ;;
    --app-id) APP_ID_OVERRIDE="${2:-}"; shift 2 ;;
    --display-name) DISPLAY_NAME="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$INPUT" ] || [ -z "$PROFILE" ]; then
  echo "usage: $0 <input.ipa> --profile <AdHoc.mobileprovision> [--identity <name>] [--device <UDID>] [--app-id <bundle-id>] [--display-name <label>] [--output <out.ipa>]" >&2
  exit 2
fi
for path in "$INPUT" "$PROFILE"; do
  [ -f "$path" ] || { echo "error: no such file: $path" >&2; exit 2; }
done

if [ -z "$IDENTITY" ]; then
  IDENTITY="$(/usr/bin/security find-identity -v -p codesigning 2>/dev/null \
    | /usr/bin/awk -F'"' '/Apple Distribution/ { print $2; exit }')"
fi
if [ -z "$IDENTITY" ]; then
  echo "error: no 'Apple Distribution' identity in the keychain; pass --identity" >&2
  exit 2
fi
if ! /usr/bin/security find-identity -v -p codesigning | /usr/bin/grep -Fq "\"$IDENTITY\""; then
  echo "error: identity not found in the keychain: $IDENTITY" >&2
  exit 2
fi

WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

/usr/bin/unzip -q "$INPUT" -d "$WORK"
APP="$(/usr/bin/find "$WORK/Payload" -maxdepth 1 -name '*.app' -print -quit)"
if [ -z "$APP" ]; then
  echo "error: no Payload/*.app in $INPUT" >&2
  exit 2
fi
if [ -n "$DISPLAY_NAME" ]; then
  # Only the label changes, so both the old and the retargeted build stay
  # distinguishable on the home screen.
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $DISPLAY_NAME" "$APP/Info.plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string $DISPLAY_NAME" "$APP/Info.plist"
fi

/usr/bin/security cms -D -i "$PROFILE" > "$WORK/profile.plist"
PROFILE_APP_ID="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$WORK/profile.plist" 2>/dev/null || true)"
PROFILE_NAME="$(/usr/libexec/PlistBuddy -c 'Print :Name' "$WORK/profile.plist" 2>/dev/null || true)"
PROFILE_EXPIRY="$(/usr/libexec/PlistBuddy -c 'Print :ExpirationDate' "$WORK/profile.plist" 2>/dev/null || true)"
APP_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")"
if [ -n "$APP_ID_OVERRIDE" ] && [ "$APP_ID_OVERRIDE" != "$APP_ID" ]; then
  # A profile only installs apps whose bundle id it names. Retargeting makes the
  # app a *different* app on the device: its own container and its own data.
  echo "warning: retargeting $APP_ID -> $APP_ID_OVERRIDE (separate app and data on the device)" >&2
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $APP_ID_OVERRIDE" "$APP/Info.plist"
  APP_ID="$APP_ID_OVERRIDE"
fi
APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Info.plist" 2>/dev/null || echo '?')"

if [ -z "$PROFILE_APP_ID" ]; then
  echo "error: $PROFILE has no application-identifier; is it an iOS profile?" >&2
  exit 2
fi

# A profile for another App ID signs fine but never installs, so say it here.
# A wildcard profile (`TEAM.*`) accepts any bundle id in the team, which is what
# signing services hand out; the entitlements are rewritten to match the app.
PROFILE_BUNDLE_ID="${PROFILE_APP_ID#*.}"
if [ "$PROFILE_BUNDLE_ID" != "*" ] && [ "$PROFILE_BUNDLE_ID" != "$APP_ID" ]; then
  echo "error: profile App ID is '$PROFILE_BUNDLE_ID' but the app is '$APP_ID'." >&2
  echo "       Create an Ad Hoc profile for '$APP_ID' on developer.apple.com" >&2
  echo "       (Certificates, Identifiers & Profiles -> Profiles -> + -> Ad Hoc)." >&2
  exit 2
fi

if [ -n "$DEVICE_UDID" ]; then
  /usr/libexec/PlistBuddy -c 'Print :ProvisionedDevices' "$WORK/profile.plist" >/dev/null 2>&1 || {
    echo "error: the profile has no device list; only Ad Hoc/Development profiles install on a device" >&2
    exit 2
  }
  if ! /usr/libexec/PlistBuddy -c 'Print :ProvisionedDevices' "$WORK/profile.plist" | /usr/bin/grep -q "$DEVICE_UDID"; then
    echo "error: device $DEVICE_UDID is not in $PROFILE_NAME" >&2
    exit 2
  fi
fi

# The profile's entitlements are the contract the device checks against. Copy
# the dict as XML so codesign embeds exactly what Apple signed.
/usr/bin/python3 - "$WORK/profile.plist" "$WORK/entitlements.plist" "$APP_ID" <<'PY'
import plistlib
import sys

with open(sys.argv[1], 'rb') as handle:
    profile = plistlib.load(handle)
entitlements = profile.get('Entitlements') or {}
if not isinstance(entitlements, dict) or not entitlements:
    sys.exit('profile has no Entitlements dict')

# `application-identifier` must name the signed app, even when the profile is a
# wildcard. The team prefix is the part before the first dot.
app_id = sys.argv[3]
team = entitlements.get('com.apple.developer.team-identifier')
if not team:
    team = (entitlements.get('application-identifier') or '').split('.', 1)[0]
entitlements['application-identifier'] = f'{team}.{app_id}'
kv = entitlements.get('com.apple.developer.ubiquity-kvstore-identifier')
if isinstance(kv, str) and kv.endswith('.*'):
    entitlements['com.apple.developer.ubiquity-kvstore-identifier'] = f'{team}.{app_id}'

with open(sys.argv[2], 'wb') as handle:
    plistlib.dump(entitlements, handle, fmt=plistlib.FMT_XML)
PY

echo "signing $APP_ID $APP_VERSION"
echo "  identity: $IDENTITY"
echo "  profile:  ${PROFILE_NAME:-unknown} (expires ${PROFILE_EXPIRY:-unknown})"

# Replace whatever signature the build produced.
/usr/bin/find "$APP" -type d -name '_CodeSignature' -prune -exec /bin/rm -rf {} + 2>/dev/null || true
/bin/rm -f "$APP/embedded.mobileprovision" "$APP/CodeResources"
/bin/cp "$PROFILE" "$APP/embedded.mobileprovision"

# Inside out: nested code must be signed before its container. Frameworks get
# no entitlements of their own, the app gets the profile's.
if [ -d "$APP/Frameworks" ]; then
  while IFS= read -r nested; do
    /usr/bin/codesign --force --timestamp=none --sign "$IDENTITY" "$nested" >/dev/null 2>&1
  done < <(/usr/bin/find "$APP/Frameworks" -depth \( -name '*.framework' -o -name '*.dylib' -o -name '*.appex' \) -print)
fi

/usr/bin/codesign \
  --force \
  --timestamp=none \
  --generate-entitlement-der \
  --sign "$IDENTITY" \
  --entitlements "$WORK/entitlements.plist" \
  "$APP" >/dev/null 2>&1

/usr/bin/codesign --verify --deep --strict "$APP"
EMBEDDED_APP_ID="$(/usr/bin/codesign -d --entitlements :- "$APP" 2>/dev/null \
  | /usr/bin/plutil -extract application-identifier raw - 2>/dev/null || true)"
EXPECTED_APP_ID="${PROFILE_APP_ID%%.*}.$APP_ID"
if [ "$EMBEDDED_APP_ID" != "$EXPECTED_APP_ID" ]; then
  echo "error: signed app carries '$EMBEDDED_APP_ID', expected '$EXPECTED_APP_ID'" >&2
  exit 1
fi

if [ -z "$OUTPUT" ]; then
  OUTPUT="$(/usr/bin/dirname "$INPUT")/$(/usr/bin/basename "$INPUT" .ipa)-adhoc.ipa"
fi
/bin/rm -f "$OUTPUT"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$WORK/Payload" "$OUTPUT"

echo "built $OUTPUT ($(/usr/bin/du -h "$OUTPUT" | /usr/bin/cut -f1))"
echo
echo "Install (device must be listed in the profile):"
echo "  DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \\"
echo "    xcrun devicectl device install app --device ${DEVICE_UDID:-<UDID>} <path-to-.app>"
echo "  or copy the .ipa to the phone and install it with ESign/Feather"

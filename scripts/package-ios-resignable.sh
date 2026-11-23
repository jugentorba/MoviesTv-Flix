#!/usr/bin/env bash
set -euo pipefail

APP="${1:?usage: package-ios-resignable.sh <app> <output-ipa>}"
OUT="${2:?usage: package-ios-resignable.sh <app> <output-ipa>}"

test -d "$APP"
OUT_ABS="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$OUT")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/Payload" "$(dirname "$OUT_ABS")"
rm -f "$OUT_ABS"
cp -R "$APP" "$WORK/Payload/MoviesTv-Flix.app"
BUNDLE="$WORK/Payload/MoviesTv-Flix.app"

# A re-signable archive must not inherit signing state from a cached/vendor
# framework or an accidentally signed build product. Remove Mach-O signatures
# first, then delete provisioning/signature resource artifacts recursively.
while IFS= read -r -d '' CODE_OBJECT; do
  if codesign -dv --verbose=4 "$CODE_OBJECT" >/dev/null 2>&1; then
    codesign --remove-signature "$CODE_OBJECT"
  fi
done < <(
  find "$BUNDLE" -mindepth 1 \
    \( -type d \( -name '*.framework' -o -name '*.appex' -o -name '*.xpc' \) \
       -o -type f -name '*.dylib' \) \
    -print0
)

if codesign -dv --verbose=4 "$BUNDLE" >/dev/null 2>&1; then
  codesign --remove-signature "$BUNDLE"
fi

find "$BUNDLE" -type f -name 'embedded.mobileprovision' -delete
find "$BUNDLE" -type d -name '_CodeSignature' -prune -exec rm -rf {} +

(
  cd "$WORK"
  /usr/bin/zip -qry -y "$OUT_ABS" Payload
)

test -f "$OUT_ABS"
echo "Packaged re-signable IPA: $OUT_ABS"

#!/bin/bash
# Builds the MoviesTv-Flix macOS app and a DMG.
#
#   apps/desktop-mac/build.sh [--dmg] [--arch arm64|x86_64|universal]
#
# Output:
#   apps/desktop-mac/build/MoviesTv-Flix.app
#   apps/desktop-mac/build/MoviesTv-Flix.dmg        (with --dmg)
#
# Requires: Xcode command line tools. libVLC is loaded at runtime from
# /Applications/VLC.app (or MTFLIX_VLC_LIB); the build does not link against it,
# so the DMG stays small and the player binary is the user's installed VLC.
set -euo pipefail

cd "$(dirname "$0")"

APP="MoviesTv-Flix"
OUT="build"
BUNDLE="$OUT/$APP.app"
WANT_DMG=0
VERSION=""
ARCH="$(uname -m)"

while [ $# -gt 0 ]; do
  case "$1" in
    --dmg) WANT_DMG=1 ;;
    --arch) shift; ARCH="${1:-$(uname -m)}" ;;
    --version) shift; VERSION="${1:-}" ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

rm -rf "$BUNDLE" "$OUT/$APP.dmg"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"

# The web build ships inside the app so the DMG works without a deploy.
WEB_DIST="../mobile-tv/dist"
if [ -f "$WEB_DIST/index.html" ]; then
  rm -rf "$BUNDLE/Contents/Resources/Web"
  mkdir -p "$BUNDLE/Contents/Resources/Web"
  # `cp -R src/. dest` copies contents, including dotfiles.
  cp -R "$WEB_DIST/." "$BUNDLE/Contents/Resources/Web/"
  echo "bundled web build: $(du -sh "$BUNDLE/Contents/Resources/Web" | awk '{print $1}')"
else
  echo "warning: no web build at $WEB_DIST — the app will use the live site" >&2
fi

# libvlc.dylib depends on @rpath/libvlccore.dylib and ships without its own
# LC_RPATH, so the host binary must provide one. These are the install locations
# the loader tries (VLC.app, Homebrew on both prefixes, /usr/local).
VLC_RPATHS=(
  "/Applications/VLC.app/Contents/MacOS/lib"
  "/opt/homebrew/lib"
  "/usr/local/lib"
)

build_arch() {
  local rpath_flags=()
  for dir in "${VLC_RPATHS[@]}"; do
    rpath_flags+=(-Xlinker -rpath -Xlinker "$dir")
  done
  swiftc -O -whole-module-optimization "main.swift" -o "$BUNDLE/Contents/MacOS/$APP-$1" \
    -target "$1-apple-macos12.0" "${rpath_flags[@]}"
}

case "$ARCH" in
  universal)
    build_arch arm64
    build_arch x86_64
    lipo -create "$BUNDLE/Contents/MacOS/$APP-arm64" "$BUNDLE/Contents/MacOS/$APP-x86_64" \
      -output "$BUNDLE/Contents/MacOS/$APP"
    rm -f "$BUNDLE/Contents/MacOS/$APP-arm64" "$BUNDLE/Contents/MacOS/$APP-x86_64"
    ;;
  *)
    build_arch "$ARCH"
    mv "$BUNDLE/Contents/MacOS/$APP-$ARCH" "$BUNDLE/Contents/MacOS/$APP"
    ;;
esac

# The app icon comes from the mobile artwork, so there is one source of truth.
# Without this the bundle declares no icon and macOS shows the generic app icon.
ICON_SOURCE="../mobile-tv/assets/icon.png"
if [ -f "$ICON_SOURCE" ]; then
  ICONSET="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$ICON_SOURCE" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z "$double" "$double" "$ICON_SOURCE" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$BUNDLE/Contents/Resources/AppIcon.icns"
  rm -rf "$(dirname "$ICONSET")"
  echo "app icon: $(du -h "$BUNDLE/Contents/Resources/AppIcon.icns" | cut -f1)"
else
  echo "warning: no icon at $ICON_SOURCE — the app will use the generic icon" >&2
fi

cp Info.plist "$BUNDLE/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable $APP" "$BUNDLE/Contents/Info.plist" >/dev/null
if [ -n "$VERSION" ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$BUNDLE/Contents/Info.plist" >/dev/null
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$BUNDLE/Contents/Info.plist" >/dev/null
  echo "version $VERSION"
fi

# Ad-hoc signature: enough to run locally. Distribution needs a Developer ID.
codesign --force --deep --sign - "$BUNDLE" >/dev/null

echo "built $BUNDLE"

if [ "$WANT_DMG" = "1" ]; then
  rm -rf "$OUT/dmg-stage"
  mkdir -p "$OUT/dmg-stage"
  cp -R "$BUNDLE" "$OUT/dmg-stage/"
  ln -s /Applications "$OUT/dmg-stage/Applications"
  hdiutil create -volname "$APP" -srcfolder "$OUT/dmg-stage" -ov -format UDZO \
    "$OUT/$APP.dmg" >/dev/null
  rm -rf "$OUT/dmg-stage"
  echo "built $OUT/$APP.dmg"
fi

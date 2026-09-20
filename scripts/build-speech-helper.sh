#!/usr/bin/env bash
#
# Compiles the macOS on-device speech helper (SFSpeechRecognizer) to a universal
# (x64 + arm64) binary that electron-builder bundles into the app via
# `mac.extraResources`. It is the desktop leg of the DayGlanceNative speech
# contract — voice input without an AI provider — see electron/speech.ts.
#
# Output: electron/native/speech-helper/build/dayglance-speech-helper
#
# No-op (exit 0) on non-macOS hosts or when `swiftc` is unavailable, so the rest
# of the build pipeline still runs on Linux/Windows/CI — the helper is macOS-only
# and is only required when producing a macOS (dmg/zip/mas) build.

set -euo pipefail

HELPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../electron/native/speech-helper" && pwd)"
SRC="$HELPER_DIR/Sources/main.swift"
OUT_DIR="$HELPER_DIR/build"
OUT="$OUT_DIR/dayglance-speech-helper"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "build-speech-helper: skipping (not macOS)"
  exit 0
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "build-speech-helper: skipping (swiftc not found — install Xcode command line tools)"
  exit 0
fi

mkdir -p "$OUT_DIR"

echo "build-speech-helper: compiling universal binary → $OUT"
swiftc -O \
  -framework Speech -framework AVFoundation -framework Foundation \
  -target arm64-apple-macos11.0 \
  -o "$OUT_DIR/dayglance-speech-helper-arm64" \
  "$SRC"

swiftc -O \
  -framework Speech -framework AVFoundation -framework Foundation \
  -target x86_64-apple-macos11.0 \
  -o "$OUT_DIR/dayglance-speech-helper-x64" \
  "$SRC"

lipo -create \
  "$OUT_DIR/dayglance-speech-helper-arm64" \
  "$OUT_DIR/dayglance-speech-helper-x64" \
  -output "$OUT"

rm -f "$OUT_DIR/dayglance-speech-helper-arm64" "$OUT_DIR/dayglance-speech-helper-x64"
chmod +x "$OUT"

echo "build-speech-helper: done"
lipo -info "$OUT" || true

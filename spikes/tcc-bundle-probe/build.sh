#!/usr/bin/env bash
# THROWAWAY SPIKE (#27). Builds "Recap TCC Probe.app" into dist/ and signs it
# with the requested identity. Every invocation bakes a fresh nonce into the
# binary so every build has a new CDHash — a rebuild must look like a
# "different program" to TCC, or the experiment measures nothing.
#
# usage: ./build.sh adhoc                   # codesign -s -
#        ./build.sh selfsigned [cert name]  # default "Recap Probe Signing"
#        ./build.sh dev [identity]          # default "Apple Development"
set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:?usage: build.sh adhoc|selfsigned|dev [identity]}"
case "$MODE" in
  adhoc)      IDENTITY="-" ;;
  selfsigned) IDENTITY="${2:-Recap Probe Signing}" ;;
  dev)        IDENTITY="${2:-Apple Development}" ;;
  *) echo "unknown mode '$MODE'" >&2; exit 2 ;;
esac

BUILD_ID="$(uuidgen)"
cat > Sources/RecapTCCProbe/BuildNonce.swift <<EOF
// Overwritten by build.sh on every build (fresh UUID → fresh binary → fresh
// CDHash). A rebuild must look like a "different program" to TCC, or the
// experiment measures nothing.
let buildNonce = "$BUILD_ID"
EOF

swift build -c release 1>&2

APP="dist/Recap TCC Probe.app"
BIN=".build/release/RecapTCCProbe"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp Info.plist "$APP/Contents/Info.plist"
cp "$BIN" "$APP/Contents/MacOS/RecapTCCProbe"
# Second copy under its own name: the "sidecar" child the app spawns (measurement 7).
cp "$BIN" "$APP/Contents/MacOS/recap-probe-helper"
cat > "$APP/Contents/Resources/build-info.json" <<EOF
{"buildId": "$BUILD_ID", "builtAt": "$(date -u +%FT%TZ)", "signMode": "$MODE"}
EOF

# Inside-out: nested helper first, then the bundle (which signs the main binary).
codesign --force --sign "$IDENTITY" "$APP/Contents/MacOS/recap-probe-helper"
codesign --force --sign "$IDENTITY" "$APP"
codesign --verify --strict "$APP"

echo
echo "Built:  $PWD/$APP"
echo "Mode:   $MODE (identity: $IDENTITY)"
echo "Build:  $BUILD_ID"
codesign -dvv "$APP" 2>&1 | grep -E '^(Identifier|TeamIdentifier|Authority|Signature|CDHash)' || true

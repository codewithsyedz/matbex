#!/usr/bin/env bash
# Generates a release keystore for signing the Matbex Android APK / AAB.
# Run once per project, then store the resulting file + passwords securely.
#
# Usage:
#   ./scripts/generate-android-keystore.sh
#
# Env vars (optional, prompted if missing):
#   KEYSTORE_PATH        default: ./release.keystore
#   KEYSTORE_PASSWORD    keystore password (min 6 chars)
#   KEY_ALIAS            default: matbex
#   KEY_PASSWORD         alias password (defaults to KEYSTORE_PASSWORD)
#   KEY_DNAME            default: "CN=Matbex, O=Matbex, C=SA"

set -euo pipefail

KEYSTORE_PATH="${KEYSTORE_PATH:-./release.keystore}"
KEY_ALIAS="${KEY_ALIAS:-matbex}"
KEY_DNAME="${KEY_DNAME:-CN=Matbex, O=Matbex, C=SA}"

if [[ -z "${KEYSTORE_PASSWORD:-}" ]]; then
  read -rsp "Keystore password (min 6 chars): " KEYSTORE_PASSWORD
  echo
fi
KEY_PASSWORD="${KEY_PASSWORD:-$KEYSTORE_PASSWORD}"

if [[ -f "$KEYSTORE_PATH" ]]; then
  echo "Refusing to overwrite existing keystore at $KEYSTORE_PATH" >&2
  exit 1
fi

keytool -genkeypair -v \
  -keystore "$KEYSTORE_PATH" \
  -alias "$KEY_ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$KEYSTORE_PASSWORD" \
  -keypass "$KEY_PASSWORD" \
  -dname "$KEY_DNAME"

echo
echo "Keystore created: $KEYSTORE_PATH"
echo "Alias:            $KEY_ALIAS"
echo
echo "Base64 (paste into ANDROID_KEYSTORE_BASE64 GitHub secret):"
base64 -w0 "$KEYSTORE_PATH" 2>/dev/null || base64 "$KEYSTORE_PATH"
echo
echo "Store these values safely — losing them means you cannot ship updates."
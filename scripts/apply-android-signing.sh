#!/usr/bin/env bash
# Injects a signing config into android/app/build.gradle so that
# `./gradlew assembleRelease` produces a signed APK using either:
#   - keystore.properties at the project root (local dev), OR
#   - environment variables (CI):
#       ANDROID_KEYSTORE_FILE       absolute path to .keystore
#       ANDROID_KEYSTORE_PASSWORD
#       ANDROID_KEY_ALIAS
#       ANDROID_KEY_PASSWORD
#
# Idempotent: safe to run after every `npx cap sync android`.

set -euo pipefail

GRADLE_FILE="android/app/build.gradle"

if [[ ! -f "$GRADLE_FILE" ]]; then
  echo "android/app/build.gradle not found. Run \`npx cap add android && npx cap sync android\` first." >&2
  exit 1
fi

if grep -q "// >>> matbex-signing" "$GRADLE_FILE"; then
  echo "Signing block already present — skipping."
  exit 0
fi

# Insert signingConfigs + buildTypes.release.signingConfig before the closing brace of `android { ... }`.
python3 - "$GRADLE_FILE" <<'PY'
import re, sys, pathlib

path = pathlib.Path(sys.argv[1])
src = path.read_text()

block = r"""
    // >>> matbex-signing (auto-injected, do not remove)
    signingConfigs {
        release {
            def ksPropsFile = rootProject.file("../keystore.properties")
            if (ksPropsFile.exists()) {
                def ksProps = new Properties()
                ksPropsFile.withInputStream { ksProps.load(it) }
                storeFile file(ksProps['storeFile'])
                storePassword ksProps['storePassword']
                keyAlias ksProps['keyAlias']
                keyPassword ksProps['keyPassword']
            } else if (System.getenv("ANDROID_KEYSTORE_FILE")) {
                storeFile file(System.getenv("ANDROID_KEYSTORE_FILE"))
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            if (signingConfigs.release.storeFile != null) {
                signingConfig signingConfigs.release
            }
        }
    }
    // <<< matbex-signing
"""

# Find the `android { ... }` block and insert before its closing brace.
m = re.search(r"\bandroid\s*\{", src)
if not m:
    sys.exit("Could not locate `android { ... }` block in build.gradle")

depth = 0
i = m.end() - 1  # the opening brace
while i < len(src):
    c = src[i]
    if c == "{":
        depth += 1
    elif c == "}":
        depth -= 1
        if depth == 0:
            break
    i += 1

if depth != 0:
    sys.exit("Could not find matching closing brace for android { ... }")

new_src = src[:i] + block + src[i:]
path.write_text(new_src)
print(f"Injected signing config into {path}")
PY
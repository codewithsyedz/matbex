#!/usr/bin/env bash
# Bumps versionCode (+1) and versionName in android/app/build.gradle.
#
# Usage:
#   bash scripts/bump-android-version.sh              # patch bump (1.2.3 -> 1.2.4)
#   bash scripts/bump-android-version.sh minor        # 1.2.3 -> 1.3.0
#   bash scripts/bump-android-version.sh major        # 1.2.3 -> 2.0.0
#   bash scripts/bump-android-version.sh 1.4.2        # explicit versionName
#
# Always increments versionCode by 1 (Play Store requires monotonic increase).
# Idempotent within a single CI run via MATBEX_SKIP_BUMP=1.

set -euo pipefail

if [[ "${MATBEX_SKIP_BUMP:-0}" == "1" ]]; then
  echo "MATBEX_SKIP_BUMP=1 — skipping version bump."
  exit 0
fi

GRADLE_FILE="android/app/build.gradle"

if [[ ! -f "$GRADLE_FILE" ]]; then
  echo "android/app/build.gradle not found. Run \`npx cap add android && npx cap sync android\` first." >&2
  exit 1
fi

MODE="${1:-patch}"

python3 - "$GRADLE_FILE" "$MODE" <<'PY'
import re, sys, pathlib

path = pathlib.Path(sys.argv[1])
mode = sys.argv[2]
src = path.read_text()

code_m = re.search(r"versionCode\s+(\d+)", src)
name_m = re.search(r'versionName\s+"([^"]+)"', src)
if not code_m or not name_m:
    sys.exit("Could not locate versionCode/versionName in build.gradle")

old_code = int(code_m.group(1))
old_name = name_m.group(1)
new_code = old_code + 1

if re.fullmatch(r"\d+\.\d+\.\d+", mode):
    new_name = mode
else:
    parts = old_name.split(".")
    while len(parts) < 3:
        parts.append("0")
    try:
        major, minor, patch = (int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError:
        sys.exit(f"Cannot parse semver from versionName \"{old_name}\"")
    if mode == "major":
        major, minor, patch = major + 1, 0, 0
    elif mode == "minor":
        minor, patch = minor + 1, 0
    elif mode == "patch":
        patch += 1
    else:
        sys.exit(f"Unknown bump mode: {mode}")
    new_name = f"{major}.{minor}.{patch}"

src = re.sub(r"versionCode\s+\d+", f"versionCode {new_code}", src, count=1)
src = re.sub(r'versionName\s+"[^"]+"', f'versionName "{new_name}"', src, count=1)
path.write_text(src)

print(f"Bumped versionCode {old_code} -> {new_code}")
print(f"Bumped versionName {old_name} -> {new_name}")
PY
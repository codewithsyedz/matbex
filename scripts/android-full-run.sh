#!/usr/bin/env bash
# Matbex — End-to-end Android build runner.
# 1. Runs android-doctor.sh to validate the toolchain.
# 2. Ensures the Android platform folder exists (adds it if missing).
# 3. Runs the full android build → sync → sign → deploy pipeline.
#
# Usage: npm run android:full

set -euo pipefail

BOLD=$'\033[1m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'
RESET=$'\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ---------- 1. Doctor ----------
printf "${BOLD}Step 1/3 — running Android doctor…${RESET}\n"
if ! bash "$SCRIPT_DIR/android-doctor.sh"; then
  printf "\n${RED}Android doctor failed.${RESET} Fix the issues above, then re-run ${BOLD}npm run android:full${RESET}.\n"
  exit 1
fi
printf "${GREEN}Doctor passed.${RESET}\n\n"

# ---------- 2. Ensure Android platform ----------
printf "${BOLD}Step 2/3 — checking Android platform…${RESET}\n"
if [[ -d "android" && -f "android/gradlew" ]]; then
  printf "${GREEN}android/ folder already present.${RESET}\n\n"
else
  printf "${YELLOW}android/ folder missing — adding Android platform…${RESET}\n"
  npx cap add android
  printf "${GREEN}Android platform added.${RESET}\n\n"
fi

# ---------- 3. Build, sync, sign, run ----------
printf "${BOLD}Step 3/3 — building and deploying…${RESET}\n"
npm run android

#!/usr/bin/env bash
# Matbex — Android environment doctor.
# Verifies that all toolchain prerequisites for building the Android app are
# present and correctly configured. Exits non-zero if anything critical is
# missing, and prints actionable fixes for every failure.
#
# Usage: npm run android:doctor

set -u

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
RESET=$'\033[0m'

FAILED=0
WARNED=0

pass() { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
warn() { printf "  ${YELLOW}!${RESET} %s\n" "$1"; WARNED=$((WARNED+1)); }
fail() {
  printf "  ${RED}✗${RESET} %s\n" "$1"
  if [[ -n "${2:-}" ]]; then
    printf "    ${DIM}fix:${RESET} %s\n" "$2"
  fi
  FAILED=$((FAILED+1))
}
section() { printf "\n${BOLD}%s${RESET}\n" "$1"; }

version_ge() {
  # version_ge "20.5.0" "20.0.0" -> true
  [[ "$(printf '%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]
}

printf "${BOLD}Matbex Android Doctor${RESET}\n"
printf "${DIM}Checking your local toolchain…${RESET}\n"

# ---------- Node.js ----------
section "Node.js"
if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node -v | sed 's/^v//')"
  if version_ge "$NODE_VER" "20.0.0"; then
    pass "node $NODE_VER"
  else
    fail "node $NODE_VER (need >= 20.x)" "Install Node 20 LTS via nvm: 'nvm install 20 && nvm use 20'"
  fi
else
  fail "node not found" "Install Node 20 LTS from https://nodejs.org or via nvm"
fi

if command -v npm >/dev/null 2>&1; then
  pass "npm $(npm -v)"
else
  fail "npm not found" "Reinstall Node.js — npm ships with it"
fi

# ---------- Java / JDK ----------
section "Java (JDK 21)"
if command -v java >/dev/null 2>&1; then
  JAVA_VER_RAW="$(java -version 2>&1 | head -n1)"
  JAVA_MAJOR="$(echo "$JAVA_VER_RAW" | sed -E 's/.*"([0-9]+)\.?.*/\1/')"
  if [[ "$JAVA_MAJOR" == "21" ]]; then
    pass "java 21 detected ($JAVA_VER_RAW)"
  else
    fail "java major version is $JAVA_MAJOR (need 21)" "Install Temurin 21: 'brew install --cask temurin@21' (macOS) or apt 'openjdk-21-jdk' (Linux)"
  fi
else
  fail "java not found" "Install JDK 21 (Temurin): https://adoptium.net"
fi

if [[ -n "${JAVA_HOME:-}" ]]; then
  if [[ -d "$JAVA_HOME" ]]; then
    pass "JAVA_HOME=$JAVA_HOME"
  else
    fail "JAVA_HOME is set but path does not exist: $JAVA_HOME" "Update JAVA_HOME in your shell profile to a real JDK 21 path"
  fi
else
  warn "JAVA_HOME is not set (Gradle may still work, but recommended)"
  printf "    ${DIM}fix:${RESET} export JAVA_HOME=\"\$(/usr/libexec/java_home -v 21)\"   # macOS\n"
fi

# ---------- ANDROID_HOME / SDK ----------
section "Android SDK"
SDK_DIR="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -n "$SDK_DIR" ]]; then
  if [[ -d "$SDK_DIR" ]]; then
    pass "ANDROID_HOME=$SDK_DIR"
  else
    fail "ANDROID_HOME points to a missing directory: $SDK_DIR" "Set ANDROID_HOME to your real SDK path (Android Studio → Settings → Android SDK)"
  fi
else
  fail "ANDROID_HOME (and ANDROID_SDK_ROOT) not set" "Add to your shell: export ANDROID_HOME=\"\$HOME/Library/Android/sdk\"  (adjust per OS)"
fi

# Platform API 35
if [[ -n "$SDK_DIR" && -d "$SDK_DIR/platforms" ]]; then
  if [[ -d "$SDK_DIR/platforms/android-35" ]]; then
    pass "SDK Platform API 35 installed"
  else
    fail "SDK Platform API 35 missing" "In Android Studio → SDK Manager → SDK Platforms, install 'Android 15.0 (API 35)'"
  fi

  if ls "$SDK_DIR/build-tools" 2>/dev/null | grep -q "^35\."; then
    pass "Build-Tools 35.x installed"
  else
    fail "Build-Tools 35.0.0 missing" "SDK Manager → SDK Tools → install 'Android SDK Build-Tools 35.0.0'"
  fi

  if [[ -d "$SDK_DIR/platform-tools" ]]; then
    pass "platform-tools installed"
  else
    fail "platform-tools missing" "SDK Manager → SDK Tools → install 'Android SDK Platform-Tools'"
  fi

  if [[ -d "$SDK_DIR/cmdline-tools/latest" ]]; then
    pass "cmdline-tools (latest) installed"
  else
    fail "cmdline-tools 'latest' missing" "SDK Manager → SDK Tools → check 'Android SDK Command-line Tools (latest)'"
  fi
fi

# adb
section "adb"
if command -v adb >/dev/null 2>&1; then
  pass "$(adb --version | head -n1)"
  DEV_COUNT="$(adb devices 2>/dev/null | tail -n +2 | grep -cE 'device$|emulator')"
  if [[ "$DEV_COUNT" -gt 0 ]]; then
    pass "$DEV_COUNT device/emulator connected"
  else
    warn "no devices connected (start an emulator or plug in a phone with USB debugging)"
  fi
else
  fail "adb not on PATH" "Add platform-tools to PATH: export PATH=\"\$PATH:\$ANDROID_HOME/platform-tools\""
fi

# ---------- Capacitor ----------
section "Capacitor"
if [[ -f "capacitor.config.ts" || -f "capacitor.config.json" ]]; then
  pass "capacitor.config.* present"
else
  fail "capacitor.config.ts not found" "Run 'npx cap init' (already configured in this repo — git pull?)"
fi

if [[ -d "node_modules/@capacitor/core" ]]; then
  CAP_VER="$(node -p "require('./node_modules/@capacitor/core/package.json').version" 2>/dev/null || echo 'unknown')"
  pass "@capacitor/core $CAP_VER"
else
  fail "@capacitor/core not installed" "Run 'npm install'"
fi

if [[ -d "node_modules/@capacitor/android" ]]; then
  pass "@capacitor/android installed"
else
  fail "@capacitor/android not installed" "Run 'npm install'"
fi

if command -v npx >/dev/null 2>&1; then
  pass "npx available"
else
  fail "npx not found" "Reinstall Node.js (npx ships with npm)"
fi

# ---------- Android platform folder ----------
section "Android project"
if [[ -d "android" ]]; then
  pass "android/ folder exists"
  if [[ -f "android/gradlew" ]]; then
    pass "gradlew present"
  else
    fail "android/gradlew missing" "Re-run 'npx cap add android' (delete android/ first)"
  fi
  if [[ -f "android/app/build.gradle" ]]; then
    if grep -q "matbex-signing" "android/app/build.gradle"; then
      pass "release signing block injected"
    else
      warn "release signing block not yet injected"
      printf "    ${DIM}fix:${RESET} bash scripts/apply-android-signing.sh\n"
    fi
  fi
else
  warn "android/ folder not generated yet"
  printf "    ${DIM}fix:${RESET} npx cap add android\n"
fi

# ---------- Summary ----------
printf "\n${BOLD}Summary${RESET}\n"
if [[ "$FAILED" -eq 0 && "$WARNED" -eq 0 ]]; then
  printf "  ${GREEN}All checks passed.${RESET} You're ready to run: ${BOLD}npm run android${RESET}\n"
  exit 0
elif [[ "$FAILED" -eq 0 ]]; then
  printf "  ${YELLOW}$WARNED warning(s)${RESET} — builds should still work. Review fixes above.\n"
  exit 0
else
  printf "  ${RED}$FAILED failure(s)${RESET}, ${YELLOW}$WARNED warning(s)${RESET}. Apply the fixes above, then re-run: ${BOLD}npm run android:doctor${RESET}\n"
  exit 1
fi
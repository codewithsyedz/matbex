# Local Android Build Setup

This guide takes you from zero to a working `npx cap run android` on your
laptop. Pair it with [`android-signing.md`](./android-signing.md) when you're
ready to ship release APKs.

---

## 1. System requirements

| Tool | Minimum version | Notes |
| --- | --- | --- |
| OS | macOS 12+, Windows 10+, or Ubuntu 22.04+ | Apple Silicon supported |
| Node.js | 20.x LTS | Use `nvm` or Volta |
| npm | 10.x (ships with Node 20) | `pnpm`/`bun` also work |
| JDK | **Temurin 21** (LTS) | Required by Android Gradle Plugin 8.7+ |
| Android Studio | Koala 2024.1.1 or newer | Bundles SDK + emulator |
| Android SDK Platform | **API 35** (Android 15) | Capacitor 8 default target |
| Android SDK Build-Tools | 35.0.0 | Installed via SDK Manager |
| Gradle | 8.11.1 (wrapper, auto) | Don't install manually |
| Capacitor CLI | 8.x | Already in `devDependencies` |
| RAM / disk | 16 GB RAM, 20 GB free | Emulator + SDK are heavy |

---

## 2. Install the toolchain

### macOS (Homebrew)

```bash
brew install --cask temurin@21 android-studio
brew install node@20
```

### Windows

1. Install **Node.js 20 LTS** from <https://nodejs.org>.
2. Install **Eclipse Temurin 21** from <https://adoptium.net>.
3. Install **Android Studio** from <https://developer.android.com/studio>.

### Linux (Ubuntu/Debian)

```bash
sudo apt install -y openjdk-21-jdk
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
# Android Studio: download tarball from developer.android.com/studio
```

Verify:

```bash
node -v   # v20.x
java -version   # openjdk 21
```

---

## 3. Configure Android Studio

1. Launch **Android Studio** → complete the first-run wizard (accept all SDK
   licenses).
2. Open **Settings → Languages & Frameworks → Android SDK**:
   - **SDK Platforms tab** → check **Android 15.0 (API 35)**.
   - **SDK Tools tab** → check:
     - Android SDK Build-Tools 35.0.0
     - Android SDK Command-line Tools (latest)
     - Android SDK Platform-Tools
     - Android Emulator
     - Google Play services (optional)
3. Click **Apply** to download.
4. Note the SDK location (top of the same screen) - usually:
   - macOS: `~/Library/Android/sdk`
   - Windows: `C:\Users\<you>\AppData\Local\Android\Sdk`
   - Linux: `~/Android/Sdk`

### Set environment variables

Add to your shell profile (`~/.zshrc`, `~/.bashrc`, or Windows env vars):

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"   # adjust per OS
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin"
export JAVA_HOME="$(/usr/libexec/java_home -v 21)" # macOS only
```

Reload your shell, then verify:

```bash
adb --version
sdkmanager --version
```

### Create a virtual device (emulator)

1. Android Studio → **Device Manager** → **Create Device**.
2. Pick **Pixel 7** (or any phone profile).
3. System image: **API 35, ABI matching your CPU** (arm64 on Apple Silicon,
   x86_64 elsewhere). Click **Download** → **Next** → **Finish**.

Or skip the emulator and plug in a physical Android device with **USB
debugging** enabled (Settings → About phone → tap Build number 7×, then
Settings → Developer options → USB debugging).

---

## 4. Get the Matbex code

```bash
git clone <your-github-repo-url> matbex
cd matbex
npm install
```

---

## 5. Add the Android platform (one time)

The `android/` folder is gitignored - generate it on first checkout:

```bash
npx cap add android
```

This scaffolds `android/` from your `capacitor.config.ts` (appId
`app.lovable.6d7e02d671b749c78974833cd1b54c5f`, appName `matbex`).

---

## 6. Build and run

Single command (recommended):

```bash
npm run android
```

This runs `vite build` → `npx cap sync android` → injects the signing block →
`npx cap run android` (launches on the first connected device or emulator).

Manual flow if you prefer:

```bash
npm run build           # produce dist/
npx cap sync android    # copy web bundle + plugins into android/
npx cap open android    # opens Android Studio for debugging
```

From Android Studio you can hit **Run ▶** to deploy to the selected device,
attach the debugger, or open Logcat.

---

## 7. Hot-reload from the Lovable sandbox

`capacitor.config.ts` already points `server.url` at the project preview URL,
so the installed APK loads the live web app over the network. To switch to a
fully offline bundle (e.g. for store submission), comment out the `server`
block and re-sync:

```bash
# capacitor.config.ts
# server: { url: "...", cleartext: true },
npx cap sync android
```

---

## 8. Build a release APK locally

1. Generate a keystore once: `npm run android:keystore`
2. Copy `keystore.properties.example` → `keystore.properties` and fill it in.
3. `npm run android:release`
4. Output: `android/app/build/outputs/apk/release/app-release.apk`

Full signing details: [`android-signing.md`](./android-signing.md).

---

## 9. Common issues

| Symptom | Fix |
| --- | --- |
| `SDK location not found` | Set `ANDROID_HOME` and re-open the terminal. |
| `Unsupported class file major version 65` | Java version mismatch - install JDK 21 and set `JAVA_HOME`. |
| `License for package Android SDK Build-Tools not accepted` | Run `sdkmanager --licenses` and accept all. |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | `adb uninstall app.lovable.6d7e02d671b749c78974833cd1b54c5f` then redeploy. |
| Emulator boots but app shows white screen | Check `adb logcat | grep Capacitor`; usually a stale `server.url`. Re-run `npx cap sync android`. |
| Gradle download stuck behind a proxy | Set `HTTP_PROXY` / `HTTPS_PROXY` env vars before `./gradlew`. |
| `ANDROID_HOME` differs between Studio and shell | Match them; Studio writes its value to `local.properties` inside `android/`. |

---

## 10. Reference commands

```bash
npm run android            # build + sync + run on device/emulator
npm run android:release    # build a signed release APK
npm run android:keystore   # generate the release keystore
npx cap sync android       # copy latest web bundle + plugins
npx cap open android       # open project in Android Studio
adb devices                # list attached devices/emulators
adb logcat | grep -i capacitor   # tail app logs
```

---

## 11. Logcat & on-device debugging

When the APK installs but the app misbehaves (white screen, instant crash,
blank network, broken plugin), Logcat is the fastest way to find out why.

### Attach to a device

```bash
adb devices                       # confirm the device/emulator is listed
adb logcat -c                     # clear the buffer (optional but recommended)
adb logcat                        # tail everything (very noisy)
```

If multiple devices are attached, target one explicitly:

```bash
adb -s <serial> logcat
```

### Filter for Matbex, Capacitor, and Vite

The web bundle logs through Capacitor's `WebView` bridge with the tag
`Capacitor`. Vite/JS `console.*` calls surface as `Capacitor/Console`.

```bash
# App-only logs (Capacitor + JS console + WebView)
adb logcat -v color \
  Capacitor:V Capacitor/Console:V Capacitor/Plugin:V \
  chromium:E SystemWebViewClient:E AndroidRuntime:E *:S

# Just JS console.log / console.error from your React code
adb logcat -s "Capacitor/Console:V"

# Just native crashes
adb logcat -s "AndroidRuntime:E"

# Filter by Matbex package only (Android 7+)
adb logcat --pid=$(adb shell pidof -s app.lovable.6d7e02d671b749c78974833cd1b54c5f)
```

Save a session to a file for sharing:

```bash
adb logcat -d > ~/matbex-logcat.txt
```

### Inspect the WebView with Chrome DevTools

1. Connect the device, open Chrome on your laptop → `chrome://inspect/#devices`.
2. Find **matbex** under the device, click **Inspect**.
3. You get the full DevTools (Console, Network, Sources) attached to the
   running WebView - same workflow as debugging a desktop site.

---

## 12. Common white-screen and crash fixes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| White screen on launch, no native crash | Stale `server.url` in `capacitor.config.ts` pointing at an unreachable preview | Re-run `npx cap sync android`; for offline builds, comment out the `server` block and rebuild |
| White screen + `net::ERR_CLEARTEXT_NOT_PERMITTED` in Logcat | Cleartext (http://) blocked | Ensure `server.cleartext: true` in `capacitor.config.ts` and re-sync |
| White screen + `Failed to load resource` for `/assets/index-*.js` | `dist/` not synced into `android/app/src/main/assets/public/` | `npm run build && npx cap sync android` |
| White screen, Logcat shows `Refused to execute inline script ... CSP` | Strict CSP blocking Vite chunks | Remove or relax CSP in `index.html` for native builds |
| App crashes immediately, `AndroidRuntime: FATAL EXCEPTION` | Native plugin missing after a sync | `npx cap sync android` then rebuild; if still failing, delete `android/` and `npx cap add android` |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Different signing key than previous install | `adb uninstall app.lovable.6d7e02d671b749c78974833cd1b54c5f` and redeploy |
| Plugin call hangs / "not implemented" | Web bundle out of sync with native plugins | `npx cap sync android` after every `npm install` of a Capacitor plugin |
| White screen only on release APK | Minification stripped a dynamic import | Check `Capacitor/Console` for the missing module; rebuild with `npm run android:release` after `npx cap sync android` |
| `SecurityException: ... INTERNET` | Missing permission in `AndroidManifest.xml` | Add `<uses-permission android:name="android.permission.INTERNET"/>` (Capacitor adds this by default - restore if removed) |
| Blank screen after deep link | Service worker cached the wrong route | In Chrome DevTools (see §11), Application → Service Workers → Unregister, then reload |

### Quick triage checklist

1. `adb logcat -c && adb logcat -s "Capacitor:V" "Capacitor/Console:V" "AndroidRuntime:E"`
2. Re-launch the app from the launcher.
3. Look for the **first** red line - everything after is usually a cascade.
4. If nothing red appears, attach Chrome DevTools (`chrome://inspect`) and
   check the Console + Network tabs in the WebView.
5. Still stuck? Run `npm run android:doctor` to confirm the toolchain is sane,
   then `npx cap sync android` and rebuild.
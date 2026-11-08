# Android Release APK Checklist

Follow these steps in order to generate a keystore, configure signing, and produce a signed release APK for Matbex. Every step below uses the exact files and npm scripts already in this repo.

---

## Prerequisites

- [ ] Node.js 20.x installed (`node -v`)
- [ ] JDK 21 installed (`java -version`)
- [ ] Android Studio installed with SDK Platform API 35 and Build-Tools 35.0.0
- [ ] `ANDROID_HOME` set and on `PATH`
- [ ] `npx cap add android` already run once (so `android/` exists)
- [ ] Project dependencies installed: `npm install`

---

## Step 1 - Generate the release keystore

Use the built-in script. It wraps `keytool` and prints the base64 blob you will need for CI.

```bash
npm run android:keystore
```

This runs: `bash scripts/generate-android-keystore.sh`

You will be prompted for a keystore password (min 6 chars). Defaults:

| Prompt | Default |
|--------|---------|
| Keystore path | `./release.keystore` |
| Key alias | `matbex` |
| Key password | same as keystore password |
| DNAME | `CN=Matbex, O=Matbex, C=SA` |

**Outputs:**
- `release.keystore` in the project root
- Base64 string printed to terminal (for GitHub secret)

**Do this once per app.** Back up the keystore and all passwords offline. Losing them means you cannot publish updates under the same app identity.

---

## Step 2 - Create `keystore.properties`

Copy the example file and fill in your real values:

```bash
cp keystore.properties.example keystore.properties
```

Edit `keystore.properties`:

```properties
storeFile=/absolute/path/to/release.keystore
storePassword=your_keystore_password
keyAlias=matbex
keyPassword=your_key_password
```

`keystore.properties` is already gitignored. Never commit it.

---

## Step 3 - Inject the signing block into Gradle

The script `scripts/apply-android-signing.sh` is idempotent - safe to run after every sync.

```bash
bash scripts/apply-android-signing.sh
```

What it does:
- Verifies `android/app/build.gradle` exists
- Injects a `signingConfigs.release` block that reads `keystore.properties` if present
- Falls back to environment variables (`ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) when `keystore.properties` is absent
- Marks injected code with `// >>> matbex-signing` so it never duplicates

You do **not** need to run this manually if you use `npm run android:release` - that script calls it for you.

---

## Step 4 - Build the signed release APK locally

Run the single-command release script:

```bash
npm run android:release
```

This runs, in order:
1. `vite build`
2. `npx cap sync android`
3. `bash scripts/apply-android-signing.sh`
4. `cd android && ./gradlew assembleRelease`

**Output:**

```
android/app/build/outputs/apk/release/app-release.apk
```

Verify the APK is signed:

```bash
jarsigner -verify -verbose android/app/build/outputs/apk/release/app-release.apk
```

---

## Step 5 - Build the signed Android App Bundle (.aab) for Play Store

Google Play requires an **App Bundle** (`.aab`) instead of an APK for new apps and most updates.

```bash
npm run android:release:aab
```

This runs the same pipeline as the APK, but with `./gradlew bundleRelease` instead of `assembleRelease`.

**Output:**

```
android/app/build/outputs/bundle/release/app-release.aab
```

Upload that `.aab` to **Google Play Console → Production → Create release**.

You do **not** need to build both - the `.aab` contains all ABIs and screen-density splits. Play Store generates optimized APKs for each user device automatically.

---

## Step 6 - (Optional) Run on device or emulator

---

## Step 5 - (Optional) Run on device or emulator

For development and quick iteration:

```bash
npm run android
```

This runs:
1. `vite build`
2. `npx cap sync android`
3. `bash scripts/apply-android-signing.sh`
4. `npx cap run android`

---

## Step 7 - CI: Build and upload signed APK / AAB on every push

The GitHub Actions workflow at `.github/workflows/android-build.yml` already handles this. Add these secrets to your repo (Settings → Secrets and variables → Actions):

| Secret | How to get the value |
|--------|----------------------|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.keystore` (or the blob printed in Step 1) |
| `ANDROID_KEYSTORE_PASSWORD` | Password from Step 1 |
| `ANDROID_KEY_ALIAS` | `matbex` (or what you chose) |
| `ANDROID_KEY_PASSWORD` | Password from Step 1 |

On every push, the workflow:
1. Checks out the repo
2. Installs Node 20, Java 21, and the Android SDK
3. Runs `npm ci`, `npm run build`, `npx cap add android` (if missing), `npx cap sync android`
4. Calls `scripts/apply-android-signing.sh`
5. Decodes `ANDROID_KEYSTORE_BASE64` into `android/app/release.keystore`
6. Runs `./gradlew assembleRelease` **and** `./gradlew bundleRelease` with signing env vars
7. Uploads both the APK and AAB as workflow artifacts

If any signing secret is missing, the workflow gracefully falls back to `./gradlew assembleDebug`.

---

## Quick Reference

| Task | Command |
|------|---------|
| Generate keystore | `npm run android:keystore` |
| Build + sync + run (dev) | `npm run android` |
| Build signed release APK | `npm run android:release` |
| Build signed release AAB (Play Store) | `npm run android:release:aab` |
| Sync web bundle only | `npx cap sync android` |
| Open in Android Studio | `npx cap open android` |
| Apply signing config manually | `bash scripts/apply-android-signing.sh` |
| Verify APK signature | `jarsigner -verify -verbose path/to/apk` |

---

## Related Docs

- [`android-local-setup.md`](./android-local-setup.md) - Full Android Studio / SDK / emulator setup
- [`android-signing.md`](./android-signing.md) - Deep dive into signing config and CI details
- [`terminal-api.md`](./terminal-api.md) - Terminal hardware integration

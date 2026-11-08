# Android Release Signing

Matbex Android APKs are signed with a keystore you control. Local builds
read `keystore.properties`; CI builds read environment variables. Same Gradle
config handles both.

## 1. Generate a keystore (one time)

```bash
npm run android:keystore
```

Outputs `release.keystore` in the project root and prints a base64 blob you
can paste into the `ANDROID_KEYSTORE_BASE64` GitHub secret. **Back up the
keystore + passwords offline** - losing them means you can never publish
updates under the same app identity.

## 2. Local builds

Copy the example file and fill it in:

```bash
cp keystore.properties.example keystore.properties
# edit keystore.properties with absolute paths + passwords
```

Then:

```bash
npm run android:release      # → APK: android/app/build/outputs/apk/release/app-release.apk
npm run android:release:aab  # → AAB: android/app/build/outputs/bundle/release/app-release.aab
```

`keystore.properties`, `*.keystore`, and `*.jks` are gitignored.

## 3. CI builds (GitHub Actions)

Add four repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.keystore` output |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | alias (default `matbex`) |
| `ANDROID_KEY_PASSWORD` | alias password |

On every push, `.github/workflows/android-build.yml`:

1. Builds the web bundle and runs `npx cap sync android`
2. Runs `scripts/apply-android-signing.sh` to inject the signing block
3. Decodes the keystore from the secret into `android/app/release.keystore`
4. Runs `./gradlew assembleRelease` **and** `./gradlew bundleRelease`
5. Uploads both the APK and AAB as workflow artifacts

Without secrets it falls back to an unsigned debug APK so pushes never fail.

## How the Gradle config resolves credentials

`scripts/apply-android-signing.sh` injects (idempotently) into
`android/app/build.gradle`:

- If `keystore.properties` exists → use it.
- Else if `ANDROID_KEYSTORE_FILE` env var is set → use env vars.
- Else → no signing config, release build is unsigned.

Re-run the script after any `npx cap sync android` if you ever wipe the
`android/` folder. `npm run android` and `npm run android:release` already do
this for you.
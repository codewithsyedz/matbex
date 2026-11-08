# Fastlane - Android Play Store releases

This project ships a Fastlane setup that builds a signed `.aab`, bumps `versionCode`/`versionName`, and uploads to a Google Play Console track with localized release notes.

## One-time setup

### 1. Install Fastlane

Fastlane is a Ruby gem. Install via Bundler (recommended):

```bash
cd fastlane
bundle install
cd ..
```

Or globally: `gem install fastlane -NV`.

### 2. Create a Google Play service account

1. Go to **Google Play Console → Setup → API access**.
2. Click **Create new service account** and follow the link to Google Cloud.
3. In Google Cloud, create a service account, then **Manage keys → Add key → JSON**. Download the JSON.
4. Back in Play Console, click **Grant access** on the new account and give it at least **Release manager** for this app.
5. Save the JSON as `fastlane/play-store-key.json` (gitignored - never commit it).

### 3. Configure local env

```bash
cp fastlane/.env.example fastlane/.env
# edit fastlane/.env
```

Populate the keystore path and passwords from your Step 1 of [`android-release-checklist.md`](./android-release-checklist.md).

### 4. Add release notes

Changelogs are auto-generated on every Fastlane release run from your recent
git history (PR titles when running in CI, otherwise commit subjects). The
output is written to:

```
fastlane/metadata/android/en-US/changelogs/<versionCode>.txt
```

If you want to **override** the auto-generated notes for a specific build,
just create the matching `<versionCode>.txt` file by hand before running
Fastlane - the generator will not overwrite a release that already happened
because it always writes the file for the *new* `versionCode` produced by the
bump step.

Manual fallbacks still work: `default.txt` is used if no per-`versionCode`
file exists. Supported locales include `en-US`, `ar`, `fr-FR`, etc. Notes are
truncated to 480 characters (Play limit is 500).

#### Generator behaviour

`scripts/generate-android-changelog.sh` runs automatically inside the
`bump_and_release` helper. It:

- Diffs `HEAD` against the latest git tag (override with `CHANGELOG_SINCE`).
- Prefers real PR titles via `gh pr list` when `GITHUB_TOKEN` and
  `GITHUB_REPOSITORY` are set (CI), otherwise uses commit subjects.
- Strips conventional-commit prefixes (`feat:`, `fix:`, …) and skips noisy
  types (`chore`, `docs`, `style`, `test`, `ci`, `build`, `refactor`) and bot
  commits (`dependabot`, `renovate`, `lovable`).
- Deduplicates and caps at `CHANGELOG_LIMIT` entries (default 15).

Run it standalone any time:

```bash
bash scripts/generate-android-changelog.sh                # en-US, since last tag
bash scripts/generate-android-changelog.sh ar v1.4.0      # Arabic, since v1.4.0
CHANGELOG_LIMIT=8 bash scripts/generate-android-changelog.sh
```

Set `MATBEX_SKIP_CHANGELOG=1` to skip generation in a Fastlane run (useful
when you've hand-written the file).

## Lanes

Run from the project root:

| Command | What it does |
|---|---|
| `bundle exec fastlane android bundle_release` | Builds a signed `.aab` (no upload). |
| `bundle exec fastlane android beta` | Bumps patch version → builds `.aab` → uploads to **internal** testing track. |
| `bundle exec fastlane android alpha` | Same, uploads to **alpha** (closed testing). |
| `bundle exec fastlane android production rollout:0.1` | Uploads to **production** with 10% staged rollout. |
| `bundle exec fastlane android upload_assets` | Pushes listing assets only - no build, no version bump. Override track with `track:alpha`. |

Override the bump type: `bundle exec fastlane android beta bump:minor` (or `major`, or an explicit semver like `bump:1.4.2`).

Dry-run an upload (validates with Google Play API but does not publish): `FASTLANE_VALIDATE_ONLY=1 bundle exec fastlane android beta`.

## Store listing assets (icon, feature graphic, screenshots)

`supply` can publish your Play Store listing visuals from this repo so they
stay versioned alongside the code.

### Where to put files

```
fastlane/metadata/android/<locale>/images/
├── icon.png                       512×512 PNG, 32-bit         (required)
├── featureGraphic.png             1024×500 PNG/JPEG           (required)
├── promoGraphic.png               180×120                     (optional, legacy)
├── tvBanner.png                   1280×720 (Android TV)       (optional)
├── phoneScreenshots/              2–8 images, 16:9 or 9:16    (required)
│   ├── 01_dashboard.png
│   ├── 02_pos.png
│   └── …
├── sevenInchScreenshots/          7" tablet                   (optional)
├── tenInchScreenshots/            10" tablet                  (optional)
├── wearScreenshots/               Wear OS                     (optional)
└── tvScreenshots/                 Android TV                  (optional)
```

- Locales follow Play Console codes (`en-US`, `ar`, `fr-FR`, `es-419`, …).
- Add a sibling folder per locale to localize your listing.
- Screenshot order is alphabetical - prefix files with `01_`, `02_`, … to control it.
- A scaffold + spec table lives at
  [`fastlane/metadata/android/en-US/images/README.md`](../fastlane/metadata/android/en-US/images/README.md).

### How to upload

By default, the `beta` and `alpha` lanes **skip** asset uploads so manual edits
in Play Console aren't clobbered. The `production` lane uploads them by
default (override with `assets:false`). Opt in per-run on any lane:

```bash
# Build + push assets together
bundle exec fastlane android beta assets:true

# Push assets only - no build, no version bump
bundle exec fastlane android upload_assets                # default track: internal
bundle exec fastlane android upload_assets track:production

# Dry run (validates with Play API, does not publish)
FASTLANE_VALIDATE_ONLY=1 bundle exec fastlane android upload_assets
```

Before each upload Fastlane prints an inventory of what it found per locale
(icon ✓, feature ✓, phone N, etc.) so a misnamed file is caught before it hits
the Play API.

### From CI

The GitHub Actions workflow exposes both controls:

- **lane** = `upload_assets` for an assets-only push, **or**
- **upload_assets** = `true` on a `beta`/`alpha`/`production` run to bundle
  asset upload with the build.

## Pipeline

Every lane runs the same prep work via Fastlane's `before_all`:

1. `npm run build` - Vite production bundle
2. `npx cap sync android` - Capacitor sync
3. `bash scripts/apply-android-signing.sh` - inject signing config

Then per-lane:

1. `bash scripts/bump-android-version.sh <bump>` - increments `versionCode` and `versionName`
2. `./gradlew bundleRelease` - produces `android/app/build/outputs/bundle/release/app-release.aab`
3. `supply` (a.k.a. `upload_to_play_store`) - uploads the AAB and changelog to the chosen track

## CI usage

A ready-made GitHub Actions workflow lives at
[`.github/workflows/android-fastlane.yml`](../.github/workflows/android-fastlane.yml).
It is `workflow_dispatch`-only - trigger it from the Actions tab and pick:

- **lane** - `beta` (internal), `alpha` (closed testing), or `production`
- **bump** - `patch` (default), `minor`, `major`, or an explicit semver like `1.4.2`
- **rollout** - staged rollout fraction for `production` only (default `0.1` = 10%)
- **validate_only** - `true` to dry-run upload via the Play API without publishing

Required repository secrets (Settings → Secrets and variables → Actions):

| Secret | Contents |
|---|---|
| `PLAY_STORE_JSON_KEY` | base64 of the Google Play service-account JSON |
| `ANDROID_KEYSTORE_BASE64` | base64 of the release `.keystore` file |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias (e.g. `matbex`) |
| `ANDROID_KEY_PASSWORD` | key password |
| `ANDROID_PACKAGE_NAME` | _(optional)_ overrides the appId from `Appfile` |

Encode files for storage:

```bash
base64 -w0 fastlane/play-store-key.json   # → PLAY_STORE_JSON_KEY
base64 -w0 android/app/release.keystore   # → ANDROID_KEYSTORE_BASE64
```

The workflow decodes both files into the runner, runs the chosen Fastlane lane,
uploads the produced `.aab` as a build artifact, and then deletes the decoded
secrets from the runner filesystem on completion.

## Troubleshooting

- **`Package not found`** - the Play Console listing must already exist. Manually upload the very first APK/AAB through the web UI; only subsequent releases can go through the API.
- **`apkNotificationMessageKeyUpgradeVersionConflict`** - `versionCode` is not greater than the highest one already on Play. Re-run with `bump:minor` or pass `bump:<explicit-semver>`.
- **`The caller does not have permission`** - the service account is missing the **Release manager** role for this app.
- **Signing errors** - verify `fastlane/.env` matches your keystore. Run `bash scripts/apply-android-signing.sh` manually to inspect output.
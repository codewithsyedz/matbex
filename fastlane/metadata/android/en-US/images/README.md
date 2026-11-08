# Play Store assets - en-US

Drop your Play Console listing assets here. `supply` (Fastlane) uploads any
file that matches the names below; missing files are skipped.

| File / folder                       | Spec (Google Play)                | Required |
|------------------------------------ |---------------------------------- |--------- |
| `icon.png`                          | 512×512 PNG, 32-bit, < 1 MB        | ✅       |
| `featureGraphic.png`                | 1024×500 PNG or JPEG, < 15 MB      | ✅       |
| `promoGraphic.png`                  | 180×120 PNG/JPEG (legacy)          | optional |
| `tvBanner.png`                      | 1280×720 PNG/JPEG (Android TV)     | optional |
| `phoneScreenshots/*.png`            | 16:9 or 9:16, min 320 px, 2–8 imgs | ✅       |
| `sevenInchScreenshots/*.png`        | 7" tablet                          | optional |
| `tenInchScreenshots/*.png`          | 10" tablet                         | optional |
| `wearScreenshots/*.png`             | Wear OS                            | optional |
| `tvScreenshots/*.png`               | Android TV                         | optional |

Naming inside screenshot folders is alphabetical - prefix with `01_`, `02_`, …
to control the order shown on the Play Store.

Add additional locales by creating sibling folders, e.g.
`fastlane/metadata/android/ar/images/…`, `fastlane/metadata/android/fr-FR/images/…`.

## Uploading

- Build + push assets together: `bundle exec fastlane android beta assets:true`
- Push assets only (no build, no version bump):
  `bundle exec fastlane android upload_assets`
- Dry run (validates with Play API, doesn't publish):
  `FASTLANE_VALIDATE_ONLY=1 bundle exec fastlane android upload_assets`

The `production` lane uploads assets by default - pass `assets:false` to skip.
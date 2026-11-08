# Matbex App Icon & Splash Resources

Source assets for `@capacitor/assets`. Run locally after `git pull`:

```bash
npm install
npx capacitor-assets generate --android \
  --iconBackgroundColor '#00A859' --iconBackgroundColorDark '#00A859' \
  --splashBackgroundColor '#00A859' --splashBackgroundColorDark '#00A859'
npx cap sync android
```

This regenerates all `mipmap-*` densities and `drawable-*` splashes under
`android/app/src/main/res/` using:

- `icon.png` (1024x1024) — legacy launcher icon (Matbex "M" on emerald)
- `icon-foreground.png` (1024x1024, transparent) — Android adaptive foreground
- `splash.png` (1920x1920) — splash screen with wordmark
- Background color: `#00A859` (Matbex Emerald)

The `SplashScreen` plugin config lives in `capacitor.config.ts` (2s duration,
CENTER_CROP scale, no spinner). After regenerating, rebuild the APK for the
new icon and splash to appear on device.

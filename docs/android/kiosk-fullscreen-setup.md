# Matbex Android POS — Fullscreen + Kiosk Lock

The `android/` folder is generated locally (not committed). Run the
project script after `npx cap add android` or after every `npx cap sync android`.
It gives the POS terminal a true fullscreen experience (no status bar,
no nav bar) and locks it to the Matbex app so cashiers cannot exit.

## 1. Apply the kiosk patch

From the project root:

```bash
bash scripts/apply-android-kiosk.sh
```

The script **replaces** `android/app/src/main/java/net/matbex/app/MainActivity.java`
with a single safe implementation. This prevents the Gradle error:
`method onCreate(Bundle) is already defined in class MainActivity`.

## 2. If you patched manually, reset `MainActivity.java`

File: `android/app/src/main/java/net/matbex/app/MainActivity.java`

> **Important:** Open the file and **replace its ENTIRE contents** with
> the block below. Do not append — the generated file already contains
> an `onCreate` (or an empty class body extending `BridgeActivity`), and
> pasting on top of it will produce
> `method onCreate(Bundle) is already defined`.

```java
package net.matbex.app;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private static final String TAG = "MatbexMainActivity";

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Keep screen on — POS terminals should never sleep mid-shift.
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    applyImmersiveMode();
    startKioskLock();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) applyImmersiveMode();
  }

  private void applyImmersiveMode() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      getWindow().setDecorFitsSystemWindows(false);
      WindowInsetsController c = getWindow().getInsetsController();
      if (c != null) {
        c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
        c.setSystemBarsBehavior(
          WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      }
    } else {
      getWindow().getDecorView().setSystemUiVisibility(
          View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        | View.SYSTEM_UI_FLAG_FULLSCREEN);
    }
  }

  /**
   * Lock the app to the screen (kiosk mode).
   *
   * - If the device is set up with Matbex as Device Owner (see section 3),
   *   this locks silently and users cannot exit without an admin unlock.
   * - Otherwise it falls back to Android screen-pinning: the user sees a
   *   one-time prompt and can exit by holding Back + Recents.
   */
  private void startKioskLock() {
    try {
      DevicePolicyManager dpm = (DevicePolicyManager)
          getSystemService(Context.DEVICE_POLICY_SERVICE);
      ComponentName admin = new ComponentName(this, MatbexDeviceAdmin.class);
      if (dpm != null && dpm.isDeviceOwnerApp(getPackageName())) {
        dpm.setLockTaskPackages(admin, new String[] { getPackageName() });
      }
      startLockTask();
    } catch (Throwable t) {
      Log.w(TAG, "startLockTask failed: " + t.getMessage());
    }
  }
}
```

## 3. Fullscreen theme

File: `android/app/src/main/res/values/styles.xml` — make the app theme
extend a `NoActionBar.Fullscreen` variant so the status bar never
flashes before `applyImmersive()` runs:

```xml
<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
  <item name="android:windowFullscreen">true</item>
  <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
  <item name="windowSplashScreenBackground">#00A859</item>
</style>
```

## 4. (Optional) Provision Matbex as Device Owner for silent kiosk

Without device-owner status Android will show a screen-pinning prompt.
To make the lock silent and un-exitable:

1. Factory reset the tablet, skip Google account setup.
2. Enable USB debugging (Developer Options).
3. Install the Matbex APK: `adb install matbex.apk`
4. Run `bash scripts/apply-android-kiosk.sh` so `MatbexDeviceAdmin` is
   copied and registered in `AndroidManifest.xml`.
5. Set as device owner:
   ```bash
    adb shell dpm set-device-owner net.matbex.app/.MatbexDeviceAdmin
   ```

After this, `startLockTask()` locks silently and the Home / Recents /
Back keys cannot exit the app.

## 5. Build

```bash
npx cap sync android
bash scripts/apply-android-kiosk.sh
npm run android
```
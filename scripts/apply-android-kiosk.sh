#!/usr/bin/env bash
# Injects kiosk / device-owner support into the generated Android project:
#   1. RECEIVE_BOOT_COMPLETED permission + <receiver> in AndroidManifest.xml
#   2. Copies BootReceiver.java and MatbexDeviceAdmin.java into the app package
#   3. Replaces MainActivity.java with one fullscreen/kiosk-safe implementation.
#
# Idempotent: safe to re-run after every `npx cap sync android`.

set -euo pipefail

APP_PKG="net.matbex.app"
PKG_PATH="net/matbex/app"
MANIFEST="android/app/src/main/AndroidManifest.xml"
JAVA_DIR="android/app/src/main/java/${PKG_PATH}"
MAIN_ACTIVITY="${JAVA_DIR}/MainActivity.java"
MAIN_ACTIVITY_KT="${JAVA_DIR}/MainActivity.kt"
BOOT_RECEIVER_SRC="android-overlay/BootReceiver.java"
BOOT_RECEIVER_DST="${JAVA_DIR}/BootReceiver.java"
DEVICE_ADMIN_SRC="android-overlay/MatbexDeviceAdmin.java"
DEVICE_ADMIN_DST="${JAVA_DIR}/MatbexDeviceAdmin.java"
OLD_BOOT_RECEIVER_DST="${JAVA_DIR}/BootReceiver.kt"
OLD_DEVICE_ADMIN_DST="${JAVA_DIR}/MatbexDeviceAdmin.kt"
DEVICE_ADMIN_XML_SRC="android-overlay/device_admin.xml"
DEVICE_ADMIN_XML_DST="android/app/src/main/res/xml/device_admin.xml"

if [[ ! -f "$MANIFEST" ]]; then
  echo "AndroidManifest.xml not found. Run \`npx cap add android && npx cap sync android\` first." >&2
  exit 1
fi

mkdir -p "$JAVA_DIR"

# ---------- 1. Manifest: permission + receiver ----------
python3 - "$MANIFEST" "$APP_PKG" <<'PY'
import re, sys, pathlib

path = pathlib.Path(sys.argv[1])
pkg = sys.argv[2]
src = path.read_text()

changed = False

# Permission
if "android.permission.RECEIVE_BOOT_COMPLETED" not in src:
    perm = '    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />\n'
    m = re.search(r"^\s*<uses-permission", src, re.MULTILINE)
    if m:
        src = src[:m.start()] + perm + src[m.start():]
    else:
        src = re.sub(r"(<application\b)", perm + r"\1", src, count=1)
    changed = True

# Camera permission (QR pairing / receipt capture inside the WebView)
if "android.permission.CAMERA" not in src:
    cam = (
        '    <uses-permission android:name="android.permission.CAMERA" />\n'
        '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n'
        '    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />\n'
    )
    src = re.sub(r"(\s*</manifest>)", "\n" + cam + r"\1", src, count=1)
    changed = True

# Receiver
if "BootReceiver" not in src:
    receiver = f"""        <receiver
            android:name=".BootReceiver"
            android:enabled="true"
            android:exported="true"
            android:permission="android.permission.RECEIVE_BOOT_COMPLETED">
            <intent-filter android:priority="1000">
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.LOCKED_BOOT_COMPLETED" />
                <action android:name="android.intent.action.QUICKBOOT_POWERON" />
            </intent-filter>
        </receiver>
"""
    src = re.sub(r"(\s*</application>)", "\n" + receiver + r"\1", src, count=1)
    changed = True

# Device Admin / Device Owner receiver
if "MatbexDeviceAdmin" not in src:
    admin = """        <receiver
            android:name=".MatbexDeviceAdmin"
            android:label="Matbex Device Admin"
            android:permission="android.permission.BIND_DEVICE_ADMIN"
            android:exported="true">
            <meta-data
                android:name="android.app.device_admin"
                android:resource="@xml/device_admin" />
            <intent-filter>
                <action android:name="android.app.action.DEVICE_ADMIN_ENABLED" />
            </intent-filter>
        </receiver>
"""
    src = re.sub(r"(\s*</application>)", "\n" + admin + r"\1", src, count=1)
    changed = True

if changed:
    path.write_text(src)
    print(f"Patched {path}")
else:
    print(f"{path} already kiosk-ready — skipping.")
PY

# ---------- 2. Copy Java receivers ----------
# Remove old Kotlin overlays if a previous version of this script installed them.
rm -f "$OLD_BOOT_RECEIVER_DST" "$OLD_DEVICE_ADMIN_DST"

cp "$BOOT_RECEIVER_SRC" "$BOOT_RECEIVER_DST"
echo "Installed $BOOT_RECEIVER_DST"

cp "$DEVICE_ADMIN_SRC" "$DEVICE_ADMIN_DST"
echo "Installed $DEVICE_ADMIN_DST"

mkdir -p "$(dirname "$DEVICE_ADMIN_XML_DST")"
cp "$DEVICE_ADMIN_XML_SRC" "$DEVICE_ADMIN_XML_DST"
echo "Installed $DEVICE_ADMIN_XML_DST"

# ---------- 3. Replace MainActivity with one safe implementation ----------
rm -f "$MAIN_ACTIVITY_KT"
cat > "$MAIN_ACTIVITY" <<'JAVA'
package net.matbex.app;

import android.Manifest;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  private static final String TAG = "MatbexMainActivity";
  private static final int REQ_CAMERA = 4711;

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    applyImmersiveMode();
    startKioskLock();
    ensureCameraPermission();
  }

  /**
   * The pairing screen scans the Workspace QR with getUserMedia inside the WebView.
   * Without CAMERA granted the WebView silently blocks the stream (blank/black preview),
   * and in kiosk / device-owner mode the runtime dialog may never be shown — so grant
   * it programmatically when we own the device.
   */
  private void ensureCameraPermission() {
    try {
      if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
          == PackageManager.PERMISSION_GRANTED) {
        return;
      }

      DevicePolicyManager dpm =
          (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
          && dpm != null
          && dpm.isDeviceOwnerApp(getPackageName())) {
        ComponentName admin = new ComponentName(this, MatbexDeviceAdmin.class);
        dpm.setPermissionGrantState(
            admin,
            getPackageName(),
            Manifest.permission.CAMERA,
            DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED);
        return;
      }

      ActivityCompat.requestPermissions(
          this, new String[] { Manifest.permission.CAMERA }, REQ_CAMERA);
    } catch (Throwable t) {
      Log.w(TAG, "camera permission request failed: " + t.getMessage());
    }
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) {
      applyImmersiveMode();
    }
  }

  private void applyImmersiveMode() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      getWindow().setDecorFitsSystemWindows(false);
      WindowInsetsController controller = getWindow().getInsetsController();
      if (controller != null) {
        controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
        controller.setSystemBarsBehavior(
            WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      }
      return;
    }

    getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN);
  }

  private void startKioskLock() {
    try {
      DevicePolicyManager dpm =
          (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
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
JAVA
echo "Replaced $MAIN_ACTIVITY with fullscreen/kiosk-safe implementation."

echo
echo "Kiosk patch complete."
echo "Next: provision this device as Device Owner so startLockTask() is permitted, e.g.:"
echo "  adb shell dpm set-device-owner ${APP_PKG}/.MatbexDeviceAdmin"
echo "(Run on a freshly-wiped device with no accounts configured.)"
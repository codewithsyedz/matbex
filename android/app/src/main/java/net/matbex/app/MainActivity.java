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
    allowInputMethods();
  }

  /**
   * In device-owner / kiosk mode the soft keyboard can be suppressed when the
   * permitted-IME list is empty (only system IMEs allowed, and none qualify).
   * Passing null explicitly re-allows every installed keyboard.
   */
  private void allowInputMethods() {
    try {
      DevicePolicyManager dpm =
          (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
      if (dpm == null || !dpm.isDeviceOwnerApp(getPackageName())) return;
      ComponentName admin = new ComponentName(this, MatbexDeviceAdmin.class);
      dpm.setPermittedInputMethods(admin, null); // null = allow all IMEs
    } catch (Throwable t) {
      Log.w(TAG, "allowInputMethods failed: " + t.getMessage());
    }
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
    // Re-hiding the system bars while the IME is up dismisses the keyboard,
    // so skip the re-apply whenever the soft keyboard is visible.
    if (hasFocus && !isImeVisible()) {
      applyImmersiveMode();
    }
  }

  private boolean isImeVisible() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        WindowInsets insets = getWindow().getDecorView().getRootWindowInsets();
        return insets != null && insets.isVisible(WindowInsets.Type.ime());
      }
    } catch (Throwable ignored) {
      // fall through
    }
    return false;
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

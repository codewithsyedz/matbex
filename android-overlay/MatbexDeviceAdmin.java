package net.matbex.app;

import android.app.admin.DeviceAdminReceiver;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/** Device Admin / Device Owner receiver for Matbex kiosk mode. */
public class MatbexDeviceAdmin extends DeviceAdminReceiver {
  private static final String TAG = "MatbexDeviceAdmin";

  @Override
  public void onEnabled(Context context, Intent intent) {
    Log.i(TAG, "Device admin enabled");
    DevicePolicyManager dpm = getManager(context);
    ComponentName admin = new ComponentName(context, MatbexDeviceAdmin.class);
    try {
      if (dpm.isDeviceOwnerApp(context.getPackageName())) {
        dpm.setLockTaskPackages(admin, new String[] { context.getPackageName() });
      }
    } catch (Throwable t) {
      Log.w(TAG, "setLockTaskPackages failed: " + t.getMessage());
    }
  }

  @Override
  public void onDisabled(Context context, Intent intent) {
    Log.i(TAG, "Device admin disabled");
  }
}
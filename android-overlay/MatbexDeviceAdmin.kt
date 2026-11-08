package net.matbex.app

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Device Admin / Device Owner receiver for Matbex.
 *
 * Required so that `adb shell dpm set-device-owner net.matbex.app/.MatbexDeviceAdmin`
 * succeeds on a freshly-wiped tablet. Once the app is Device Owner, MainActivity's
 * `startLockTask()` call (injected by scripts/apply-android-kiosk.sh) puts the
 * tablet into kiosk mode automatically on boot.
 */
class MatbexDeviceAdmin : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        Log.i(TAG, "Device admin enabled")
        val dpm = getManager(context)
        val admin = ComponentName(context, MatbexDeviceAdmin::class.java)
        try {
            if (dpm.isDeviceOwnerApp(context.packageName)) {
                dpm.setLockTaskPackages(admin, arrayOf(context.packageName))
            }
        } catch (t: Throwable) {
            Log.w(TAG, "setLockTaskPackages failed: ${t.message}")
        }
    }

    override fun onDisabled(context: Context, intent: Intent) {
        Log.i(TAG, "Device admin disabled")
    }

    companion object { private const val TAG = "MatbexDeviceAdmin" }
}
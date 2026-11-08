package net.matbex.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Auto-launches Matbex as soon as the device finishes booting so the
 * tablet behaves like a single-purpose POS terminal.
 *
 * Paired with `RECEIVE_BOOT_COMPLETED` + a `<receiver>` entry in
 * AndroidManifest.xml (both injected by scripts/apply-android-kiosk.sh).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != "android.intent.action.QUICKBOOT_POWERON" &&
            intent.action != "android.intent.action.LOCKED_BOOT_COMPLETED") {
            return
        }
        val launchIntent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        context.startActivity(launchIntent)
    }
}
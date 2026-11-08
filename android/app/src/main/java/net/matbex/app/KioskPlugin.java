package net.matbex.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiNetworkSuggestion;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets the web layer inspect and control Android kiosk (lock task) mode so an
 * owner/manager can remotely release a paired terminal from kiosk lock.
 */
@CapacitorPlugin(name = "MatbexKiosk")
public class KioskPlugin extends Plugin {
  private static final String TAG = "MatbexKiosk";

  private boolean isLocked() {
    Activity activity = getActivity();
    if (activity == null) return false;
    ActivityManager am = (ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE);
    if (am == null) return false;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      return am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }
    return am.isInLockTaskMode();
  }

  private boolean isDeviceOwner() {
    Activity activity = getActivity();
    if (activity == null) return false;
    DevicePolicyManager dpm =
        (DevicePolicyManager) activity.getSystemService(Context.DEVICE_POLICY_SERVICE);
    return dpm != null && dpm.isDeviceOwnerApp(activity.getPackageName());
  }

  @PluginMethod
  public void status(PluginCall call) {
    JSObject res = new JSObject();
    res.put("supported", true);
    res.put("locked", isLocked());
    res.put("deviceOwner", isDeviceOwner());
    call.resolve(res);
  }

  @PluginMethod
  public void wifiStatus(PluginCall call) {
    JSObject res = new JSObject();
    Activity activity = getActivity();
    boolean wifiEnabled = false;
    boolean connected = false;
    String ssid = null;
    if (activity != null) {
      try {
        WifiManager wm =
            (WifiManager) activity.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null) {
          wifiEnabled = wm.isWifiEnabled();
          WifiInfo info = wm.getConnectionInfo();
          if (info != null && info.getSSID() != null) {
            String raw = info.getSSID().replace("\"", "");
            if (!raw.isEmpty() && !raw.equals("<unknown ssid>")) ssid = raw;
          }
        }
        ConnectivityManager cm =
            (ConnectivityManager) activity.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
          connected =
              caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
        }
      } catch (Throwable t) {
        Log.w(TAG, "wifiStatus failed: " + t.getMessage());
      }
    }
    res.put("wifiEnabled", wifiEnabled);
    res.put("connected", connected);
    res.put("ssid", ssid);
    call.resolve(res);
  }

  /**
   * Opens the Android Wi-Fi picker. Lock task mode blocks Settings, so the
   * caller may ask us to temporarily release the kiosk lock first.
   */
  @PluginMethod
  public void openWifiSettings(final PluginCall call) {
    final Activity activity = getActivity();
    if (activity == null) {
      call.reject("No activity");
      return;
    }
    final boolean releaseLock = call.getBoolean("releaseLock", true);
    activity.runOnUiThread(() -> {
      boolean released = false;
      try {
        if (releaseLock && isLocked()) {
          activity.stopLockTask();
          released = true;
        }
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          intent = new Intent(Settings.Panel.ACTION_WIFI);
        } else {
          intent = new Intent(Settings.ACTION_WIFI_SETTINGS);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(intent);
        JSObject res = new JSObject();
        res.put("opened", true);
        res.put("lockReleased", released);
        call.resolve(res);
      } catch (Throwable t) {
        Log.w(TAG, "openWifiSettings failed: " + t.getMessage());
        call.reject("openWifiSettings failed: " + t.getMessage());
      }
    });
  }

  /**
   * Joins a Wi-Fi network from scanned QR credentials WITHOUT leaving kiosk
   * mode. On device-owner tablets we can write the network config directly; on
   * non-owner Android 10+ we fall back to a network suggestion.
   */
  @PluginMethod
  public void joinWifi(final PluginCall call) {
    final String ssid = call.getString("ssid");
    final String password = call.getString("password", "");
    final String security = call.getString("security", "WPA");
    final boolean hidden = Boolean.TRUE.equals(call.getBoolean("hidden", false));
    if (ssid == null || ssid.trim().isEmpty()) {
      call.reject("SSID is required");
      return;
    }
    final Activity activity = getActivity();
    if (activity == null) {
      call.reject("No activity");
      return;
    }
    final WifiManager wm =
        (WifiManager) activity.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    if (wm == null) {
      call.reject("Wi-Fi service unavailable");
      return;
    }
    try {
      if (!wm.isWifiEnabled() && Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        wm.setWifiEnabled(true);
      }

      boolean legacyApplied = false;
      // Device owner apps keep legacy config APIs on Android 10+.
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || isDeviceOwner()) {
        try {
          WifiConfiguration conf = new WifiConfiguration();
          conf.SSID = "\"" + ssid + "\"";
          conf.hiddenSSID = hidden;
          if ("nopass".equalsIgnoreCase(security) || password == null || password.isEmpty()) {
            conf.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE);
          } else if ("WEP".equalsIgnoreCase(security)) {
            conf.wepKeys[0] = "\"" + password + "\"";
            conf.wepTxKeyIndex = 0;
            conf.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE);
          } else {
            conf.preSharedKey = "\"" + password + "\"";
            conf.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.WPA_PSK);
          }
          int netId = wm.addNetwork(conf);
          if (netId != -1) {
            wm.disconnect();
            wm.enableNetwork(netId, true);
            wm.reconnect();
            legacyApplied = true;
          }
        } catch (Throwable t) {
          Log.w(TAG, "legacy join failed: " + t.getMessage());
        }
      }

      boolean suggested = false;
      if (!legacyApplied && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        WifiNetworkSuggestion.Builder b =
            new WifiNetworkSuggestion.Builder().setSsid(ssid).setIsHiddenSsid(hidden);
        if (!"nopass".equalsIgnoreCase(security) && password != null && !password.isEmpty()) {
          b.setWpa2Passphrase(password);
        }
        List<WifiNetworkSuggestion> list = new ArrayList<>();
        list.add(b.build());
        wm.removeNetworkSuggestions(Collections.emptyList());
        int status = wm.addNetworkSuggestions(list);
        suggested = status == WifiManager.STATUS_NETWORK_SUGGESTIONS_SUCCESS
            || status == WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_DUPLICATE;
        if (!suggested) {
          call.reject("Wi-Fi suggestion rejected by Android (code " + status + ")");
          return;
        }
      }

      if (!legacyApplied && !suggested) {
        call.reject("Could not apply Wi-Fi configuration on this device");
        return;
      }

      JSObject res = new JSObject();
      res.put("applied", true);
      res.put("method", legacyApplied ? "config" : "suggestion");
      res.put("kioskPreserved", isLocked());
      call.resolve(res);
    } catch (Throwable t) {
      Log.w(TAG, "joinWifi failed: " + t.getMessage());
      call.reject("joinWifi failed: " + t.getMessage());
    }
  }

  @PluginMethod
  public void exitKiosk(final PluginCall call) {
    final Activity activity = getActivity();
    if (activity == null) {
      call.reject("No activity");
      return;
    }
    activity.runOnUiThread(() -> {
      try {
        activity.stopLockTask();
        JSObject res = new JSObject();
        res.put("locked", isLocked());
        call.resolve(res);
      } catch (Throwable t) {
        Log.w(TAG, "stopLockTask failed: " + t.getMessage());
        call.reject("stopLockTask failed: " + t.getMessage());
      }
    });
  }

  @PluginMethod
  public void enterKiosk(final PluginCall call) {
    final Activity activity = getActivity();
    if (activity == null) {
      call.reject("No activity");
      return;
    }
    activity.runOnUiThread(() -> {
      try {
        DevicePolicyManager dpm =
            (DevicePolicyManager) activity.getSystemService(Context.DEVICE_POLICY_SERVICE);
        if (dpm != null && dpm.isDeviceOwnerApp(activity.getPackageName())) {
          ComponentName admin = new ComponentName(activity, MatbexDeviceAdmin.class);
          dpm.setLockTaskPackages(admin, new String[] { activity.getPackageName() });
        }
        activity.startLockTask();
        JSObject res = new JSObject();
        res.put("locked", isLocked());
        call.resolve(res);
      } catch (Throwable t) {
        Log.w(TAG, "startLockTask failed: " + t.getMessage());
        call.reject("startLockTask failed: " + t.getMessage());
      }
    });
  }
}
# TA-900U Thermal Printer - Android Integration

Matbex talks to the TA-900U over **USB-OTG** from a Capacitor-built Android
app. The web/PWA build cannot access USB directly - you must run the native
APK on the Android device that the printer is plugged into.

The TypeScript adapter (`src/lib/hardware/adapters/usbAdapter.ts`) calls a
small native Capacitor plugin named `ThermalPrinter`. Add the plugin once
to your Android Studio project; the same APK works for every restaurant.

---

## 1. Add Android to your project (one-time)

On your own machine (Lovable's sandbox cannot run Android Studio):

```bash
git pull                       # pull the latest Lovable changes
npm install
npx cap add android            # creates the android/ folder
npm run build
npx cap sync android
```

## 2. Drop in the ThermalPrinter plugin

Create the file:
`android/app/src/main/java/net/matbex/app/ThermalPrinterPlugin.java`

```java
package net.matbex.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;

@CapacitorPlugin(name = "ThermalPrinter")
public class ThermalPrinterPlugin extends Plugin {
    private static final String ACTION_USB_PERMISSION = "net.matbex.app.USB_PERMISSION";
    private final HashMap<String, PluginCall> pendingPermissionCalls = new HashMap<>();

    private UsbManager usbManager() {
        return (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    }

    private String deviceKey(UsbDevice d) {
        return d.getVendorId() + ":" + d.getProductId();
    }

    private UsbDevice findDevice(String id) {
        for (UsbDevice d : usbManager().getDeviceList().values()) {
            if (deviceKey(d).equals(id)) return d;
        }
        return null;
    }

    @PluginMethod
    public void listDevices(PluginCall call) {
        JSArray devices = new JSArray();
        UsbManager mgr = usbManager();
        for (UsbDevice d : mgr.getDeviceList().values()) {
            JSObject o = new JSObject();
            o.put("id", deviceKey(d));
            o.put("name", d.getProductName() != null ? d.getProductName() : "USB Printer");
            o.put("vendorId", d.getVendorId());
            o.put("productId", d.getProductId());
            o.put("hasPermission", mgr.hasPermission(d));
            devices.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("devices", devices);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(final PluginCall call) {
        String id = call.getString("deviceId");
        UsbDevice device = findDevice(id);
        if (device == null) {
            call.reject("Device not found");
            return;
        }
        UsbManager mgr = usbManager();
        if (mgr.hasPermission(device)) {
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
            return;
        }
        pendingPermissionCalls.put(id, call);
        call.setKeepAlive(true);

        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                : PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent pi = PendingIntent.getBroadcast(
                getContext(), 0, new Intent(ACTION_USB_PERMISSION), flags);

        IntentFilter filter = new IntentFilter(ACTION_USB_PERMISSION);
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override public void onReceive(Context ctx, Intent intent) {
                boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
                PluginCall pending = pendingPermissionCalls.remove(id);
                if (pending != null) {
                    JSObject r = new JSObject();
                    r.put("granted", granted);
                    pending.resolve(r);
                }
                ctx.unregisterReceiver(this);
            }
        };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getContext().registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            getContext().registerReceiver(receiver, filter);
        }
        mgr.requestPermission(device, pi);
    }

    @PluginMethod
    public void printBytes(PluginCall call) {
        String id = call.getString("deviceId");
        String base64 = call.getString("base64");
        if (id == null || base64 == null) { call.reject("deviceId and base64 are required"); return; }

        UsbDevice device = findDevice(id);
        if (device == null) { call.reject("Device not found"); return; }

        UsbManager mgr = usbManager();
        if (!mgr.hasPermission(device)) { call.reject("USB permission not granted"); return; }

        UsbInterface iface = null;
        UsbEndpoint out = null;
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface candidate = device.getInterface(i);
            for (int e = 0; e < candidate.getEndpointCount(); e++) {
                UsbEndpoint ep = candidate.getEndpoint(e);
                if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK
                        && ep.getDirection() == UsbConstants.USB_DIR_OUT) {
                    iface = candidate;
                    out = ep;
                    break;
                }
            }
            if (out != null) break;
        }
        if (iface == null || out == null) { call.reject("No bulk-OUT endpoint on device"); return; }

        UsbDeviceConnection conn = mgr.openDevice(device);
        if (conn == null) { call.reject("Unable to open USB device"); return; }
        try {
            conn.claimInterface(iface, true);
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            int chunk = out.getMaxPacketSize() > 0 ? out.getMaxPacketSize() : 512;
            for (int offset = 0; offset < bytes.length; offset += chunk) {
                int len = Math.min(chunk, bytes.length - offset);
                byte[] slice = new byte[len];
                System.arraycopy(bytes, offset, slice, 0, len);
                int sent = conn.bulkTransfer(out, slice, len, 5000);
                if (sent < 0) { call.reject("bulkTransfer failed at offset " + offset); return; }
            }
            JSObject r = new JSObject();
            r.put("success", true);
            call.resolve(r);
        } finally {
            try { conn.releaseInterface(iface); } catch (Exception ignored) {}
            conn.close();
        }
    }
}
```

## 3. Register the plugin

Edit `android/app/src/main/java/net/matbex/app/MainActivity.java`:

```java
package net.matbex.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ThermalPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
```

## 4. Declare USB intents

Add to `android/app/src/main/AndroidManifest.xml` inside the `<activity>` for `MainActivity`:

```xml
<intent-filter>
    <action android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED" />
</intent-filter>
<meta-data
    android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED"
    android:resource="@xml/device_filter" />
```

Create `android/app/src/main/res/xml/device_filter.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- TA-900U is an HID-class ESC/POS printer; broad filter catches all
         common 58/80 mm USB thermal printers. Adjust if you only want one. -->
    <usb-device class="7" />          <!-- USB printer class -->
    <usb-device class="255" />        <!-- Vendor-specific (TA-900U fallback) -->
</resources>
```

## 5. Build & run

```bash
npm run build
npx cap sync android
npx cap run android   # plug the TA-900U into the device via OTG first
```

## 6. In Matbex

Settings → POS Hardware → **Apply TA-900U preset** → **Detect USB printer**.
The "Test drawer kick" button sends the ESC/POS pulse `27,112,0,25,250` to
the RJ11 cash-drawer port on the printer.

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| `No USB thermal printer detected` | Re-seat the OTG cable, tap *Allow* on the Android USB prompt, reopen the app. |
| Garbled characters | Confirm the printer is in ESC/POS mode (DIP switches under the TA-900U). |
| Drawer doesn't open | Confirm the drawer's RJ11 cable is in the *Cash Drawer* port on the printer, not the LAN port. |
| Works once then stops | Disable Android's *USB power saving* for the Matbex app. |
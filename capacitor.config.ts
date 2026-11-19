import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration for the Matbex Android POS terminal.
 *
 * The optional `server.url` enables hot-reload from a dev server during
 * development. Leave it unset for production APK builds so the app loads
 * the bundled web assets.
 */
const config: CapacitorConfig = {
  appId: "net.matbex.app",
  appName: "matbex",
  webDir: "dist",
  // To enable hot-reload from your local dev server, uncomment and set your
  // machine's LAN IP. Leave it disabled for standalone APKs.
  // server: {
  //   url: "http://192.168.1.10:8080",
  //   cleartext: true,
  // },
  android: {
    allowMixedContent: true,
    // Draw behind system bars for a true fullscreen POS experience.
    // Combined with immersive mode in MainActivity, hides status + nav bars.
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#00A859",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
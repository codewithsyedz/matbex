import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration for the Matbex Android POS terminal.
 *
 * The `server.url` enables hot-reload from the Lovable sandbox during
 * development. Remove `server.url` (or point it at your published domain)
 * for production APK builds so the app loads the bundled web assets.
 */
const config: CapacitorConfig = {
  appId: "net.matbex.app",
  appName: "matbex",
  webDir: "dist",
  // To enable hot-reload from the Lovable sandbox during development,
  // uncomment the block below. Leave it disabled for standalone APKs
  // so the app loads the bundled web assets from dist/.
  // server: {
  //   url: "https://6d7e02d6-71b7-49c7-8974-833cd1b54c5f.lovableproject.com?forceHideBadge=true",
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
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Base URL of the Matbex API, e.g. https://api.matbex.com */
  readonly VITE_API_URL: string;
  /** Public anon key of the API deployment (role "anon"). */
  readonly VITE_API_KEY: string;
  readonly VITE_API_URL_KSA?: string;
  readonly VITE_API_KEY_KSA?: string;
  readonly VITE_PREVIEW_DOMAIN?: string;
  readonly VITE_STORAGE_CDN_HOST?: string;
}

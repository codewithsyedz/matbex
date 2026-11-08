# Image CDN setup (cdn.matbex.com)

Menu item images are stored in backend storage and are served from a host like
`https://<project>.supabase.co/storage/v1/object/public/menu-images/...`.
To present them under our own domain (`https://cdn.matbex.com`) we rewrite the
origin in the app and put a Cloudflare Worker in front that proxies the request
to the backend storage endpoint.

## App side (already done)

- `src/lib/imageCdn.ts` exposes `toCdnUrl(url)` which rewrites any
  `https://<project>.supabase.co/storage/v1/object/public/...` URL to
  `https://cdn.matbex.com/storage/v1/object/public/...`, preserving the path and
  query string. Non-matching URLs pass through unchanged (idempotent).
- The CDN origin is configurable via `VITE_STORAGE_CDN_HOST` (default
  `https://cdn.matbex.com`). If you use a different subdomain, set this env var.
- `toCdnUrl` is applied at every menu image render site (Menu, POS / RecordSale,
  RecordSaleMobile, Kiosk, PublicOrder, TenantLanding, GuestOrder), in the live
  menu hooks (`useMenuItems`, `useLiveMenuItems`), in JSON-LD schema markup, in
  the Jahez export, and in the uploader (new uploads persist the CDN URL).
  Existing rows are normalized at read, so no data migration is required.

## Cloudflare side (one-time)

1. Create a CNAME `cdn.matbex.com` (or your chosen subdomain) pointing to the
   Worker route, or add a Worker route / custom domain for `cdn.matbex.com`
   in your Cloudflare dashboard.

2. Create a Worker (Workers & Pages → Create Worker) with this code:

   ```js
   export default {
     async fetch(request) {
       const url = new URL(request.url);
       // Origin = your backend storage host, e.g. https://<project>.supabase.co
       const origin = SUPABASE_STORAGE_ORIGIN; // set in Worker settings (no trailing slash)
       const target = origin + url.pathname + url.search;
       const upstream = await fetch(target, {
         method: request.method,
         headers: { Range: request.headers.get("Range") || "" },
       });
       const headers = new Headers(upstream.headers);
       headers.set("Cache-Control", "public, max-age=31536000, immutable");
       headers.set("Access-Control-Allow-Origin", "*");
       return new Response(upstream.body, { status: upstream.status, headers });
     },
   };
   ```

3. In the Worker **Settings → Variables**, add:

   - `SUPABASE_STORAGE_ORIGIN` = `https://<project>.supabase.co`

   Use the host from any existing menu image URL (the part before
   `/storage/v1/object/public/menu-images/...`).

4. Bind the Worker to `cdn.matbex.com` (Workers Routes → Custom Domain, or
   Dashboard → DNS → CNAME → proxied). The app rewrites only the origin and keeps
   `/storage/v1/object/public/menu-images/...`, so the Worker simply forwards
   the path + query.

## Verifying

- Open the Menu page and inspect any menu item image: the `src` should start with
  `https://cdn.matbex.com/...` instead of the backend host.
- The public live menu, POS, Kiosk, order pages, and JSON-LD should all use the
  CDN host.

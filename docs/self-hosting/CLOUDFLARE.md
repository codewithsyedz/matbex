# Cloudflare in front of Matbex

```
Visitor ──► Cloudflare (DNS proxy, WAF, edge rate limits, cache)
              └──► Caddy (TLS at origin, real client IP) ──► web (nginx) / api (Fastify) ──► Postgres · Redis · S3
```

Cloudflare is the outer layer from the target architecture: traffic filtering, edge caching and
coarse rate limiting. The API still enforces its own limits (Redis-backed, per real client IP),
authentication, and Postgres RLS. Cloudflare is an extra layer, not the only one.

## 1. DNS

| Record | Points to | Proxy |
| --- | --- | --- |
| `APP_DOMAIN` (e.g. `app.matbex.com`) | server IP | Proxied (orange cloud) |
| `API_DOMAIN` (e.g. `api.matbex.com`) | server IP | Proxied |
| `VITE_STORAGE_CDN_HOST`, if used | see section 5 | Proxied |

## 2. TLS

* **SSL/TLS → Overview → Full (strict).** Never use *Flexible*: it would send traffic to the origin
  unencrypted, and Caddy would answer with redirect loops.
* Caddy gets Let's Encrypt certificates for both hostnames by itself. If the first issuance fails
  while the records are proxied, set them to *DNS only* (grey cloud), start the stack, wait until
  Caddy logs `certificate obtained successfully`, then switch them back to *Proxied*.
* **Edge Certificates:** turn on *Always Use HTTPS* and set the minimum TLS version to 1.2.

## 3. Real client IP (already configured)

`deploy/Caddyfile` trusts only Cloudflare's published ranges (<https://www.cloudflare.com/ips/>).
It reads `CF-Connecting-IP` only from requests that come from those ranges, and forwards that single
address to the API. Requests that reach the server directly cannot spoof their IP. Rate limits, the
auth audit log and request logs all see the visitor's address.

The ranges are built into the Caddyfile (current as of 2026-11). If Cloudflare publishes new ones,
update the default list in `deploy/Caddyfile`. Alternatively, give the `caddy` service a
`TRUSTED_PROXIES` environment variable (space-separated CIDRs) in a compose override and restart
Caddy. Never set it to an empty value: Caddy would then trust no proxy, and every visitor would
appear as a Cloudflare address.

## 4. Lock the origin to Cloudflare (recommended)

Otherwise anyone who finds the server IP can bypass the WAF. On the server, allow 80/443 only
from Cloudflare (SSH stays open):

```sh
for r in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
  sudo ufw allow proto tcp from "$r" to any port 80,443
done
sudo ufw allow OpenSSH
sudo ufw default deny incoming
sudo ufw enable
```

Docker publishes ports through its own iptables rules, which bypass `ufw`. Either bind Caddy's ports
to the host's public interface and filter in the `DOCKER-USER` chain, or use your cloud provider's
firewall (security group) with the same Cloudflare ranges. The provider firewall is the simpler
option.

## 5. Caching

| Rule | Match | Setting |
| --- | --- | --- |
| Static app assets | host `APP_DOMAIN` and path starts with `/assets/` | Eligible for cache, respect origin TTL (nginx sends `immutable`, 1 year; file names are content-hashed) |
| App shell | host `APP_DOMAIN`, everything else | Respect origin (`no-cache`), so new deploys show up immediately |
| Public files | host `API_DOMAIN` and path starts with `/storage/v1/object/public/` | Eligible for cache, edge TTL e.g. 1 hour |
| Everything else on the API | host `API_DOMAIN` | **Bypass cache.** Responses are per user. |

Never cache `/auth/v1`, `/rest/v1`, `/functions/v1`, `/storage/v1/object/authenticated`,
`/storage/v1/object/sign`, `/realtime/v1` or `/socket.io`.

## 6. WAF and bot rules

* **Security → WAF → Managed rules:** enable the Cloudflare Managed Ruleset and the OWASP Core
  Ruleset. Start the OWASP set in *Log* mode for a week, check what it would have blocked, then switch
  it to *Block*. JSON request bodies (POS sync, reports) can trip generic SQL-injection rules.
* **Skip challenges for machine traffic.** Add a custom rule with action *Skip* (WAF managed rules,
  Bot Fight Mode, rate limiting) for these paths on `API_DOMAIN`:
  * webhooks: `/functions/v1/stripe-webhook`, `/functions/v1/checkout-com-webhook`,
    `/functions/v1/payments-webhook`, `/functions/v1/delivery-webhook`,
    `/functions/v1/twilio-status-webhook`
  * POS terminals and the Android app: `/functions/v1/terminal-api`, `/functions/v1/pos-sync`
  * the realtime websockets: `/realtime/v1/websocket` and `/socket.io/`

  These clients cannot solve a JavaScript challenge. Each of them authenticates itself (webhook
  signatures, terminal keys, JWTs).
* **Bot Fight Mode:** leave it off, or exclude `API_DOMAIN`, for the same reason.

## 7. Edge rate limits

The API already limits sign-in (30 per 5 minutes per IP), sign-up and password recovery (Redis-backed).
Cloudflare limits stop floods before they reach the server:

| Match on `API_DOMAIN` | Limit | Action |
| --- | --- | --- |
| `/auth/v1/token`, `/auth/v1/signup`, `/auth/v1/recover`, `/auth/v1/otp` | 20 requests / 1 minute per IP | Block for 10 minutes |
| `/functions/v1/send-contact-enquiry`, `/functions/v1/qr-create-order`, `/functions/v1/track-login-attempt` | 30 / minute per IP | Managed challenge |
| Everything else | 600 / minute per IP | Log first, then Block |

Many staff behind one restaurant router share an IP, so keep the global limit generous.

## 8. Other settings

* **Network → WebSockets:** on (live updates).
* **Upload limit:** 100 MB on Free and Pro plans, which is above the API's 60 MB (`STORAGE_MAX_UPLOAD_MB`).
* **Timeouts:** Cloudflare closes a request after 100 seconds. Long exports and reports must stay below
  that (they already run as background jobs: `process-export-requests`).
* **Rocket Loader, Auto Minify, Email Obfuscation:** off for `APP_DOMAIN`. They rewrite the built app.

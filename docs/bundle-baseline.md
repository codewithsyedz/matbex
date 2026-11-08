# Bundle Baseline

Captured: 2026-06-03 (post Stage A AuthContext split, fetch-guard install).
Build: `bun run build` (Vite 5, production mode).

## Enforced budget (CI, `.size-limit.json`)

| Metric | Budget (gzip) | Current | Headroom |
|---|---|---|---|
| Initial JS (`dist/assets/index-*.js`) | 250 KB | 242.68 KB | ~3% |

The initial-JS budget is the only hard-fail gate in CI. It tracks the bytes
the browser must download before first interactive paint for any route.

## Reference: top route/vendor chunks (informational, not enforced)

| Chunk | Raw | Gzip |
|---|---|---|
| `index-*.js` (entry) | 812.35 KB | 236.04 KB |
| `AdminA11yDialogs-*.js` | 7,678.36 KB | 1,495.51 KB |
| `charts-vendor-*.js` | 576.58 KB | 159.86 KB |
| `jspdf.es.min-*.js` | 416.10 KB | 134.78 KB |
| `QRScanner-*.js` | 338.86 KB | 101.20 KB |
| `Settings-*.js` | 337.92 KB | 78.70 KB |
| `lottie_worker-*.js` | 321.67 KB | 82.60 KB |
| `Sales-*.js` | 215.95 KB | 53.24 KB |

## Known regressions to investigate

- **`AdminA11yDialogs` (1.49 MB gzip)** is by far the largest single chunk.
  Likely pulls in a dev/test dialog tree that shouldn't ship to end users.
  Audit before adding a per-route budget.
- Lottie variants (`lottie_*`) duplicate ~250 KB raw per renderer. Consider
  pinning to a single renderer globally.

## How to update this baseline

1. `bun run build`
2. Replace the table above with the new top-of-list chunks from Vite's report.
3. Note the date and the PR/commit that justifies the shift.
4. If the initial-JS gzip moves >5%, open a perf issue and tighten or loosen
   `.size-limit.json` deliberately — never silently.

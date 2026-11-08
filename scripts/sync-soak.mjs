#!/usr/bin/env node
/**
 * Epic E2 — Sync soak harness.
 *
 * Spins up N virtual terminals that hammer the /pos-sync batch endpoint
 * at X batches/sec for T minutes and prints a latency report.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *   E2E_JWT=<cashier-access-token> E2E_BRANCH_ID=<branch-uuid> \
 *   node scripts/sync-soak.mjs --terminals=10 --tps=5 --minutes=5
 *
 * Writes a Markdown report to docs/perf/sync-soak-<ISO>.md and echoes it.
 *
 * Notes:
 *   - Uses only the built-in `fetch` from Node ≥ 18. No new deps.
 *   - Each batch is one CASH_DRAWER event with a fresh idempotency key so
 *     nothing corrupts real sales data; run against a scratch tenant.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

const TERMINALS = Number(args.terminals ?? 5);
const TPS = Number(args.tps ?? 2);
const MINUTES = Number(args.minutes ?? 1);
const BATCH_SIZE = Number(args["batch-size"] ?? 10);

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const JWT = process.env.E2E_JWT;
const BRANCH = process.env.E2E_BRANCH_ID;

if (!SUPABASE_URL || !ANON || !JWT || !BRANCH) {
  console.error(
    "Missing env: SUPABASE_URL, SUPABASE_ANON_KEY, E2E_JWT, E2E_BRANCH_ID are all required.",
  );
  process.exit(2);
}

const URL = `${SUPABASE_URL}/functions/v1/pos-sync`;
const stopAt = Date.now() + MINUTES * 60_000;

const latencies = []; // ms
let ok = 0;
let failed = 0;
let bytesIn = 0;

function makeBatch(terminalId) {
  const items = [];
  for (let i = 0; i < BATCH_SIZE; i++) {
    items.push({
      idempotency_key: `soak-${randomUUID()}`,
      entity_type: "CASH_DRAWER",
      operation: "CREATE",
      payload: {
        event_type: "adjustment",
        amount: 0,
        shift_id: `soak-shift-${terminalId}`,
      },
    });
  }
  return items;
}

async function sendOne(terminalId) {
  const t0 = performance.now();
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON,
        Authorization: `Bearer ${JWT}`,
        "X-Terminal-Id": terminalId,
        "X-Branch-Id": BRANCH,
        "X-Request-Id": randomUUID(),
      },
      body: JSON.stringify({ items: makeBatch(terminalId) }),
    });
    const body = await res.text();
    bytesIn += body.length;
    const dt = performance.now() - t0;
    latencies.push(dt);
    if (res.ok) ok++;
    else failed++;
  } catch {
    failed++;
    latencies.push(performance.now() - t0);
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function terminalLoop(terminalId) {
  const intervalMs = 1000 / TPS;
  while (Date.now() < stopAt) {
    const started = Date.now();
    await sendOne(terminalId);
    const elapsed = Date.now() - started;
    const wait = intervalMs - elapsed;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

console.log(
  `[soak] ${TERMINALS} terminals × ${TPS} tps × ${MINUTES} min · batch=${BATCH_SIZE}`,
);
const start = Date.now();
await Promise.all(
  Array.from({ length: TERMINALS }, (_, i) => terminalLoop(`soak-t${i + 1}`)),
);
const elapsedSec = (Date.now() - start) / 1000;

const sorted = [...latencies].sort((a, b) => a - b);
const p50 = percentile(sorted, 50);
const p95 = percentile(sorted, 95);
const p99 = percentile(sorted, 99);
const avg = sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1);
const totalReq = ok + failed;
const errorRate = totalReq === 0 ? 0 : (failed / totalReq) * 100;

const now = new Date().toISOString();
const md = `# POS sync soak report

- **Timestamp:** ${now}
- **Terminals:** ${TERMINALS}
- **Target TPS/terminal:** ${TPS}
- **Duration:** ${MINUTES} min (${elapsedSec.toFixed(1)}s wall clock)
- **Batch size:** ${BATCH_SIZE} events

## Throughput

| Metric | Value |
| --- | --- |
| Total requests | ${totalReq} |
| Successful | ${ok} |
| Failed | ${failed} |
| Error rate | ${errorRate.toFixed(2)}% |
| Effective req/s | ${(totalReq / elapsedSec).toFixed(2)} |
| Effective events/s | ${((totalReq * BATCH_SIZE) / elapsedSec).toFixed(2)} |
| Response bytes | ${bytesIn} |

## Latency (ms)

| p50 | p95 | p99 | avg | max |
| --- | --- | --- | --- | --- |
| ${p50.toFixed(1)} | ${p95.toFixed(1)} | ${p99.toFixed(1)} | ${avg.toFixed(1)} | ${(sorted[sorted.length - 1] ?? 0).toFixed(1)} |

## Interpretation

- Aim for **p95 < 400 ms** and **error rate < 0.5%** on baseline hardware.
- If p99 spikes above 1.5s, check edge-function cold starts on the sync-health dashboard.
- A rising error rate at high TPS usually means Postgres connection pool exhaustion; scale up compute or add backoff to the client batcher.
`;

const outPath = `docs/perf/sync-soak-${now.replace(/[:.]/g, "-")}.md`;
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, md, "utf8");
console.log(md);
console.log(`[soak] Wrote report → ${outPath}`);
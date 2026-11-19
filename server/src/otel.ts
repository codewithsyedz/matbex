/**
 * Optional OpenTelemetry tracing, loaded before the app with `node --import`.
 * Does nothing unless OTEL_EXPORTER_OTLP_ENDPOINT is set (e.g. http://alloy:4318), so the
 * API runs the same with or without the observability stack.
 *
 * Traces incoming HTTP (Fastify), outgoing HTTP/fetch (PostgREST, Stripe, Resend, ...),
 * and Redis. postgres.js has no OpenTelemetry instrumentation; database time shows up as
 * the PostgREST hop or inside the request span.
 */
import { register } from "node:module";

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  // ESM modules can only be patched through the loader hook, registered before they load.
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": process.env.OTEL_SERVICE_NAME ?? "matbex-api",
      "deployment.environment": process.env.NODE_ENV ?? "development",
    }),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Noisy and low-value for this API.
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-net": { enabled: false },
        // Health checks and metric scrapes would dominate traces.
        "@opentelemetry/instrumentation-http": {
          ignoreIncomingRequestHook: (req) => req.url === "/health" || req.url === "/metrics",
        },
      }),
    ],
  });
  sdk.start();
  const stop = () => void sdk.shutdown().catch(() => undefined);
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

export {};

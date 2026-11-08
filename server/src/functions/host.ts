/**
 * /functions/v1/:name — hosts the server functions in server/functions/*.
 *
 * Each function module calls serve(handler) at load; the host converts the
 * Fastify request into a Web Request, runs the handler, and streams the Web
 * Response back. Functions listed as "public" in functions.config.json
 * receive the request untouched (webhooks, scheduler, public endpoints).
 * All others require a valid Matbex JWT when an Authorization header is
 * present; anonymous callers get the anon key so legacy code paths behave.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "../config.js";
import { bearer, verify } from "../lib/jwt.js";

type Handler = (req: Request) => Response | Promise<Response>;
const g = globalThis as typeof globalThis & {
  __matbexFunctionLoading?: string;
  __matbexFunctions?: Map<string, Handler>;
};

const here = dirname(fileURLToPath(import.meta.url));

/** dev: <repo>/server/functions/<name>/index.ts — prod: dist/functions/<name>.mjs */
function locateFunctions(): { dir: string; entry: (name: string) => string | null; names: string[] } {
  const bundled = join(here, "functions");
  if (existsSync(join(bundled, "_manifest.json"))) {
    const names = JSON.parse(readFileSync(join(bundled, "_manifest.json"), "utf8")) as string[];
    return { dir: bundled, names, entry: (n) => join(bundled, `${n}.mjs`) };
  }
  const src = join(here, "..", "..", "functions");
  const names = readdirSync(src, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(join(src, d.name, "index.ts")))
    .map((d) => d.name);
  return { dir: src, names, entry: (n) => join(src, n, "index.ts") };
}

function publicFunctions(): Set<string> {
  const candidates = [join(here, "functions", "functions.config.json"), join(here, "..", "..", "functions", "functions.config.json")];
  for (const p of candidates) {
    if (existsSync(p)) return new Set((JSON.parse(readFileSync(p, "utf8")).public as string[]) ?? []);
  }
  return new Set();
}

export async function loadFunctions(log: FastifyInstance["log"]) {
  const { names, entry } = locateFunctions();
  const failed: string[] = [];
  for (const name of names) {
    g.__matbexFunctionLoading = name;
    try {
      await import(pathToFileURL(entry(name)!).href);
      if (!g.__matbexFunctions?.has(name)) failed.push(`${name} (no serve() call)`);
    } catch (err) {
      failed.push(name);
      const message = (err as Error)?.message ?? String(err);
      log.error({ fn: name, err: message }, "function failed to initialize (usually a missing env var)");
      (g.__matbexFunctions ??= new Map()).set(name, () =>
        Response.json({ error: `Function ${name} is not available: ${message}` }, { status: 503 }),
      );
    } finally {
      g.__matbexFunctionLoading = undefined;
    }
  }
  log.info({ loaded: names.length - failed.length, failed }, "server functions loaded");
  return { loaded: [...(g.__matbexFunctions?.keys() ?? [])], failed };
}

/** Invoke a function in-process (scheduler, net.http queue). */
export async function invokeFunction(name: string, init: { method?: string; headers?: Record<string, string>; body?: string }) {
  const fn = g.__matbexFunctions?.get(name);
  if (!fn) throw new Error(`function ${name} not loaded`);
  const req = new Request(`${config.API_URL}/functions/v1/${name}`, { method: init.method ?? "POST", headers: init.headers, body: init.body });
  return fn(req);
}

export async function functionRoutes(app: FastifyInstance) {
  const open = publicFunctions();
  app.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 25 * 1024 * 1024 }, (_r, body, done) => done(null, body));
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_r, body, done) => done(null, body));
  app.removeContentTypeParser("text/plain");
  app.addContentTypeParser("text/plain", { parseAs: "buffer" }, (_r, body, done) => done(null, body));

  const handle = async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const fn = g.__matbexFunctions?.get(name);
    if (!fn) return reply.code(404).send({ code: "NOT_FOUND", message: `Function ${name} not found` });

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || k === "host" || k === "content-length" || k === "connection") continue;
      headers.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }

    if (!open.has(name) && req.method !== "OPTIONS") {
      const token = bearer(headers.get("authorization"));
      if (token) {
        try {
          await verify(token);
        } catch {
          return reply.code(401).send({ code: 401, message: "Invalid JWT" });
        }
      } else {
        headers.set("authorization", `Bearer ${config.ANON_KEY}`);
      }
    }

    // Expose client IP the way edge runtimes did.
    if (!headers.has("x-forwarded-for")) headers.set("x-forwarded-for", req.ip);
    const url = `${config.API_URL}${req.raw.url!.replace(/^\/+/, "/")}`;
    const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== undefined && req.body !== null;
    const webReq = new Request(url, {
      method: req.method,
      headers,
      body: hasBody ? new Uint8Array(req.body as Buffer) : undefined,
    });

    let res: Response;
    try {
      res = await fn(webReq);
    } catch (err) {
      req.log.error({ err, fn: name }, "function threw");
      return reply.code(500).send({ error: "Internal function error" });
    }
    reply.code(res.status);
    res.headers.forEach((value, key) => {
      if (key !== "content-length" && key !== "transfer-encoding") reply.header(key, value);
    });
    if (!res.body) return reply.send();
    return reply.send(Readable.fromWeb(res.body as any));
  };

  app.all("/:name", handle);
  app.all("/:name/*", handle);
}

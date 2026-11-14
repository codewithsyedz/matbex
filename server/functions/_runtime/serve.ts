/**
 * Server-function runtime. Each function module calls `serve(handler)` once at
 * load time; the API host (src/functions/host.ts) registers the handler and
 * routes POST/GET {API}/functions/v1/<name> to it with a standard Web
 * Request and expects a Web Response back.
 */
export type Handler = (req: Request) => Response | Promise<Response>;

const g = globalThis as typeof globalThis & {
  __matbexFunctionLoading?: string;
  __matbexFunctions?: Map<string, Handler>;
};

export function serve(handler: Handler | { handler: Handler } | any, maybeHandler?: Handler): void {
  const fn: Handler =
    typeof handler === "function" ? handler : typeof maybeHandler === "function" ? maybeHandler : handler?.handler;
  const name = g.__matbexFunctionLoading;
  if (!name) throw new Error("serve() called outside the function host");
  (g.__matbexFunctions ??= new Map()).set(name, fn);
}

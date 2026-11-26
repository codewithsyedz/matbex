/**
 * Chainable query builder for the Matbex data API.
 *
 * The data API speaks the PostgREST URL grammar (?col=eq.value&select=...),
 * so the same builder works against the API gateway in the browser and in
 * server-side code. Results resolve to { data, error, count, status, statusText }
 * and never throw unless .throwOnError() is used.
 */
import { DbError, DbRequestError } from "./errors";

export type Fetch = typeof fetch;

export interface QueryResult<T = any> {
  data: T;
  error: DbRequestError | null;
  count: number | null;
  status: number;
  statusText: string;
}

type Count = "exact" | "planned" | "estimated";
type Method = "GET" | "HEAD" | "POST" | "PATCH" | "DELETE";

interface BuilderState {
  method: Method;
  url: URL;
  headers: Record<string, string>;
  schema?: string;
  body?: unknown;
  fetch: Fetch;
  signal?: AbortSignal;
  shouldThrow: boolean;
  isMaybeSingle: boolean;
}

const cleanColumns = (columns: string) => {
  let quoted = false;
  return columns
    .split("")
    .map((c) => {
      if (/\s/.test(c) && !quoted) return "";
      if (c === '"') quoted = !quoted;
      return c;
    })
    .join("");
};

const formatList = (values: readonly unknown[]) =>
  values
    .map((v) => (typeof v === "string" && /[,()"]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : `${v}`))
    .join(",");

const appendPrefer = (headers: Record<string, string>, value: string) => {
  headers["Prefer"] = headers["Prefer"] ? `${headers["Prefer"]},${value}` : value;
};

/** Executes the request. Base for every builder below. */
export class QueryRunner<T = any> implements PromiseLike<QueryResult<T>> {
  protected s: BuilderState;

  constructor(state: BuilderState) {
    this.s = state;
  }

  /** Throw DbRequestError instead of resolving with { error }. */
  throwOnError(): this {
    this.s.shouldThrow = true;
    return this;
  }

  setHeader(name: string, value: string): this {
    this.s.headers = { ...this.s.headers, [name]: value };
    return this;
  }

  abortSignal(signal: AbortSignal): this {
    this.s.signal = signal;
    return this;
  }

  /** Type-only helpers kept for call-site compatibility. */
  returns<R>(): QueryRunner<R> {
    return this as unknown as QueryRunner<R>;
  }
  overrideTypes<R>(): QueryRunner<R> {
    return this as unknown as QueryRunner<R>;
  }

  async execute(): Promise<QueryResult<T>> {
    const { method, url, schema, body, fetch: doFetch, signal } = this.s;
    const headers: Record<string, string> = { ...this.s.headers };
    if (schema) {
      headers[method === "GET" || method === "HEAD" ? "Accept-Profile" : "Content-Profile"] = schema;
    }
    if (method !== "GET" && method !== "HEAD") headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await doFetch(url.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (e: any) {
      const error: DbError = {
        message: `${e?.name ?? "FetchError"}: ${e?.message ?? e}`,
        details: e?.stack ?? null,
        hint: null,
        code: e?.code ?? "",
      };
      if (this.s.shouldThrow) throw new DbRequestError(error);
      return { data: null as any, error: new DbRequestError(error), count: null, status: 0, statusText: "" };
    }

    let data: any = null;
    let error: DbError | null = null;
    let count: number | null = null;
    let status = res.status;
    let statusText = res.statusText;

    const range = res.headers.get("content-range");
    if (range) {
      const total = range.split("/")[1];
      if (total && total !== "*") count = parseInt(total, 10);
    }

    if (res.ok) {
      if (method !== "HEAD") {
        const text = await res.text();
        if (text !== "") {
          data = headers["Accept"] === "text/csv" ? text : JSON.parse(text);
        }
      }
      if (this.s.isMaybeSingle && method === "GET" && Array.isArray(data)) {
        if (data.length > 1) {
          error = {
            code: "PGRST116",
            details: `Results contain ${data.length} rows, application/vnd.pgrst.object+json requires 1 row`,
            hint: null,
            message: "JSON object requested, multiple (or no) rows returned",
          };
          data = null;
          status = 406;
          statusText = "Not Acceptable";
        } else {
          data = data.length === 1 ? data[0] : null;
        }
      }
    } else {
      const text = await res.text();
      try {
        const parsed = JSON.parse(text);
        error = {
          message: parsed.message ?? parsed.error ?? text,
          details: parsed.details ?? null,
          hint: parsed.hint ?? null,
          code: parsed.code ?? String(res.status),
        };
      } catch {
        error = { message: text || res.statusText, details: null, hint: null, code: String(res.status) };
      }
      // maybeSingle on a write: zero rows is not an error.
      if (error && this.s.isMaybeSingle && error.details?.includes("0 rows")) {
        error = null;
        status = 200;
        statusText = "OK";
      }
    }

    const err = error ? new DbRequestError(error) : null;
    if (err && this.s.shouldThrow) throw err;
    return { data, error: err, count, status, statusText };
  }

  then<R1 = QueryResult<T>, R2 = never>(
    onfulfilled?: ((value: QueryResult<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

/** Ordering / paging / shaping modifiers. */
export class TransformBuilder<T = any> extends QueryRunner<T> {
  select(columns = "*"): this {
    this.s.url.searchParams.set("select", cleanColumns(columns));
    appendPrefer(this.s.headers, "return=representation");
    return this;
  }

  order(
    column: string,
    opts: { ascending?: boolean; nullsFirst?: boolean; foreignTable?: string; referencedTable?: string } = {},
  ): this {
    const { ascending = true, nullsFirst, foreignTable, referencedTable = foreignTable } = opts;
    const key = referencedTable ? `${referencedTable}.order` : "order";
    const existing = this.s.url.searchParams.get(key);
    const part = `${column}.${ascending ? "asc" : "desc"}${
      nullsFirst === undefined ? "" : nullsFirst ? ".nullsfirst" : ".nullslast"
    }`;
    this.s.url.searchParams.set(key, existing ? `${existing},${part}` : part);
    return this;
  }

  limit(count: number, opts: { foreignTable?: string; referencedTable?: string } = {}): this {
    const t = opts.referencedTable ?? opts.foreignTable;
    this.s.url.searchParams.set(t ? `${t}.limit` : "limit", String(count));
    return this;
  }

  range(from: number, to: number, opts: { foreignTable?: string; referencedTable?: string } = {}): this {
    const t = opts.referencedTable ?? opts.foreignTable;
    this.s.url.searchParams.set(t ? `${t}.offset` : "offset", String(from));
    this.s.url.searchParams.set(t ? `${t}.limit` : "limit", String(to - from + 1));
    return this;
  }

  single(): QueryRunner<any> {
    this.s.headers["Accept"] = "application/vnd.pgrst.object+json";
    return this;
  }

  maybeSingle(): QueryRunner<any> {
    if (this.s.method === "GET") this.s.headers["Accept"] = "application/json";
    else this.s.headers["Accept"] = "application/vnd.pgrst.object+json";
    this.s.isMaybeSingle = true;
    return this;
  }

  csv(): QueryRunner<string> {
    this.s.headers["Accept"] = "text/csv";
    return this as unknown as QueryRunner<string>;
  }

  geojson(): QueryRunner<any> {
    this.s.headers["Accept"] = "application/geo+json";
    return this;
  }
}

/** Row filters. */
export class FilterBuilder<T = any> extends TransformBuilder<T> {
  private add(column: string, value: string): this {
    this.s.url.searchParams.append(column, value);
    return this;
  }

  eq(column: string, value: unknown) { return this.add(column, `eq.${value}`); }
  neq(column: string, value: unknown) { return this.add(column, `neq.${value}`); }
  gt(column: string, value: unknown) { return this.add(column, `gt.${value}`); }
  gte(column: string, value: unknown) { return this.add(column, `gte.${value}`); }
  lt(column: string, value: unknown) { return this.add(column, `lt.${value}`); }
  lte(column: string, value: unknown) { return this.add(column, `lte.${value}`); }
  like(column: string, pattern: string) { return this.add(column, `like.${pattern}`); }
  ilike(column: string, pattern: string) { return this.add(column, `ilike.${pattern}`); }
  likeAnyOf(column: string, patterns: string[]) { return this.add(column, `like(any).{${patterns.join(",")}}`); }
  ilikeAnyOf(column: string, patterns: string[]) { return this.add(column, `ilike(any).{${patterns.join(",")}}`); }
  is(column: string, value: boolean | null) { return this.add(column, `is.${value}`); }
  in(column: string, values: readonly unknown[]) { return this.add(column, `in.(${formatList(values)})`); }

  contains(column: string, value: string | readonly unknown[] | Record<string, unknown>) {
    if (typeof value === "string") return this.add(column, `cs.${value}`);
    if (Array.isArray(value)) return this.add(column, `cs.{${value.join(",")}}`);
    return this.add(column, `cs.${JSON.stringify(value)}`);
  }
  containedBy(column: string, value: string | readonly unknown[] | Record<string, unknown>) {
    if (typeof value === "string") return this.add(column, `cd.${value}`);
    if (Array.isArray(value)) return this.add(column, `cd.{${value.join(",")}}`);
    return this.add(column, `cd.${JSON.stringify(value)}`);
  }
  overlaps(column: string, value: string | readonly unknown[]) {
    if (typeof value === "string") return this.add(column, `ov.${value}`);
    return this.add(column, `ov.{${value.join(",")}}`);
  }
  rangeGt(column: string, range: string) { return this.add(column, `sr.${range}`); }
  rangeGte(column: string, range: string) { return this.add(column, `nxl.${range}`); }
  rangeLt(column: string, range: string) { return this.add(column, `sl.${range}`); }
  rangeLte(column: string, range: string) { return this.add(column, `nxr.${range}`); }
  rangeAdjacent(column: string, range: string) { return this.add(column, `adj.${range}`); }

  textSearch(column: string, query: string, opts: { config?: string; type?: "plain" | "phrase" | "websearch" } = {}) {
    const op = opts.type === "plain" ? "plfts" : opts.type === "phrase" ? "phfts" : opts.type === "websearch" ? "wfts" : "fts";
    const cfg = opts.config ? `(${opts.config})` : "";
    return this.add(column, `${op}${cfg}.${query}`);
  }

  match(query: Record<string, unknown>) {
    Object.entries(query).forEach(([k, v]) => this.add(k, `eq.${v}`));
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    return this.add(column, `not.${operator}.${value}`);
  }

  or(filters: string, opts: { foreignTable?: string; referencedTable?: string } = {}) {
    const t = opts.referencedTable ?? opts.foreignTable;
    return this.add(t ? `${t}.or` : "or", `(${filters})`);
  }

  filter(column: string, operator: string, value: unknown) {
    return this.add(column, `${operator}.${value}`);
  }
}

/** Entry point for a table/view: choose the verb. */
export class TableBuilder {
  constructor(
    private url: URL,
    private headers: Record<string, string>,
    private fetchImpl: Fetch,
    private schema?: string,
  ) {}

  private state(method: Method, body?: unknown): BuilderState {
    return {
      method,
      url: new URL(this.url.toString()),
      headers: { ...this.headers },
      schema: this.schema,
      body,
      fetch: this.fetchImpl,
      shouldThrow: false,
      isMaybeSingle: false,
    };
  }

  select(columns = "*", opts: { head?: boolean; count?: Count } = {}): FilterBuilder<any> {
    const st = this.state(opts.head ? "HEAD" : "GET");
    st.url.searchParams.set("select", cleanColumns(columns));
    if (opts.count) st.headers["Prefer"] = `count=${opts.count}`;
    return new FilterBuilder(st);
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[], opts: { count?: Count; defaultToNull?: boolean } = {}): FilterBuilder<any> {
    const st = this.state("POST", values);
    const prefer: string[] = [];
    if (opts.count) prefer.push(`count=${opts.count}`);
    if (opts.defaultToNull === false) prefer.push("missing=default");
    if (prefer.length) st.headers["Prefer"] = prefer.join(",");
    if (Array.isArray(values)) {
      const cols = [...new Set(values.flatMap((v) => Object.keys(v)))];
      if (cols.length) st.url.searchParams.set("columns", cols.map((c) => `"${c}"`).join(","));
    }
    return new FilterBuilder(st);
  }

  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    opts: { onConflict?: string; ignoreDuplicates?: boolean; count?: Count; defaultToNull?: boolean } = {},
  ): FilterBuilder<any> {
    const st = this.state("POST", values);
    const prefer = [`resolution=${opts.ignoreDuplicates ? "ignore" : "merge"}-duplicates`];
    if (opts.count) prefer.push(`count=${opts.count}`);
    if (opts.defaultToNull === false) prefer.push("missing=default");
    st.headers["Prefer"] = prefer.join(",");
    if (opts.onConflict) st.url.searchParams.set("on_conflict", opts.onConflict);
    if (Array.isArray(values)) {
      const cols = [...new Set(values.flatMap((v) => Object.keys(v)))];
      if (cols.length) st.url.searchParams.set("columns", cols.map((c) => `"${c}"`).join(","));
    }
    return new FilterBuilder(st);
  }

  update(values: Record<string, unknown>, opts: { count?: Count } = {}): FilterBuilder<any> {
    const st = this.state("PATCH", values);
    if (opts.count) st.headers["Prefer"] = `count=${opts.count}`;
    return new FilterBuilder(st);
  }

  delete(opts: { count?: Count } = {}): FilterBuilder<any> {
    const st = this.state("DELETE");
    if (opts.count) st.headers["Prefer"] = `count=${opts.count}`;
    return new FilterBuilder(st);
  }
}

/** Calls a SQL function: POST {base}/rpc/{fn}. */
export function rpcBuilder(
  baseUrl: string,
  fn: string,
  args: Record<string, unknown> = {},
  opts: { head?: boolean; get?: boolean; count?: Count } = {},
  headers: Record<string, string>,
  fetchImpl: Fetch,
  schema?: string,
): FilterBuilder<any> {
  const url = new URL(`${baseUrl}/rpc/${fn}`);
  let method: Method = "POST";
  let body: unknown = args;
  if (opts.head || opts.get) {
    method = opts.head ? "HEAD" : "GET";
    Object.entries(args)
      .filter(([, v]) => v !== undefined)
      .forEach(([k, v]) => url.searchParams.append(k, Array.isArray(v) ? `{${v.join(",")}}` : `${v}`));
    body = undefined;
  }
  const h = { ...headers };
  if (opts.count) h["Prefer"] = `count=${opts.count}`;
  return new FilterBuilder({
    method,
    url,
    headers: h,
    schema,
    body,
    fetch: fetchImpl,
    shouldThrow: false,
    isMaybeSingle: false,
  });
}

/**
 * Minimal but *filter-aware* the API query-builder mock.
 *
 * Unlike a pass-through stub, this mock actually applies `.eq()`, `.is()`,
 * `.in()`, `.gte()`, `.lte()`, `.lt()` and `.neq()` against the seeded rows.
 * That is what makes it useful for branch-scoping tests: if production code
 * forgets a `branch_id` filter, the returned rows change and the test fails.
 */
export type Row = Record<string, any>;
export type Tables = Record<string, Row[]>;

export function createDbTableMock(seed: Tables) {
  const tables: Tables = JSON.parse(JSON.stringify(seed));

  const from = (table: string) => {
    let rows: Row[] = (tables[table] ?? []).slice();
    const api: any = {
      select: () => api,
      order: () => api,
      limit: (n: number) => {
        rows = rows.slice(0, n);
        return api;
      },
      // Paging, as PostgREST: inclusive row window.
      range: (from: number, to: number) => {
        rows = rows.slice(from, to + 1);
        return api;
      },
      eq: (c: string, v: any) => {
        rows = rows.filter((r) => r[c] === v);
        return api;
      },
      neq: (c: string, v: any) => {
        rows = rows.filter((r) => r[c] !== v);
        return api;
      },
      is: (c: string, v: any) => {
        rows = rows.filter((r) => (r[c] ?? null) === v);
        return api;
      },
      in: (c: string, vs: any[]) => {
        rows = rows.filter((r) => vs.includes(r[c]));
        return api;
      },
      gte: (c: string, v: any) => {
        rows = rows.filter((r) => r[c] >= v);
        return api;
      },
      gt: (c: string, v: any) => {
        rows = rows.filter((r) => r[c] > v);
        return api;
      },
      lte: (c: string, v: any) => {
        rows = rows.filter((r) => r[c] <= v);
        return api;
      },
      lt: (c: string, v: any) => {
        rows = rows.filter((r) => r[c] < v);
        return api;
      },
      then: (resolve: any, reject?: any) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    };
    return api;
  };

  return {
    db: { from },
    /** Replace the rows of a table between tests. */
    setTable: (t: string, rows: Row[]) => {
      tables[t] = rows;
    },
    getTable: (t: string) => tables[t] ?? [],
  };
}

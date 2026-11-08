// Dev-only: eagerly pull the raw source for every TS/TSX file in src/ so the
// dialog accessibility audit can scan them in the browser.
// This module must ONLY be imported behind `import.meta.env.DEV`, otherwise the
// entire source tree (>10 MB) gets inlined into the production bundle and the
// build times out.
const SOURCES = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export default SOURCES;

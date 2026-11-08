/**
 * Matbex motion tokens.
 *
 * One vocabulary for the whole product: four curves, five durations,
 * one stagger scale. Anything that moves should reference these — never a
 * hand-tuned duration inline. Motion is transform/opacity only.
 */

/** Curves. Named by intent, not by math. */
export const EASE = {
  /** Default: fast out, long settle. Entrances, reveals, page scenes. */
  entrance: [0.22, 1, 0.36, 1] as const,
  /** Exits and dismissals — leaves quicker than it arrives. */
  exit: [0.4, 0, 1, 1] as const,
  /** Interface response: hover, press, toggles. Symmetrical, no overshoot. */
  ui: [0.4, 0, 0.2, 1] as const,
  /** Physical settle with a hint of weight. Panels, drawers, snap. */
  settle: [0.16, 1.06, 0.3, 1] as const,
} satisfies Record<string, readonly number[]>;

/** Durations in seconds. */
export const DUR = {
  /** 120ms — colour, opacity, icon swaps. */
  instant: 0.12,
  /** 200ms — hover, press, small state change. Product default. */
  quick: 0.2,
  /** 400ms — element entrance, popovers, list items. */
  base: 0.4,
  /** 650ms — section reveals, hero copy, large surfaces. */
  scene: 0.65,
  /** 900ms — first paint choreography only. Never for interaction. */
  cinematic: 0.9,
} as const;

/** Gap between siblings in a staggered group. */
export const STAGGER = {
  tight: 0.045,
  base: 0.08,
  loose: 0.13,
} as const;

/** Distance an element travels on entrance, in px. Keep it small — depth, not flight. */
export const TRAVEL = {
  sm: 10,
  md: 18,
  lg: 28,
} as const;

/** How much of an element must be visible before it reveals. */
export const VIEWPORT = { once: true, amount: 0.25, margin: "0px 0px -12% 0px" } as const;

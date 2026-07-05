#!/usr/bin/env node
/**
 * live-test.js — unit tests for decideSideOutAction (extracted from live.js).
 *
 * Run: node live/live-test.js
 *
 * Tests the five observable two-poll cases for the side-out flash decision:
 *   1. Heartbeat      — same pointsCount, new updatedAt  → none
 *   2. Singles SIDE OUT — pointsCount+1, score unchanged, sideOutRaw, null→null → flash
 *   3. Doubles handoff  — pointsCount+1, score unchanged, sideOutRaw, 1→2       → handoff
 *   4. Doubles SIDE OUT — pointsCount+1, score unchanged, sideOutRaw, 2→1       → flash
 *   5. Scored rally     — pointsCount+1, score changed                           → none
 *
 * This is a verbatim copy of the pure function from live.js — keep in sync.
 */

/* ── Copy of decideSideOutAction from live.js ─────────────────────────── */
function decideSideOutAction(prev, current) {
  // Gate on a real rally: pointsCount must increase.
  const hasRealRally =
    Number.isFinite(current.pointsCount) &&
    Number.isFinite(prev.pointsCount) &&
    current.pointsCount > prev.pointsCount;
  if (!hasRealRally) return "none";

  // If the score changed, a point was awarded — not a side-out.
  const scoreChanged =
    current.tiebreakPointsA !== prev.tiebreakPointsA ||
    current.tiebreakPointsB !== prev.tiebreakPointsB ||
    current.setsWonByA      !== prev.setsWonByA      ||
    current.setsWonByB      !== prev.setsWonByB;
  if (scoreChanged) return "none";

  // sideOutRaw is a static format flag — only pickleball sets this true.
  if (current.sideOutRaw !== true) return "none";

  // Doubles intra-team server handoff (server 1 → 2, same team): no SIDE OUT.
  if (prev.serverNumberRaw === 1 && current.serverNumberRaw === 2) return "handoff";

  // All other cases (singles null→null, doubles across teams 2→1): real SIDE OUT.
  return "flash";
}
/* ── End copy ─────────────────────────────────────────────────────────── */

/* Shared baseline score state for both polls in each case. */
const BASE = {
  tiebreakPointsA: 5,
  tiebreakPointsB: 3,
  setsWonByA: 0,
  setsWonByB: 0,
  sideOutRaw: true,
};

const cases = [
  {
    name: "1. Heartbeat (same pointsCount, new updatedAt)",
    prev:    { ...BASE, pointsCount: 42, serverNumberRaw: null },
    current: { ...BASE, pointsCount: 42, serverNumberRaw: null },
    expected: "none",
  },
  {
    name: "2. Singles SIDE OUT (pointsCount+1, score unchanged, sideOutRaw, null→null)",
    prev:    { ...BASE, pointsCount: 42, serverNumberRaw: null },
    current: { ...BASE, pointsCount: 43, serverNumberRaw: null },
    expected: "flash",
  },
  {
    name: "3. Doubles server handoff (pointsCount+1, score unchanged, sideOutRaw, 1→2)",
    prev:    { ...BASE, pointsCount: 42, serverNumberRaw: 1 },
    current: { ...BASE, pointsCount: 43, serverNumberRaw: 2 },
    expected: "handoff",
  },
  {
    name: "4. Doubles SIDE OUT (pointsCount+1, score unchanged, sideOutRaw, 2→1)",
    prev:    { ...BASE, pointsCount: 42, serverNumberRaw: 2 },
    current: { ...BASE, pointsCount: 43, serverNumberRaw: 1 },
    expected: "flash",
  },
  {
    name: "5. Scored rally (pointsCount+1, score changed → no side-out)",
    prev:    { ...BASE, pointsCount: 42, serverNumberRaw: null },
    current: { ...BASE, pointsCount: 43, serverNumberRaw: null, tiebreakPointsA: 6 },
    expected: "none",
  },
];

/* ── Runner ──────────────────────────────────────────────────────────── */
let passed = 0;
let failed = 0;

for (const c of cases) {
  const got = decideSideOutAction(c.prev, c.current);
  const ok  = got === c.expected;
  if (ok) {
    console.log(`PASS  ${c.name}`);
    passed++;
  } else {
    console.error(`FAIL  ${c.name}`);
    console.error(`      expected: "${c.expected}"  got: "${got}"`);
    failed++;
  }
}

console.log(`\nResults: ${passed}/${cases.length} PASS${failed > 0 ? `, ${failed} FAIL` : ""}`);
process.exit(failed > 0 ? 1 : 0);

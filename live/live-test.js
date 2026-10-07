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
 * Cases 6+ cover the deciding tie-break helpers (finalSetLabel, setWonBy,
 * isDecidingTiebreak) against a fixture with the new optional fields and a
 * legacy fixture without them.
 *
 * These are verbatim copies of the pure functions from live.js — keep in sync.
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

/* ── Copy of the deciding tie-break helpers from live.js (keep in sync) ── */
function isRallySport(s) { return s.sportRaw === "badminton" || s.sportRaw === "pickleball"; }
function isDecidingTiebreak(s) {
  return Number.isFinite(s.decidingTiebreakPoints) && s.decidingTiebreakPoints > 0;
}
function isUnfinishedSet(set) { return set.wasUnfinished === true; }
function setWonBy(set, isA) {
  if (isUnfinishedSet(set)) return false;
  return isA ? set.gamesA > set.gamesB : set.gamesB > set.gamesA;
}
function finalSetLabel(s, i) {
  if (isDecidingTiebreak(s) && i === s.completedSets.length - 1) return "TB";
  return `${isRallySport(s) ? "GAME" : "SET"} ${i + 1}`;
}
/* ── End copy ─────────────────────────────────────────────────────────── */

/* Fixture: Blue won set 1 6-4, led set 2 3-2 when court time ran out, then
   won the deciding tie-break 7-5 → reads 6-4, 3-2, TB 7-5. */
const DECIDED = {
  sportRaw: null,
  decidingTiebreakPoints: 7,
  winnerRaw: "a",
  setsWonByA: 2, setsWonByB: 0,
  completedSets: [
    { gamesA: 6, gamesB: 4, wasTiebreak: false },
    { gamesA: 3, gamesB: 2, wasTiebreak: false, wasUnfinished: true },
    { gamesA: 7, gamesB: 5, wasTiebreak: true },
  ],
};
/* Legacy payload: no new fields at all. */
const LEGACY = {
  sportRaw: null, winnerRaw: "a", setsWonByA: 2, setsWonByB: 1,
  completedSets: [
    { gamesA: 6, gamesB: 4, wasTiebreak: false },
    { gamesA: 6, gamesB: 7, wasTiebreak: true },
    { gamesA: 7, gamesB: 6, wasTiebreak: true },
  ],
};

const helperCases = [
  ["6. Deciding: last column labelled TB", () => finalSetLabel(DECIDED, 2), "TB"],
  ["7. Deciding: earlier columns keep SET n", () => finalSetLabel(DECIDED, 1), "SET 2"],
  ["8. Legacy: last column stays SET 3", () => finalSetLabel(LEGACY, 2), "SET 3"],
  ["9. Unfinished 3-2 set is won by neither team",
     () => [setWonBy(DECIDED.completedSets[1], true), setWonBy(DECIDED.completedSets[1], false)].join(), "false,false"],
  ["10. Legacy set without wasUnfinished still counts", () => setWonBy(LEGACY.completedSets[0], true), true],
  ["11. null decidingTiebreakPoints is not a deciding tie-break",
     () => isDecidingTiebreak({ decidingTiebreakPoints: null }), false],
  ["12. Absent decidingTiebreakPoints is not a deciding tie-break", () => isDecidingTiebreak(LEGACY), false],
];
for (const [name, fn, expected] of helperCases) {
  cases.push({ name, fn, expected });
}

/* ── Runner ──────────────────────────────────────────────────────────── */
let passed = 0;
let failed = 0;

for (const c of cases) {
  const got = c.fn ? c.fn() : decideSideOutAction(c.prev, c.current);
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

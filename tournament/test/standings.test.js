// node --test tournament/test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../standings.js");

const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, "vectors.json"), "utf8"));

for (const v of vectors.cases) {
  test("vector: " + v.name, () => {
    const results = S.resolveScores(v.definition, v.scores);
    const got = {};
    for (const [id, r] of Object.entries(results)) got[id] = [r.scoreA, r.scoreB];
    assert.deepEqual(got, v.expected.results);
    const rows = S.computeStandings(v.definition, results).map(
      (r) => ({ id: r.id, points: r.points, wins: r.wins, losses: r.losses, diff: r.diff, played: r.played, scheduled: r.scheduled, rank: r.rank }));
    assert.deepEqual(rows, v.expected.standings);
  });
}

test("validScore table (32 points)", () => {
  assert.equal(S.validScore(18, 14, 32, false), true);
  assert.equal(S.validScore(16, 16, 32, false), true);
  assert.equal(S.validScore(18, 15, 32, false), false);
  assert.equal(S.validScore(18, 13, 32, true), true);
  assert.equal(S.validScore(18, 14, 32, true), false);
  assert.equal(S.validScore(-1, 33, 32, false), false);
  assert.equal(S.validScore(1.5, 30.5, 32, false), false);
  assert.equal(S.validScore("18", 14, 32, false), false);
  assert.equal(S.validScore(null, 14, 32, false), false);
  assert.equal(S.validScore(0, 0, 32, true), true);
});

test("parseScoreRecord reads CloudKit shape and rejects junk", () => {
  const rec = { created: { userRecordName: "_u1" }, fields: {
    matchID: { value: "m1" }, scoreA: { value: 18 }, scoreB: { value: 14 }, endedEarly: { value: 0 },
    source: { value: "web" }, submittedAt: { value: 1000 }, note: { value: "Mikko" } } };
  assert.deepEqual(S.parseScoreRecord(rec), { creator: "_u1", matchID: "m1", scoreA: 18, scoreB: 14,
    endedEarly: false, source: "web", submittedAt: 1000, note: "Mikko" });
  assert.equal(S.parseScoreRecord({}), null);
  assert.equal(S.parseScoreRecord({ created: {}, fields: {} }), null);
});

const swiftVectors = JSON.parse(fs.readFileSync(path.join(__dirname, "swift-vectors.json"), "utf8"));
const swiftCases = Array.isArray(swiftVectors) ? swiftVectors : swiftVectors.cases;
test("swift vectors file is non-empty", () => assert.ok(swiftCases.length >= 3));
for (const v of swiftCases) {
  test("swift vector: " + v.name, () => {
    const results = S.resolveScores(v.definition, v.entries);
    const got = {};
    for (const [id, r] of Object.entries(results)) got[id] = { scoreA: r.scoreA, scoreB: r.scoreB, endedEarly: r.endedEarly, source: r.source };
    const want = {};
    for (const [id, r] of Object.entries(v.expectedResults)) want[id] = { scoreA: r.scoreA, scoreB: r.scoreB, endedEarly: r.endedEarly, source: r.source };
    assert.deepEqual(got, want);
    const rows = S.computeStandings(v.definition, results).map((r) => ({ playerID: r.id, rank: r.rank, points: r.points,
      wins: r.wins, losses: r.losses, pointDiff: r.diff, played: r.played, scheduled: r.scheduled }));
    assert.deepEqual(rows, v.expectedStandings);
  });
}

test("validTournamentID accepts base64url ids only", () => {
  assert.equal(S.validTournamentID("Abc123_-Abc123_-Abc123"), true);
  assert.equal(S.validTournamentID(""), false);
  assert.equal(S.validTournamentID("a".repeat(65)), false);
  assert.equal(S.validTournamentID("../x"), false);
  assert.equal(S.validTournamentID("a b a b a b a b a b a b"), false);
  assert.equal(S.validTournamentID("<script>alert(1)</script>"), false);
  assert.equal(S.validTournamentID("short"), false);
  assert.equal(S.validTournamentID(null), false);
});

test("tournamentKey is base64url(SHA-256(utf8(id)))", async () => {
  assert.equal(await S.tournamentKey("abc"), "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  assert.match(await S.tournamentKey("Abc123_-Abc123_-Abc123"), /^[A-Za-z0-9_-]{43}$/);
});

test("validPin: 4 or 6 ASCII digits only (same rule as the worker)", () => {
  for (const p of ["0000", "1234", "000000", "123456"]) assert.equal(S.validPin(p), true, p);
  for (const p of ["", "123", "12345", "1234567", "12a4", " 1234", "1234 ", "١٢٣٤", 1234, null]) assert.equal(S.validPin(p), false, String(p));
});

/* ---- standings rules (mirror of TournamentStandingsTests in the app's package) ---- */
function def8() {
  return { pointsPerMatch: 32, players: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ id: "p" + i, name: "P" + i })),
    rounds: [
      { index: 1, matches: [{ id: "r1c1", courtID: "c1", teamA: ["p1", "p2"], teamB: ["p3", "p4"] },
                            { id: "r1c2", courtID: "c2", teamA: ["p5", "p6"], teamB: ["p7", "p8"] }], sittingOut: [] },
      { index: 2, matches: [{ id: "r2c1", courtID: "c1", teamA: ["p1", "p3"], teamB: ["p5", "p7"] }], sittingOut: ["p2", "p4", "p6", "p8"] }] };
}
const res = (o) => Object.fromEntries(Object.entries(o).map(([k, [a, b]]) => [k, { scoreA: a, scoreB: b }]));
const row = (rows, id) => rows.find((r) => r.id === id);

test("a 16-16 draw is neither a win nor a loss (W0 L0, P16, +/- 0 for all four)", () => {
  const rows = S.computeStandings(def8(), res({ r1c1: [16, 16] }));
  for (const id of ["p1", "p2", "p3", "p4"]) {
    const r = row(rows, id);
    assert.deepEqual([r.wins, r.losses, r.points, r.diff, r.played], [0, 0, 16, 0, 1]);
  }
});

test("ranking: points beat diff", () => {
  const rows = S.computeStandings(def8(), res({ r1c1: [20, 12], r1c2: [20, 0], r2c1: [1, 30] }));
  assert.equal(row(rows, "p1").points, 21); assert.equal(row(rows, "p1").diff, -21);
  assert.ok(row(rows, "p1").rank < row(rows, "p6").rank);
});
test("ranking: equal points, bigger diff first", () => {
  const rows = S.computeStandings(def8(), res({ r1c1: [20, 12], r1c2: [20, 18] }));
  assert.ok(row(rows, "p2").rank < row(rows, "p6").rank);
});
test("ranking: equal points and diff, more wins first", () => {
  const rows = S.computeStandings(def8(), res({ r1c1: [26, 30], r1c2: [20, 10], r2c1: [20, 6] }));
  const p2 = row(rows, "p2"), p5 = row(rows, "p5");
  assert.deepEqual([p2.points, p2.diff, p2.wins, p5.points, p5.diff, p5.wins], [26, -4, 0, 26, -4, 1]);
  assert.ok(p5.rank < p2.rank);
});
test("ranking: full tie shares a rank and keeps player order", () => {
  const rows = S.computeStandings(def8(), res({ r1c1: [18, 14], r1c2: [18, 14] }));
  assert.deepEqual(rows.slice(0, 4).map((r) => r.id), ["p1", "p2", "p5", "p6"]);
  assert.ok(rows.slice(0, 4).every((r) => r.rank === 1) && rows.slice(4).every((r) => r.rank === 5));
});
test("a player who sat out a scored round is unaffected; ended-early counts like any score", () => {
  const rows = S.computeStandings(def8(), res({ r1c1: [18, 14], r2c1: [20, 12] }));
  const p2 = row(rows, "p2");
  assert.deepEqual([p2.played, p2.scheduled, p2.wins, p2.points], [1, 1, 1, 18]);
  const early = S.computeStandings(def8(), res({ r1c1: [10, 6] }));
  assert.deepEqual([row(early, "p1").wins, row(early, "p1").diff, row(early, "p3").losses], [1, 4, 1]);
});

/* ---- round labels: definition `rounds[].index` is 1-BASED (Swift TournamentScheduler) ---- */
test("roundNumber shows the 1-based index as-is (Round 2 is labelled 2, not 3)", () => {
  const d = def8();
  assert.deepEqual(d.rounds.map((r, i) => S.roundNumber(r, i)), [1, 2]);
});
test("roundNumber falls back to position+1 when index is missing or invalid", () => {
  assert.equal(S.roundNumber({}, 3), 4);
  assert.equal(S.roundNumber({ index: 0 }, 2), 3);
  assert.equal(S.roundNumber({ index: "2" }, 0), 1);
});
test("roundOrder puts the current round first, the rest in schedule order", () => {
  assert.deepEqual(S.roundOrder(7, 1), [1, 0, 2, 3, 4, 5, 6]);
  assert.deepEqual(S.roundOrder(7, 0), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(S.roundOrder(3, -1), [0, 1, 2]);   // all done
});

/* Part 1: names by round, host by round, orientation. Mirrors Swift TournamentDefinition (PadelScoringTests). */
const swapped = {
  players: [
    { id: "p1", name: "Ann" },
    { id: "p2", name: "Cid", formerNames: [{ name: "Ann2", untilRound: 2 }, { name: "Bea", untilRound: 4 }] },
  ],
  hostPlayerID: "p1", hostUntilRound: 3,
};
test("playerName: earliest former name whose untilRound >= round, else current, unknown id -> id", () => {
  assert.equal(S.playerName(swapped, "p2", 1), "Ann2");
  assert.equal(S.playerName(swapped, "p2", 2), "Ann2");
  assert.equal(S.playerName(swapped, "p2", 3), "Bea");
  assert.equal(S.playerName(swapped, "p2", 4), "Bea");
  assert.equal(S.playerName(swapped, "p2", 5), "Cid");
  assert.equal(S.playerName(swapped, "p1", 9), "Ann");   // no former names
  assert.equal(S.playerName(swapped, "zz", 1), "zz");
});
test("hostID: hostPlayerID until hostUntilRound inclusive, then null; no until = always; no host = null", () => {
  assert.equal(S.hostID(swapped, 3), "p1");
  assert.equal(S.hostID(swapped, 4), null);
  assert.equal(S.hostID({ hostPlayerID: "p1" }, 99), "p1");
  assert.equal(S.hostID({ players: [] }, 1), null);
});
test("isFlipped + orient: host on team B flips the display; the swap is its own inverse", () => {
  const m = { teamA: ["p3", "p4"], teamB: ["p1", "p2"] };
  assert.equal(S.isFlipped(swapped, 3, m), true);
  assert.equal(S.isFlipped(swapped, 4, m), false);                          // host swapped out
  assert.equal(S.isFlipped({ players: [] }, 1, m), false);                  // no host
  assert.equal(S.isFlipped(swapped, 1, { teamA: ["p1", "p2"], teamB: ["p3", "p4"] }), false);
  const shown = S.orient(true, 21, 11);                                     // schedule A=21,B=11 shown flipped
  assert.deepEqual(shown, [11, 21]);
  assert.deepEqual(S.orient(true, ...shown), [21, 11]);                     // submitted back in schedule orientation
  assert.deepEqual(S.orient(false, 21, 11), [21, 11]);
});

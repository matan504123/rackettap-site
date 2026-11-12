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
      (r) => ({ id: r.id, points: r.points, wins: r.wins, diff: r.diff, played: r.played, scheduled: r.scheduled, rank: r.rank }));
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
      wins: r.wins, pointDiff: r.diff, played: r.played, scheduled: r.scheduled }));
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

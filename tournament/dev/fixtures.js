/* Fixture Tournament + TournamentScore records for the dev harness (shapes mirror CloudKit JS responses). */
(function () {
  const ORG = "_organizer-fixture";
  const mkPlayers = (names) => names.map((n, i) => ({ id: "p" + (i + 1), name: n }));
  /* 8 players / 2 courts, simple rotation (fixture only — not the real generator). */
  function mkDef(id, name, names, nRounds, extra) {
    const players = mkPlayers(names), n = players.length;
    const rounds = [];
    for (let r = 0; r < nRounds; r++) {
      const rot = players.map((_, i) => players[(i + r) % n].id);
      const courts = Math.min(2, Math.floor(n / 4));
      const matches = [];
      for (let c = 0; c < courts; c++) {
        const q = rot.slice(c * 4, c * 4 + 4);
        matches.push({ id: `${id}-r${r}c${c}`, courtID: "c" + (c + 1), teamA: [q[0], q[3]], teamB: [q[1], q[2]] });
      }
      rounds.push({ index: r + 1, matches, sittingOut: rot.slice(courts * 4) });
    }
    return Object.assign({ schemaVersion: 1, id, name, createdAt: "2026-11-11T10:00:00Z", pointsPerMatch: 32, seed: 7,
      players, courts: [{ id: "c1", name: "Court 1" }, { id: "c2", name: "Court 2" }], rounds, trustedWriters: [ORG, "_worker-fixture"] }, extra || {});
  }
  const tRec = (def, status) => ({ recordName: def.id, recordType: "Tournament", fields: {
    definition: { value: JSON.stringify(def) }, status: { value: status }, updatedAt: { value: Date.now() },
    expiresAt: { value: Date.now() + 864e5 }, schemaVersion: { value: 1 } } });
  let n = 0;
  const sRec = (def, matchID, a, b, o) => { o = o || {}; return { recordName: "s" + (++n), recordType: "TournamentScore",
    created: { userRecordName: o.creator || ORG }, fields: { tournamentKey: { value: def.id }, matchID: { value: matchID },
      scoreA: { value: a }, scoreB: { value: b }, endedEarly: { value: o.early ? 1 : 0 }, source: { value: o.source || "app" },
      submittedAt: { value: 1000 + n }, note: { value: o.note || "" } } }; };
  const eight = ["Anna", "Mikko", "Sofia", "Jussi", "Liisa", "Pekka", "Emma", "Olli"];
  const cycle = [[18, 14], [20, 12], [16, 16], [22, 10], [14, 18], [19, 13]];
  const scoreRounds = (def, upto, sourceFn) => {
    const out = []; let k = 0;
    def.rounds.slice(0, upto).forEach((r) => r.matches.forEach((m) => {
      const [a, b] = cycle[k++ % cycle.length]; out.push(sRec(def, m.id, a, b, sourceFn(k))); }));
    return out;
  };

  const F = {};
  const empty = mkDef("empty", "Friday Americano", eight, 7);
  F.empty = { rec: tRec(empty, "running"), scores: [] };

  const mid = mkDef("mid", "Sunday Social Americano", eight, 7);
  const midScores = scoreRounds(mid, 3, (k) => (k % 3 === 0 ? { source: "web", creator: "_worker-fixture", note: "Mikko" } : {}));
  midScores.push(sRec(mid, mid.rounds[3].matches[0].id, 18, 9, { source: "web", creator: "_worker-fixture", early: true }));
  midScores.push(sRec(mid, mid.rounds[4].matches[0].id, 32, 0, { creator: "_stranger" }));   // untrusted: must be ignored
  F.mid = { rec: tRec(mid, "running"), scores: midScores };

  /* Part 1: host p3 (Sofia) plays team B in some rounds (shown blue/first); p2 swapped Mikko -> Bea from round 3;
     the host is swapped out after round 5 (hostUntilRound), so rounds 6-7 have no host. */
  const swapDef = mkDef("swap", "Swap & Host Americano", eight, 7, { hostPlayerID: "p3", hostUntilRound: 5 });
  swapDef.players[1].name = "Bea"; swapDef.players[1].formerNames = [{ name: "Mikko", untilRound: 2 }];
  F.swap = { rec: tRec(swapDef, "running"), scores: scoreRounds(swapDef, 3, () => ({})) };
  const setupDef = mkDef("setup", "Not Started Americano", eight, 7, { hostPlayerID: "p1" });
  F.setup = { rec: tRec(setupDef, "setup"), scores: [] };

  const fin = mkDef("finished", "Club Championship Americano", eight, 7);
  F.finished = { rec: tRec(fin, "finished"), scores: scoreRounds(fin, 7, () => ({})) };

  const hostile = mkDef("hostile", "<img src=x onerror=alert(1)> " + "Very long tournament name ".repeat(8),
    ["<script>alert('x')</script>", "A".repeat(200), "Zoë 🎾🔥", "שלום עולם נבו", "Mary-Jane O'Neil & \"Sons\"", "&amp;&lt;b&gt;", "אורי", "Ünï Çødé"], 5,
    { courts: [{ id: "c1", name: "<b>Court</b> " + "X".repeat(60) }, { id: "c2", name: "מגרש 2" }] });
  F.hostile = { rec: tRec(hostile, "running"), scores: scoreRounds(hostile, 2, () => ({})) };

  // Page ids must be base64url, 16-64 chars: expose each fixture under "fx_<name>_0000000000".
  const L = {};
  Object.keys(F).forEach((k) => { L["fx_" + k + "_0000000000"] = F[k]; });
  window.TOURNAMENT_FIXTURES = L;
})();

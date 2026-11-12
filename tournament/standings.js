/* RacketTap Americano tournament — pure score resolution + standings.
 * Mirrors Packages/PadelScoring/Tournament (Swift); shared vectors in test/vectors.json.
 * No DOM, no network: loads in the page (window.TournamentStandings) and in node. */
(function (root) {
  "use strict";

  /* Non-negative integers; sum == pointsPerMatch, or (endedEarly) sum < pointsPerMatch. */
  function validScore(a, b, pointsPerMatch, endedEarly) {
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(pointsPerMatch)) return false;
    if (a < 0 || b < 0) return false;
    return endedEarly ? a + b < pointsPerMatch : a + b === pointsPerMatch;
  }

  /* CloudKit TournamentScore record -> plain object (null if it lacks the basics).
     `creator` is created.userRecordName, which the page needs for the trust rule. */
  function parseScoreRecord(rec) {
    if (!rec || !rec.fields || !rec.created || !rec.created.userRecordName) return null;
    const f = rec.fields;
    const val = (k) => (f[k] ? f[k].value : undefined);
    if (typeof val("matchID") !== "string") return null;
    return {
      creator: rec.created.userRecordName,
      matchID: val("matchID"),
      scoreA: val("scoreA"),
      scoreB: val("scoreB"),
      endedEarly: Number(val("endedEarly")) === 1,
      source: val("source"),
      submittedAt: Number(val("submittedAt")) || 0,
      note: typeof val("note") === "string" ? val("note") : "",
    };
  }

  /* submittedAt as ms: numbers pass through, ISO-8601 strings are parsed, junk -> NaN (treated as 0). */
  function toTime(t) { const n = typeof t === "number" ? t : Date.parse(t); return Number.isFinite(n) ? n : 0; }

  /* Trust + resolution. Drops scores from creators not in definition.trustedWriters,
     for unknown matchIDs, or invalid. Per match: latest "app" score wins; else latest "web".
     Returns { [matchID]: {scoreA, scoreB, endedEarly, source, submittedAt, note} }. */
  function resolveScores(def, scores) {
    const trusted = new Set(def.trustedWriters || []);
    const known = new Set();
    for (const r of def.rounds || []) for (const m of r.matches || []) known.add(m.id);
    const best = { app: {}, web: {} };
    for (const s of scores || []) {
      if (!s || !trusted.has(s.creator) || !known.has(s.matchID)) continue;
      if (s.source !== "app" && s.source !== "web") continue;
      if (!validScore(s.scoreA, s.scoreB, def.pointsPerMatch, !!s.endedEarly)) continue;
      const cur = best[s.source][s.matchID];
      const t = toTime(s.submittedAt);
      if (!cur || t >= cur.t) best[s.source][s.matchID] = { s, t };   // equal time: later array position wins
    }
    const out = {};
    for (const id of known) {
      const pick = best.app[id] || best.web[id];
      const s = pick && pick.s;
      if (s) out[id] = { scoreA: s.scoreA, scoreB: s.scoreB, endedEarly: !!s.endedEarly,
                         source: s.source, submittedAt: pick.t, note: s.note || "" };
    }
    return out;
  }

  /* Standings rows in rank order: {id, name, points, wins, losses, diff, played, scheduled, rank}.
     A draw is neither a win nor a loss. Order: points desc, diff desc, wins desc, then player order;
     rows equal on all three share a rank (1,2,2,4). */
  function computeStandings(def, results) {
    const rows = new Map();
    (def.players || []).forEach((p, i) => rows.set(p.id,
      { id: p.id, name: p.name, points: 0, wins: 0, losses: 0, diff: 0, played: 0, scheduled: 0, rank: 0, _i: i }));
    for (const r of def.rounds || []) for (const m of r.matches || []) {
      const res = results[m.id];
      const sides = [[m.teamA, res && res.scoreA, res && res.scoreB], [m.teamB, res && res.scoreB, res && res.scoreA]];
      for (const [team, mine, theirs] of sides) for (const pid of team) {
        const row = rows.get(pid);
        if (!row) continue;
        row.scheduled += 1;
        if (!res) continue;
        row.played += 1;
        row.points += mine;
        row.diff += mine - theirs;
        if (mine > theirs) row.wins += 1; else if (mine < theirs) row.losses += 1;
      }
    }
    const list = [...rows.values()].sort((a, b) =>
      b.points - a.points || b.diff - a.diff || b.wins - a.wins || a._i - b._i);
    list.forEach((row, i) => {
      const prev = list[i - 1];
      const tied = prev && prev.points === row.points && prev.wins === row.wins && prev.diff === row.diff;
      row.rank = tied ? prev.rank : i + 1;
    });
    return list.map(({ _i, ...rest }) => rest);
  }

  /* Tournament ids are base64url (22 chars today). Anything else never reaches fetch, query, storage or the Worker. */
  function validTournamentID(id) { return typeof id === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(id); }

  /* Tournament PIN: 6 digits (v2+) or 4 (tournaments made before v2). Same rule as the worker (validate.js). */
  function validPin(pin) {
    return typeof pin === "string" && /^(?:[0-9]{4}|[0-9]{6})$/.test(pin);
  }
  /* TournamentScore.tournamentKey = base64url-nopad(SHA-256(utf8(tournamentID))). Keeps raw ids out of the
     enumerable queryable field. Async (WebCrypto). */
  async function tournamentKey(id) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
    let bin = ""; new Uint8Array(digest).forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  const api = { tournamentKey, validTournamentID, validScore, validPin, parseScoreRecord, resolveScores, computeStandings };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TournamentStandings = api;
})(typeof window !== "undefined" ? window : globalThis);

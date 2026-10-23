/* Fixture LiveSession records for the dev harness. Snapshot shape mirrors the
 * iOS LiveScorePublic projection (Packages/PadelPersistence/.../LiveScorePublic.swift). */
(function () {
  const base = () => ({
    schemaVersion: 1, matchStartDate: Date.now() - 3600e3,
    isMixing: false, isAmericano: false, isTraining: false, americanoPointCap: 0,
    currentGamePointsARaw: 0, currentGamePointsBRaw: 0,
    isInTiebreak: false, tiebreakPointsA: 0, tiebreakPointsB: 0, isStarPointActive: false,
    currentSetGamesA: 0, currentSetGamesB: 0, setsWonByA: 0, setsWonByB: 0,
    completedRoundsCount: 0, americanoRoundsWonA: 0, americanoRoundsWonB: 0,
    americanoTotalPointsA: 0, americanoTotalPointsB: 0, winnerRaw: null,
    teamAName: null, teamBName: null, completedSets: [],
  });
  const rec = (snap, o) => () => {
    o = o || {};
    const f = {
      snapshot: { value: JSON.stringify(snap) },
      status: { value: o.status || "live" },
      updatedAt: { value: Date.now() - (o.ageMs || 1000) },
      expiresAt: { value: Date.now() + 36e5 },
    };
    if (snap.pointsCount != null) f.pointsCount = { value: snap.pointsCount };
    return { recordName: "x", fields: f };
  };
  const F = {};
  F["padel-mid"] = rec(Object.assign(base(), {
    teamAName: "Matan", teamBName: "Opponents", setsWonByA: 1, setsWonByB: 0,
    currentSetGamesA: 4, currentSetGamesB: 3, currentGamePointsARaw: 3, currentGamePointsBRaw: 2 }));
  F["padel-final-tb"] = rec(Object.assign(base(), {
    teamAName: "Matan & Jussi", teamBName: "Opponents", winnerRaw: "a", setsWonByA: 2, setsWonByB: 1,
    completedSets: [{ gamesA: 6, gamesB: 7, wasTiebreak: true }, { gamesA: 6, gamesB: 4 }, { gamesA: 7, gamesB: 6, wasTiebreak: true }] }),
    { status: "ended" });
  F["tennis-final-5"] = rec(Object.assign(base(), {
    teamAName: "Mikko", teamBName: "Torsten", winnerRaw: "b", setsWonByA: 2, setsWonByB: 3,
    completedSets: [{ gamesA: 6, gamesB: 7, wasTiebreak: true }, { gamesA: 6, gamesB: 4 }, { gamesA: 3, gamesB: 6 }, { gamesA: 7, gamesB: 6, wasTiebreak: true }, { gamesA: 4, gamesB: 6 }] }),
    { status: "ended" });
  F["starpoint"] = rec(Object.assign(base(), {
    teamAName: "Matan", teamBName: "Opponents", isStarPointActive: true, setsWonByA: 0, setsWonByB: 1,
    currentSetGamesA: 5, currentSetGamesB: 5, currentGamePointsARaw: 3, currentGamePointsBRaw: 3 }));
  F["deciding-tb"] = rec(Object.assign(base(), {
    teamAName: "Matan", teamBName: "Opponents", setsWonByA: 1, setsWonByB: 1, isInTiebreak: true,
    tiebreakPointsA: 6, tiebreakPointsB: 8, decidingTiebreakPoints: 10, currentSetGamesA: 3, currentSetGamesB: 2,
    completedSets: [{ gamesA: 6, gamesB: 4 }, { gamesA: 4, gamesB: 6 }, { gamesA: 3, gamesB: 2, wasUnfinished: true }] }));
  F["deciding-final"] = rec(Object.assign(base(), {
    teamAName: "Matan", teamBName: "Opponents", winnerRaw: "a", setsWonByA: 1, setsWonByB: 1, decidingTiebreakPoints: 10,
    completedSets: [{ gamesA: 6, gamesB: 4 }, { gamesA: 4, gamesB: 6 }, { gamesA: 3, gamesB: 2, wasUnfinished: true }, { gamesA: 10, gamesB: 8, wasTiebreak: true }] }),
    { status: "ended" });
  F["badminton"] = rec(Object.assign(base(), {
    sportRaw: "badminton", isInTiebreak: true, teamAName: "Wen", teamBName: "Dalgaard",
    setsWonByA: 1, setsWonByB: 0, tiebreakPointsA: 17, tiebreakPointsB: 19 }));
  F["pickleball-s2"] = rec(Object.assign(base(), {
    sportRaw: "pickleball", isInTiebreak: true, sideOutRaw: true, serverNumberRaw: 2, pointsCount: 40,
    teamAName: "Matan & Sari", teamBName: "Pete & Anna", setsWonByA: 0, setsWonByB: 1,
    tiebreakPointsA: 7, tiebreakPointsB: 9 }));
  F["serve-named"] = rec(Object.assign(base(), {
    teamAName: "Matan & Sari", teamBName: "Pete & Anna", serverRaw: "b", serverPlayerRaw: 2, serverName: "Anna",
    currentSetGamesA: 2, currentSetGamesB: 3 }));
  F["serve-unnamed"] = rec(Object.assign(base(), {
    serverRaw: "a", serverPlayerRaw: 1, currentSetGamesA: 2, currentSetGamesB: 3 }));
  F["americano"] = rec(Object.assign(base(), {
    isAmericano: true, isMixing: true, americanoTotalPointsA: 47, americanoTotalPointsB: 52,
    currentSetGamesA: 12, currentSetGamesB: 9, americanoPointCap: 24 }));
  F["unnamed"] = rec(Object.assign(base(), {
    setsWonByA: 0, setsWonByB: 0, currentSetGamesA: 2, currentSetGamesB: 1,
    currentGamePointsARaw: 4, currentGamePointsBRaw: 3, isTraining: true }));
  const LA = "Aleksanteri Virtanen-Korhonen / Maximilian Österberg";
  const LB = "Bartholomew Featherstonehaugh-Smythe / Konstantinos Papadopoulos";
  F["longnames"] = rec(Object.assign(base(), {
    teamAName: LA, teamBName: LB, setsWonByA: 1, setsWonByB: 1,
    currentSetGamesA: 6, currentSetGamesB: 6, isInTiebreak: true, tiebreakPointsA: 11, tiebreakPointsB: 10 }));
  F["longnames-final"] = rec(Object.assign(base(), {
    teamAName: LA, teamBName: LB, winnerRaw: "b", setsWonByA: 1, setsWonByB: 2,
    completedSets: [{ gamesA: 6, gamesB: 3 }, { gamesA: 2, gamesB: 6 }, { gamesA: 6, gamesB: 7, wasTiebreak: true }] }),
    { status: "ended" });
  F["paused"] = rec(Object.assign(base(), {
    teamAName: "Matan", teamBName: "Opponents", currentSetGamesA: 1, currentSetGamesB: 0 }),
    { ageMs: 600e3 });
  // "ended" = expired/missing record -> Broadcast ended message.
  F["pickleball-sideout"] = F["pickleball-s2"];  // harness flashes SIDE OUT (see frame.html)
  window.LIVE_FIXTURES = F;
})();

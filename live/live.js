/* RacketTap — online live score viewer.
 *
 * Reads a public CloudKit `LiveSession` record (written by the host's phone)
 * and renders the live score. No app, no account, no cookies — read-only.
 *
 * The share-id is taken from the URL FRAGMENT (…/live/#<id>) so it never
 * reaches the GitHub Pages server logs or any Referer header.
 *
 * ── BEFORE THIS WORKS YOU MUST: ───────────────────────────────────────────
 *   1. Paste your CloudKit Web Services API token into API_TOKEN below.
 *   2. In CloudKit Console: LiveSession public record type → _world role =
 *      READ only, non-queryable; create the API token; deploy schema Dev→Prod.
 * The page degrades gracefully (shows a friendly message) until then.
 * ──────────────────────────────────────────────────────────────────────────
 */

const CONTAINER  = "iCloud.com.matankeret.PadelTap";
const API_TOKEN  = "a9a5ac5e45445e46e40673a6a02ec6952605957aff96b14b3c4167148477d36a"; // PRODUCTION public read-only token, origin-locked to matan504123.github.io
const ENVIRONMENT = "production";                          // "development" to test against a debug build
const RECORD_TYPE = "LiveSession";

const BASE_POLL_MS = 2500;     // ~2.5s; widens on throttling
const MAX_POLL_MS  = 30000;

const $ = (id) => document.getElementById(id);
const POINT_WORDS = ["0", "15", "30", "40", "AD"];

// The host who shares the link is, by the app's convention, Team A ("YOU"),
// so we badge that team so home viewers know which side the broadcaster is on.
const BROADCASTER_TEAM = "a";

let pollTimer = null;
let currentDelay = BASE_POLL_MS;

// Side-out detection: persisted across polls to compare consecutive snapshots.
let prevSnapshot  = null;   // LiveScorePublic from the previous successful render
let prevUpdatedAt = null;   // Date of that render's record.fields.updatedAt
let sideOutTimer  = null;   // setTimeout handle for hiding the flash

function shareIDFromURL() {
  // Prefer the fragment (#id); tolerate ?s=id as a fallback.
  const frag = (location.hash || "").replace(/^#/, "").trim();
  if (frag) return frag;
  const q = new URLSearchParams(location.search).get("s");
  return (q || "").trim();
}

function setState(name) { document.body.dataset.state = name; }

function showMessage(title, detail) {
  setState("message");
  $("msg-title").textContent = title;
  $("msg-detail").textContent = detail || "";
}

/* Terminal state: the broadcast is over and there's nothing live to show
   (match finished + result window expired, or the host stopped sharing /
   the record was pruned). Stops polling. */
function showEnded() {
  showMessage("Broadcast ended", "This match has finished — the live view is no longer available.");
}

function pointDisplay(raw) {
  return POINT_WORDS[raw] != null ? POINT_WORDS[raw] : String(raw);
}

function timeAgo(date) {
  const secs = Math.max(0, Math.round((Date.now() - date) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return secs + "s ago";
  const mins = Math.round(secs / 60);
  return mins + " min ago";
}

/* Show the SIDE OUT flash for ~2 s, then hide it. Re-arming while visible
   is safe: the timeout is reset rather than stacked. */
function flashSideOut() {
  const el = $("sideout");
  el.hidden = false;
  if (sideOutTimer) clearTimeout(sideOutTimer);
  sideOutTimer = setTimeout(() => { el.hidden = true; }, 2000);
}

/* True when the match is over AND we have a per-set breakdown to summarise.
   (Americano has no sets, so it keeps its live PTS/TOT layout even when
   ended.) Drives both the column header and each team row. */
function hasFinalSetSummary(s, ended) {
  return ended && !s.isAmericano
      && Array.isArray(s.completedSets) && s.completedSets.length > 0;
}

/* True when the snapshot came from a badminton match. `sportRaw` is optional
   (nil/absent for legacy padel senders); absent means padel. */
function isBadminton(s)  { return s.sportRaw === "badminton"; }

/* True for any rally-point sport (badminton or pickleball).
   Used wherever both sports share the same column layout / badge suppressions. */
function isRallySport(s) { return s.sportRaw === "badminton" || s.sportRaw === "pickleball"; }

/* True when the snapshot came from a pickleball match. */
function isPickleball(s) { return s.sportRaw === "pickleball"; }

/* Render one team's row. `s` is the decoded LiveScorePublic. */
function renderTeam(side, s, ended, isBroadcaster) {
  const isA = side === "a";
  const name = (isA ? s.teamAName : s.teamBName) || (isA ? "Team A" : "Team B");
  const won = ended && s.winnerRaw === side;
  const tag = isBroadcaster ? `<span class="bcast">📡 Broadcaster</span>` : "";

  let cols;
  if (hasFinalSetSummary(s, ended)) {
    // FINAL: one cell per completed set showing this team's games (with a
    // tiebreak marker). The set the team won is highlighted. No stale
    // current-game point ("40"/"AD") — the match is over.
    cols = s.completedSets.map((set) => {
      const g = isA ? set.gamesA : set.gamesB;
      const setWon = isA ? set.gamesA > set.gamesB : set.gamesB > set.gamesA;
      const tb = set.wasTiebreak ? `<sup class="tb">TB</sup>` : "";
      return `<span class="setcell ${setWon ? "win" : ""}">${g}${tb}</span>`;
    }).join("");
  } else if (isRallySport(s)) {
    // RALLY-POINT LIVE (badminton / pickleball): games won + current-game points.
    // isInTiebreak is always true for these sports.
    // setsWonByA/B = games won; tiebreakPointsA/B = current-game rally points.
    // No "current-set games" column — rally points IS the game score.
    const gamesWon = isA ? s.setsWonByA : s.setsWonByB;
    const rallyPts = isA ? s.tiebreakPointsA : s.tiebreakPointsB;
    cols = `<span class="sets">${gamesWon}</span>`
         + `<span class="points">${rallyPts}</span>`;
  } else {
    // LIVE / PAUSED (or an ended match with no set data): sets · games · pts.
    const sets = isA ? s.setsWonByA : s.setsWonByB;
    const games = isA ? s.currentSetGamesA : s.currentSetGamesB;
    let points;
    if (s.isAmericano) {
      points = isA ? s.americanoTotalPointsA : s.americanoTotalPointsB;
    } else if (s.isInTiebreak) {
      points = isA ? s.tiebreakPointsA : s.tiebreakPointsB;
    } else {
      points = pointDisplay(isA ? s.currentGamePointsARaw : s.currentGamePointsBRaw);
    }
    cols = `${s.isAmericano ? "" : `<span class="sets">${sets}</span>`}`
         + `<span class="games">${games}</span>`
         + `<span class="points">${points}</span>`;
  }

  return `
    <div class="team ${isA ? "team-a" : "team-b"} ${won ? "winner" : ""}">
      <span class="team-id">
        <span class="team-name">${escapeText(name)}</span>
        ${tag}
      </span>
      <span class="team-cols">${cols}</span>
    </div>`;
}

/* Build badge labels for the match mode. */
function badges(s) {
  // Items are {text, cls?}; cls is an optional extra CSS class on .badge.
  const out = [];
  if (s.isMixing)   out.push({ text: "MIX" });
  if (s.isAmericano) out.push({ text: "AMERICANO" });
  if (s.isTraining)  out.push({ text: "TRAINING" });
  // Rally-point sports are always "in tiebreak"; suppress the misleading badge.
  if (s.isInTiebreak && !isRallySport(s)) out.push({ text: "TIEBREAK" });
  // Sport name badge with sport-specific accent colour (sport CSS variable).
  if (isBadminton(s))  out.push({ text: "BADMINTON",  cls: "sport" });
  if (isPickleball(s)) out.push({ text: "PICKLEBALL", cls: "sport" });
  return out;
}

function render(record) {
  let s;
  try {
    s = JSON.parse(record.fields.snapshot.value);
  } catch (e) {
    showMessage("Can't read this match", "The score data was malformed.");
    return;
  }
  const status = record.fields.status ? record.fields.status.value : "live";
  const updatedAt = record.fields.updatedAt ? new Date(record.fields.updatedAt.value) : new Date();
  const expiresAtRaw = record.fields.expiresAt ? record.fields.expiresAt.value : null;
  const expired = expiresAtRaw != null && Date.now() > Number(expiresAtRaw);
  const ended = status === "ended" || s.winnerRaw != null;

  // A finished match stays viewable for a few hours, then its result window
  // expires — show "no longer available" rather than a stale FINAL.
  if (ended && expired) { showEnded(); return false; }

  // A "live" record that hasn't updated for a few minutes has almost
  // certainly ended without an explicit end signal (e.g. a partial match
  // ended on the watch). Show a soft "paused" state rather than a false LIVE;
  // keep polling so it flips back if play actually resumes.
  const stale = !ended && (Date.now() - updatedAt.getTime() > 180000);

  setState("score");

  // Status pill
  const pill = $("status-pill");
  if (ended) { pill.textContent = "FINAL"; pill.className = "pill final"; }
  else if (stale) { pill.textContent = "PAUSED"; pill.className = "pill stale"; }
  else { pill.textContent = "LIVE"; pill.className = "pill live"; }

  // Sport data attribute drives CSS --sport-accent variable for colour theming.
  $("score").dataset.sport = s.sportRaw || "";

  // Header columns label.
  // FINAL with a set breakdown ⇒ one "SET n" (padel/tennis) or "GAME n"
  // (badminton/pickleball) per completed game/set; Americano ⇒ PTS/TOT;
  // rally-sport live ⇒ GAMES/PTS; otherwise the live SETS/GMS/PTS columns.
  if (hasFinalSetSummary(s, ended)) {
    const unitLabel = isRallySport(s) ? "GAME" : "SET";
    $("col-head").innerHTML = s.completedSets
      .map((_, i) => `<span class="setcell">${unitLabel} ${i + 1}</span>`).join("");
  } else if (isRallySport(s)) {
    $("col-head").innerHTML =
      `<span class="sets">GAMES</span><span class="points">PTS</span>`;
  } else {
    $("col-head").innerHTML = s.isAmericano
      ? `<span class="games">PTS</span><span class="points">TOT</span>`
      : `<span class="sets">SETS</span><span class="games">GMS</span><span class="points">PTS</span>`;
  }

  $("teams").innerHTML = renderTeam("a", s, ended, BROADCASTER_TEAM === "a")
                       + renderTeam("b", s, ended, BROADCASTER_TEAM === "b");

  // Star point banner
  $("starpoint").hidden = !s.isStarPointActive;

  // Badges
  const b = badges(s);
  $("badges").innerHTML = b.map((x) => `<span class="badge ${x.cls || ""}">${x.text}</span>`).join("");
  $("badges").hidden = b.length === 0;

  // Server-number chip (pickleball doubles side-out only; hidden when ended).
  const chip = $("server-chip");
  if (!ended && isPickleball(s) && s.serverNumberRaw != null) {
    chip.textContent = `Server ${s.serverNumberRaw}`;
    chip.hidden = false;
  } else {
    chip.hidden = true;
  }

  // Side-out flash: fires when two consecutive live records share the same
  // score (no point was awarded) but the record was actually updated AND
  // sideOutRaw is true — the serve changed sides without a score change.
  if (!ended && isPickleball(s) && s.sideOutRaw === true && prevSnapshot != null) {
    const sameScore =
      s.tiebreakPointsA === prevSnapshot.tiebreakPointsA &&
      s.tiebreakPointsB === prevSnapshot.tiebreakPointsB &&
      s.setsWonByA     === prevSnapshot.setsWonByA &&
      s.setsWonByB     === prevSnapshot.setsWonByB;
    const recordChanged = prevUpdatedAt != null &&
      updatedAt.getTime() !== prevUpdatedAt.getTime();
    if (sameScore && recordChanged) flashSideOut();
  }
  // Persist snapshot for next poll comparison.
  prevSnapshot  = s;
  prevUpdatedAt = updatedAt;

  // Footer status
  if (ended) $("updated").textContent = "Match finished";
  else if (stale) $("updated").textContent = "Hasn't updated recently — the match may have finished.";
  else $("updated").textContent = "Updated " + timeAgo(updatedAt);
  return !ended; // keep polling only while the match is live
}

function escapeText(str) {
  // We render via innerHTML for layout, so user-supplied strings (team names)
  // MUST be escaped to prevent stored XSS.
  const d = document.createElement("div");
  d.textContent = String(str);
  return d.innerHTML;
}

function scheduleNext(delay) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, delay);
}

function poll() {
  const id = shareIDFromURL();
  if (!id) { showMessage("No match selected", "This link is missing its match code."); return; }

  const db = CloudKit.getDefaultContainer().publicCloudDatabase;
  // Fetch by recordName only — the record type is non-queryable by design,
  // so the unguessable share-id is the sole key.
  db.fetchRecords(id).then((resp) => {
    const rec = (resp && resp.records && resp.records[0]) || null;
    // A deleted / never-existed record comes back as a STUB: HTTP 200 with a
    // per-record NOT_FOUND and NO `.fields`. Detect that and stop — the
    // broadcast is over (Stop sharing / Discard / pruned after expiry).
    // (Previously this stub was rendered, threw on `.fields`, and the catch
    // treated it as transient → endless "Reconnecting…".)
    if (!rec || !rec.fields || rec.serverErrorCode === "NOT_FOUND") {
      showEnded();
      return;
    }
    currentDelay = BASE_POLL_MS;          // success → reset backoff
    const live = render(rec);
    if (live) scheduleNext(currentDelay);  // keep polling only while live
  }).catch((err) => handleFetchError(err));
}

function handleFetchError(err) {
  const code = err && (err.ckErrorCode || err.serverErrorCode || err.code);
  if (code === "NOT_FOUND" || code === "ZONE_NOT_FOUND") {
    showMessage("Match ended", "This match has finished or the link has expired.");
    return;
  }
  // Throttle / transient → exponential backoff, keep trying.
  currentDelay = Math.min(currentDelay * 2, MAX_POLL_MS);
  if (document.body.dataset.state !== "score") {
    showMessage("Reconnecting…", "Waiting for the match to come back.");
  }
  scheduleNext(currentDelay);
}

function start() {
  if (API_TOKEN === "PASTE_YOUR_CLOUDKIT_API_TOKEN_HERE") {
    showMessage("Not configured yet", "This page needs its CloudKit API token before it can show live scores.");
    return;
  }
  if (typeof CloudKit === "undefined") {
    showMessage("Couldn't load", "The CloudKit library failed to load. Check your connection.");
    return;
  }
  CloudKit.configure({
    containers: [{
      containerIdentifier: CONTAINER,
      apiTokenAuth: { apiToken: API_TOKEN, persist: false },
      environment: ENVIRONMENT,
    }],
  });
  showMessage("Loading…", "Fetching the live score.");
  poll();
}

// Re-fetch immediately if the user edits the fragment, and start once
// CloudKit JS has loaded.
window.addEventListener("hashchange", () => { currentDelay = BASE_POLL_MS; poll(); });
if (document.readyState === "complete") start();
else window.addEventListener("load", start);

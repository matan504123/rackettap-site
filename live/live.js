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
const API_TOKEN  = "22674b5f8331cb2542dad1101f5dbed474ab4fdd96aa5680c8daf62e8861b32b"; // public read-only token, origin-locked to matan504123.github.io
const ENVIRONMENT = "production";                          // "development" to test against a debug build
const RECORD_TYPE = "LiveSession";

const BASE_POLL_MS = 2500;     // ~2.5s; widens on throttling
const MAX_POLL_MS  = 30000;

const $ = (id) => document.getElementById(id);
const POINT_WORDS = ["0", "15", "30", "40", "AD"];

let pollTimer = null;
let currentDelay = BASE_POLL_MS;

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

/* Render one team's row. `s` is the decoded LiveScorePublic. */
function renderTeam(side, s, ended) {
  const isA = side === "a";
  const name = (isA ? s.teamAName : s.teamBName) || (isA ? "Team A" : "Team B");
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

  const won = ended && s.winnerRaw === side;
  return `
    <div class="team ${isA ? "team-a" : "team-b"} ${won ? "winner" : ""}">
      <span class="team-name">${escapeText(name)}</span>
      <span class="team-cols">
        ${s.isAmericano ? "" : `<span class="sets">${sets}</span>`}
        <span class="games">${games}</span>
        <span class="points">${points}</span>
      </span>
    </div>`;
}

/* Build badge labels for the match mode. */
function badges(s) {
  const out = [];
  if (s.isMixing) out.push("MIX");
  if (s.isAmericano) out.push("AMERICANO");
  if (s.isTraining) out.push("TRAINING");
  if (s.isInTiebreak) out.push("TIEBREAK");
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
  const ended = status === "ended" || s.winnerRaw != null;

  setState("score");

  // Status pill
  const pill = $("status-pill");
  if (ended) { pill.textContent = "FINAL"; pill.className = "pill final"; }
  else { pill.textContent = "LIVE"; pill.className = "pill live"; }

  // Header columns label (hide sets column for Americano)
  $("col-head").innerHTML = s.isAmericano
    ? `<span class="games">PTS</span><span class="points">TOT</span>`
    : `<span class="sets">SETS</span><span class="games">GMS</span><span class="points">PTS</span>`;

  $("teams").innerHTML = renderTeam("a", s, ended) + renderTeam("b", s, ended);

  // Star point banner
  $("starpoint").hidden = !s.isStarPointActive;

  // Badges
  const b = badges(s);
  $("badges").innerHTML = b.map((x) => `<span class="badge">${x}</span>`).join("");
  $("badges").hidden = b.length === 0;

  // Footer status
  $("updated").textContent = ended ? "Match finished" : ("Updated " + timeAgo(updatedAt));
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
    if (resp.hasErrors && resp.hasErrors()) {
      handleFetchError(resp.errors && resp.errors()[0]);
      return;
    }
    const rec = (resp.records && resp.records[0]) || null;
    if (!rec) {
      showMessage("Match ended", "This match has finished or the link has expired.");
      return; // stop polling — nothing to wait for
    }
    currentDelay = BASE_POLL_MS;          // success → reset backoff
    render(rec);
    const ended = (rec.fields.status && rec.fields.status.value === "ended");
    if (!ended) scheduleNext(currentDelay); // keep polling while live
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

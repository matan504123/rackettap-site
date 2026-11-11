/* RacketTap — Americano tournament page.
 *
 * Reads the public CloudKit `Tournament` record (definition JSON) and its `TournamentScore` records, shows rounds +
 * live standings, and lets someone with the 4-digit PIN enter a court's final score (POST to the Cloudflare Worker).
 * The tournament id is the URL FRAGMENT (…/tournament/#<id>) so it never reaches server logs or Referer headers.
 *
 * Every record value is user text or untrusted data: it is only ever put in the DOM through textContent (h() below),
 * never innerHTML. Score trust + standings maths live in standings.js (pure, shared vectors).
 */

const CONTAINER = "iCloud.com.matankeret.PadelTap";
const CK_CONFIG = {
  production: { environment: "production",
                token: "a9a5ac5e45445e46e40673a6a02ec6952605957aff96b14b3c4167148477d36a" }, // PRODUCTION public read-only token, origin-locked to matan504123.github.io
  // TESTING ONLY: selected with ?env=dev. Paste a Development-environment token here to test against a debug build.
  dev:        { environment: "development", token: "DEV_API_TOKEN_PLACEHOLDER" },
};
const WORKER_URL = "https://tournament-worker.example.workers.dev"; // placeholder until the Worker is deployed

const POLL_MS = 10000;
const FETCH_TIMEOUT_MS = 15000;
const OPTIMISTIC_MS = 60000;
const MAX_SCORE_PAGES = 20;
const Standings = window.TournamentStandings;

const $ = (id) => document.getElementById(id);

/* DOM helper: attrs → properties/attributes, children → text nodes or elements. Text can't inject markup. */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

/* Number from a record → plain number string or a dash. */
function num(v) { return Number.isFinite(+v) && v !== null && v !== "" ? String(+v) : "–"; }
function formatWins(w) { const whole = Math.floor(w); return w % 1 ? (whole ? String(whole) : "") + "½" : String(w); }
function formatDiff(d) { return d > 0 ? "+" + d : d < 0 ? "−" + Math.abs(d) : "0"; }

/* ── state ────────────────────────────────────────────────────────────── */
let pollTimer = null;
let ckDB = null;
let tournamentID = "";
let data = null;            // { def, status, expiresAt, results, scoresOK }
let lastSignature = "";
let lastUpdate = 0;
let activeTab = "rounds";
const toggledRounds = new Map();   // round index -> user-chosen open state
const optimistic = {};             // matchID -> {scoreA, scoreB, endedEarly, until}
let sheetState = null;             // { matchID, pinNeeded, confirmed, busy }

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: PIN just isn't remembered */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
const pinKey = () => "rt-tournament-pin-" + tournamentID;
const NAME_KEY = "rt-tournament-name";

function envConfig() {
  return new URLSearchParams(location.search).get("env") === "dev" ? CK_CONFIG.dev : CK_CONFIG.production;
}
function tournamentIDFromURL() {
  const id = (location.hash || "").replace(/^#/, "").trim();
  return Standings.validTournamentID(id) ? id : "";   // invalid → "No tournament selected"
}
function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error("timeout")), ms); })])
    .finally(() => clearTimeout(t));
}

function setState(name) { document.body.dataset.state = name; }
function showMessage(title, detail) {
  setState("message");
  $("msg-title").textContent = title;
  $("msg-detail").textContent = detail || "";
}

/* ── data ─────────────────────────────────────────────────────────────── */
async function fetchAllScores(db, id) {
  const key = await Standings.tournamentKey(id);   // scores are keyed by the hash, never the raw id
  const out = [];
  let marker;
  for (let page = 0; page < MAX_SCORE_PAGES; page++) {
    const opts = { resultsLimit: 200 };
    if (marker) opts.continuationMarker = marker;
    const resp = await db.performQuery({
      recordType: "TournamentScore",
      filterBy: [{ fieldName: "tournamentKey", comparator: "EQUALS", fieldValue: { value: key } }],
    }, opts);
    if (resp && resp.hasErrors && !(resp.records && resp.records.length)) throw resp.errors && resp.errors[0] || new Error("query failed");
    for (const r of (resp && resp.records) || []) { const s = Standings.parseScoreRecord(r); if (s) out.push(s); }
    if (resp && resp.moreComing && resp.continuationMarker) marker = resp.continuationMarker; else break;
  }
  return out;
}

function parseDefinition(rec) {
  try {
    const def = JSON.parse(rec.fields.definition.value);
    if (!def || !Array.isArray(def.players) || !Array.isArray(def.rounds)) return null;
    def.trustedWriters = Array.isArray(def.trustedWriters) ? def.trustedWriters : [];
    return def;
  } catch (e) { return null; }
}

async function poll() {
  if (document.hidden) { pollTimer = null; return; }   // paused; visibilitychange resumes
  const id = tournamentID;
  if (!id) { showMessage("No tournament selected", "This link is missing its tournament code."); return; }
  try {
    const db = ckDB;
    const resp = await withTimeout(db.fetchRecords(id), FETCH_TIMEOUT_MS);
    const rec = resp && resp.records && resp.records[0];
    if (!rec || !rec.fields || rec.serverErrorCode === "NOT_FOUND" || rec.recordType !== "Tournament") {
      showMessage("Tournament not found", "This link is wrong, or the tournament has expired and been removed.");
      return;
    }
    const def = parseDefinition(rec);
    if (!def) { showMessage("Couldn't read this tournament", "Its data isn't in a format this page understands."); return; }
    const status = rec.fields.status ? rec.fields.status.value : "running";
    const expiresAt = rec.fields.expiresAt ? Number(rec.fields.expiresAt.value) : 0;
    const scores = await withTimeout(fetchAllScores(db, id), FETCH_TIMEOUT_MS * 2);
    if (id !== tournamentID) return;   // fragment changed mid-flight
    const results = Standings.resolveScores(def, scores);
    applyOptimistic(results);
    data = { def, status, expiresAt, results };
    lastUpdate = Date.now();
    render();
    scheduleNext(POLL_MS);
  } catch (err) {
    handleFetchError(err);
  }
}

function applyOptimistic(results) {
  const now = Date.now();
  for (const [mid, o] of Object.entries(optimistic)) {
    const real = results[mid];
    if (now > o.until || (real && real.source === "app")) { delete optimistic[mid]; continue; }
    if (real && real.scoreA === o.scoreA && real.scoreB === o.scoreB) { delete optimistic[mid]; continue; }
    results[mid] = { scoreA: o.scoreA, scoreB: o.scoreB, endedEarly: o.endedEarly, source: "web", submittedAt: now, note: "" };
  }
}

function scheduleNext(delay) { if (pollTimer) clearTimeout(pollTimer); pollTimer = setTimeout(poll, delay); }

function handleFetchError(err) {
  const code = err && (err.ckErrorCode || err.serverErrorCode || err.code);
  if (code === "NOT_FOUND" || code === "ZONE_NOT_FOUND") {
    showMessage("Tournament not found", "This link is wrong, or the tournament has expired and been removed.");
    return;
  }
  if (!data) showMessage("Can't reach the tournament", "Check your connection — this page keeps retrying.");
  else $("updated").textContent = "Offline — showing the last scores. Retrying…";
  scheduleNext(POLL_MS);
}

/* ── rendering ────────────────────────────────────────────────────────── */
function playerMap(def) { const m = new Map(); def.players.forEach((p) => m.set(p.id, p.name || "Player")); return m; }
function courtMap(def) { const m = new Map(); (def.courts || []).forEach((c) => m.set(c.id, c.name)); return m; }

function nameSpan(text) { return h("span", { class: "pn", dir: "auto", title: text }, text); }
function teamNames(names, pm) {
  const ids = names.map((pid) => pm.get(pid) || "Player");
  return h("span", { class: "names" }, nameSpan(ids[0]), ids.length > 1 ? h("span", { class: "amp" }, "&") : null,
           ids.length > 1 ? nameSpan(ids[1]) : null);
}

function isFinished() { return data && data.status === "finished"; }
function isExpired() { return !!(data && data.expiresAt && data.expiresAt < Date.now()); }
function entryClosed() { return isFinished() || isExpired(); }

function roundIsDone(round, results) { return round.matches.every((m) => results[m.id]); }

function render() {
  const { def, results } = data;
  const sig = JSON.stringify([data.status, def.id, def.name, def.rounds, def.players, def.courts, results, activeTab, isExpired()]);
  setState("tournament");
  $("updated").textContent = "Updated just now · refreshes every 10 s";
  if (sig === lastSignature) return;
  lastSignature = sig;

  document.title = (def.name ? def.name + " — " : "") + "RacketTap Tournament";
  $("t-name").textContent = def.name || "Tournament";
  const total = def.rounds.reduce((n, r) => n + r.matches.length, 0);
  const scored = Object.keys(results).length;
  $("t-progress").textContent = `${scored} of ${total} matches scored`;
  $("t-bar").style.width = (total ? Math.round(100 * scored / total) : 0) + "%";

  const banner = $("t-banner");
  const expired = isExpired();
  if (isFinished()) { banner.hidden = false; banner.className = "banner final"; banner.textContent = "Tournament finished — final standings"; }
  else if (expired) { banner.hidden = false; banner.className = "banner warn"; banner.textContent = "This tournament has expired."; }
  else banner.hidden = true;

  renderRounds();
  renderStandings();
  showTab(activeTab);
}

function renderRounds() {
  const { def, results } = data;
  const pm = playerMap(def), cm = courtMap(def);
  const current = def.rounds.findIndex((r) => !roundIsDone(r, results));
  const order = def.rounds.map((_, i) => i);
  if (current > 0) { order.splice(current, 1); order.unshift(current); }   // current round first
  const box = $("view-rounds");
  box.replaceChildren();
  box.append(h("div", { style: "display:flex;flex-direction:column;gap:12px" }, order.map((i) => {
    const round = def.rounds[i];
    const done = roundIsDone(round, results);
    const isCurrent = i === current;
    const open = toggledRounds.has(i) ? toggledRounds.get(i) : isCurrent;
    const sitting = (round.sittingOut || []).map((pid) => pm.get(pid) || "Player");
    const det = h("details", { class: "round" + (isCurrent ? " current" : "") + (done ? " done" : ""), open: open || null },
      h("summary", {}, `Round ${num(round.index + 1)}`, h("span", { class: "tag" }, isCurrent ? "CURRENT" : done ? "DONE" : "UPCOMING")),
      h("div", { class: "matches" }, round.matches.map((m) => matchCard(m, results[m.id], pm, cm))),
      sitting.length ? h("div", { class: "sitting" }, h("span", {}, "Sitting out:"), h("span", { class: "list", dir: "auto" }, sitting.join(", "))) : null);
    det.addEventListener("toggle", () => toggledRounds.set(i, det.open));
    return det;
  })));
}

function matchCard(m, res, pm, cm) {
  const a = res ? res.scoreA : null, b = res ? res.scoreB : null;
  const aWin = res && a > b, bWin = res && b > a;
  const courtName = cm.get(m.courtID) || "Court";
  const side = (cls, team, mine, win) => h("div", { class: "side " + cls }, teamNames(team, pm),
    h("span", { class: "pts" + (res ? (win || a === b ? " win" : " dim") : " dim") }, res ? num(mine) : "–"));
  const lockedByApp = res && res.source === "app";
  let action = null;
  if (!entryClosed()) {
    action = lockedByApp ? h("div", { class: "locked" }, "Scored by the app")
      : h("button", { class: "btn" + (res ? " secondary" : ""), type: "button", onclick: () => openSheet(m.id) },
          res ? "Change score" : "Enter score");
  }
  return h("div", { class: "match", "data-match": m.id },
    h("div", { class: "match-top" }, h("span", { class: "court", dir: "auto" }, courtName),
      res ? h("span", { class: "src" }, (res.endedEarly ? "ENDED EARLY · " : "") + (res.source === "app" ? "APP" : "WEB")) : null),
    side("a", m.teamA, a, aWin), side("b", m.teamB, b, bWin), action);
}

function renderStandings() {
  const { def, results } = data;
  const rows = Standings.computeStandings(def, results);
  const box = $("view-standings");
  box.replaceChildren(h("div", { class: "table" },
    h("div", { class: "tr th" }, h("span", {}, "#"), h("span", {}, "PLAYER"), h("span", {}, "PTS"), h("span", {}, "W"), h("span", {}, "+/−"), h("span", {}, "PLAYED")),
    rows.map((r) => h("div", { class: "tr" + (r.rank === 1 ? " first" : "") },
      h("span", { class: "rank" }, num(r.rank)),
      h("span", { class: "pname" }, nameSpan(r.name || "Player"), isFinished() && r.rank === 1 ? " 🏆" : null),
      h("span", { class: "big" }, num(r.points)),
      h("span", {}, formatWins(r.wins)),
      h("span", { class: "muted" }, formatDiff(r.diff)),
      h("span", { class: "muted" }, `${num(r.played)}/${num(r.scheduled)}`)))));
  // keep name + trophy on one truncated line
  box.querySelectorAll(".pname").forEach((el) => { el.style.display = "flex"; el.style.alignItems = "center"; el.style.gap = "4px"; el.style.minWidth = "0"; });
}

function showTab(name) {
  activeTab = name;
  $("view-rounds").hidden = name !== "rounds";
  $("view-standings").hidden = name !== "standings";
  $("tab-rounds").setAttribute("aria-selected", String(name === "rounds"));
  $("tab-standings").setAttribute("aria-selected", String(name === "standings"));
}

/* ── score entry sheet ────────────────────────────────────────────────── */
function findMatch(mid) {
  for (const r of data.def.rounds) for (const m of r.matches) if (m.id === mid) return m;
  return null;
}

function openSheet(matchID) {
  if (!data || entryClosed()) return;
  const m = findMatch(matchID);
  if (!m) return;
  const res = data.results[matchID];
  if (res && res.source === "app") return;
  sheetState = { matchID, confirmed: false, busy: false, pinNeeded: !lsGet(pinKey()) };
  buildSheet(m, res);
  $("sheet").hidden = false;
  const first = $("in-a"); if (first) first.focus();
}

function closeSheet() { $("sheet").hidden = true; sheetState = null; $("panel").replaceChildren(); }

function buildSheet(m, res) {
  const ppm = data.def.pointsPerMatch;
  const pm = playerMap(data.def);
  const teamLine = (cls, team) => h("div", {}, h("span", { class: "dot " + cls }), nameSpan(team.map((p) => pm.get(p) || "Player").join(" & ")));
  const inA = h("input", { id: "in-a", class: "score", type: "text", inputmode: "numeric", pattern: "[0-9]*", maxlength: "3", autocomplete: "off", "aria-label": "Score for the first team", value: res ? res.scoreA : "" });
  const inB = h("input", { id: "in-b", class: "score", type: "text", inputmode: "numeric", pattern: "[0-9]*", maxlength: "3", autocomplete: "off", "aria-label": "Score for the second team", value: res ? res.scoreB : "" });
  const early = h("input", { id: "in-early", type: "checkbox", checked: res && res.endedEarly ? true : null });
  const complement = (from, to) => () => {
    if (early.checked) return;
    const v = from.value.trim();
    to.value = /^\d{1,3}$/.test(v) && +v <= ppm ? String(ppm - +v) : "";
  };
  inA.addEventListener("input", complement(inA, inB));
  inB.addEventListener("input", complement(inB, inA));
  const nameIn = h("input", { id: "in-name", type: "text", maxlength: "40", autocomplete: "off", placeholder: "Optional", value: lsGet(NAME_KEY) || "" });
  const pinIn = h("input", { id: "in-pin", type: "password", inputmode: "numeric", pattern: "[0-9]*", maxlength: "4", autocomplete: "off", placeholder: "4 digits" });
  const err = h("div", { class: "err", id: "sheet-err", role: "alert" });
  const info = h("div", { class: "info", id: "sheet-info" });
  const submit = h("button", { class: "btn", type: "button", id: "sheet-submit" }, "Save score");
  submit.addEventListener("click", () => submitScore(m, { inA, inB, early, nameIn, pinIn, err, info, submit }));
  const cancel = h("button", { class: "btn secondary", type: "button", onclick: closeSheet }, "Cancel");
  $("panel").replaceChildren(
    h("h2", { id: "sheet-title" }, "Enter final score"),
    h("div", { class: "vs" }, teamLine("a", m.teamA), teamLine("b", m.teamB)),
    h("div", { class: "scores" }, h("label", { class: "f" }, "First team", inA), h("label", { class: "f" }, "Second team", inB)),
    h("label", { class: "check" }, early, `Ended early (total below ${ppm})`),
    h("label", { class: "f" }, "Your name", nameIn),
    sheetState.pinNeeded ? h("label", { class: "f" }, "Tournament PIN", pinIn) : null,
    info, err,
    h("div", { class: "actions" }, cancel, submit));
}

const ERR_TEXT = {
  400: "That score isn't valid for this match.",
  401: "Wrong PIN.",
  403: "This tournament is finished — scores are closed.",
  404: "Tournament or match not found.",
  409: "Scored by the app — ask the organizer to change it",
  413: "That entry is too large — shorten the name.",
  429: "Too many attempts. Wait ten minutes and try again.",
};
const OFFLINE_TEXT = "Can't reach the server. Check your connection and try again.";

async function workerPost(path, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(WORKER_URL + path, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: ctl.signal, referrerPolicy: "no-referrer", credentials: "omit" });
    return r.status;
  } catch (e) { return 0; }
  finally { clearTimeout(t); }
}
function statusText(code) { return code === 0 ? OFFLINE_TEXT : ERR_TEXT[code] || `Something went wrong (error ${code}). Try again.`; }

async function submitScore(m, f) {
  if (!sheetState || sheetState.busy) return;
  const ppm = data.def.pointsPerMatch;
  f.err.textContent = ""; f.info.textContent = "";
  const early = f.early.checked;
  const sa = f.inA.value.trim(), sb = f.inB.value.trim();
  if (!/^\d{1,3}$/.test(sa) || !/^\d{1,3}$/.test(sb)) { f.err.textContent = "Enter both scores as whole numbers."; return; }
  const a = +sa, b = +sb;
  if (!Standings.validScore(a, b, ppm, early)) {
    f.err.textContent = early ? `Ended early: the scores must add up to less than ${ppm}.` : `The scores must add up to ${ppm}.`;
    return;
  }
  const existing = data.results[m.id];
  if (existing && !sheetState.confirmed) {
    sheetState.confirmed = true;
    f.info.textContent = `This match already has ${existing.scoreA}–${existing.scoreB}. Press Replace score to overwrite it.`;
    f.submit.textContent = "Replace score";
    return;
  }
  let pin = lsGet(pinKey());
  if (!pin) {
    pin = f.pinIn.value.trim();
    if (!/^\d{4}$/.test(pin)) { f.err.textContent = "Enter the 4-digit tournament PIN."; return; }
  }
  sheetState.busy = true; f.submit.disabled = true;
  try {
    if (!lsGet(pinKey())) {
      const vs = await workerPost("/verify-pin", { tournamentID, pin });
      if (vs !== 200) { f.err.textContent = statusText(vs); return; }
      lsSet(pinKey(), pin);
    }
    const note = f.nameIn.value.trim().slice(0, 40);
    if (note) lsSet(NAME_KEY, note);
    const body = { tournamentID, matchID: m.id, scoreA: a, scoreB: b, endedEarly: early, pin };
    if (note) body.note = note;
    const code = await workerPost("/score", body);
    if (code === 200) {
      optimistic[m.id] = { scoreA: a, scoreB: b, endedEarly: early, until: Date.now() + OPTIMISTIC_MS };
      data.results[m.id] = { scoreA: a, scoreB: b, endedEarly: early, source: "web", submittedAt: Date.now(), note };
      lastSignature = ""; closeSheet(); render();
      scheduleNext(1500);   // pick up the real record soon
      return;
    }
    if (code === 401) {
      lsDel(pinKey());
      if (sheetState) { sheetState.pinNeeded = true; buildSheet(m, { scoreA: a, scoreB: b, endedEarly: early }); sheetState.confirmed = !!data.results[m.id]; if (sheetState.confirmed) $("sheet-submit").textContent = "Replace score"; }
      const e = $("sheet-err"); if (e) e.textContent = "That PIN isn't accepted. Enter it again.";
      return;
    }
    if (code === 409 || code === 403) { f.err.textContent = statusText(code); scheduleNext(500); return; }
    f.err.textContent = statusText(code);
  } finally {
    if (sheetState) { sheetState.busy = false; }
    if (f.submit.isConnected) f.submit.disabled = false;
  }
}

/* ── start ────────────────────────────────────────────────────────────── */
function start() {
  const cfg = envConfig();
  if (/PLACEHOLDER|PASTE/.test(cfg.token)) { showMessage("Not configured yet", "This page needs its CloudKit API token before it can show tournaments."); return; }
  if (typeof CloudKit === "undefined") { showMessage("Couldn't load", "The CloudKit library failed to load. Check your connection."); return; }
  CloudKit.configure({ containers: [{ containerIdentifier: CONTAINER,
    apiTokenAuth: { apiToken: cfg.token, persist: false }, environment: cfg.environment }] });
  ckDB = CloudKit.getDefaultContainer().publicCloudDatabase;
  tournamentID = tournamentIDFromURL();
  showMessage("Loading…", "Fetching the tournament.");
  poll();
}

$("tab-rounds").addEventListener("click", () => { activeTab = "rounds"; lastSignature = ""; if (data) render(); });
$("tab-standings").addEventListener("click", () => { activeTab = "standings"; lastSignature = ""; if (data) render(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && ckDB && tournamentID) { if (pollTimer) clearTimeout(pollTimer); poll(); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheetState) closeSheet(); });
$("sheet").addEventListener("click", (e) => { if (e.target === $("sheet")) closeSheet(); });
window.addEventListener("hashchange", () => {
  if (!ckDB) return;
  closeSheet(); data = null; lastSignature = ""; tournamentID = tournamentIDFromURL();
  for (const k of Object.keys(optimistic)) delete optimistic[k];
  toggledRounds.clear();
  showMessage("Loading…", "Fetching the tournament.");
  poll();
});
if (document.readyState === "complete") start();
else window.addEventListener("load", start);

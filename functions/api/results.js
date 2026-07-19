// Cloudflare Pages Function: tally singles match wins per player, expose the
// individual matches themselves (grouped by round) for the bracket view, and
// report the tournament's earliest scheduled match time (used to auto-set the
// pick-lock deadline) — all from ESPN's unofficial tennis scoreboard JSON.
// No API key, no cost.
//
// IMPORTANT: ESPN's tennis feed is UNOFFICIAL and its exact JSON shape can change
// without notice (and tennis is one of ESPN's less consistent feeds). The parser
// below walks the response defensively rather than hard-coding deep paths, but you
// should verify it once against a live response and tweak `singleAthlete` /
// `isCompleted` / `roundLabel` if ESPN's field names differ. See README
// "Verifying the scraper".
//
// Round labels are read defensively from several possible fields (see
// `roundLabel` below) since ESPN doesn't document this shape. If a match's round
// can't be identified it's bucketed under "Unknown round" rather than dropped, so
// missing data is visible instead of silently disappearing.
//
// Also note: like the win-tally above, this has no explicit multi-week date
// range by default (see the `dates` param) — without it, ESPN's scoreboard
// endpoint returns whatever its own default window is, which may not cover the
// entire two-week event. Pass `?dates=YYYYMMDD-YYYYMMDD` for a specific event's
// full span if the bracket (or the first-match-time detection below) looks off.
//
// Query params:
//   ?name=Australian Open   (optional) only count events whose name matches
//   ?dates=20260119-20260201 (optional) ESPN date window, YYYYMMDD-YYYYMMDD

const J = { "Content-Type": "application/json" };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: J });

const ESPN = (league, dates) =>
  `https://site.api.espn.com/apis/site/v2/sports/tennis/${league}/scoreboard` +
  (dates ? `?dates=${dates}&limit=300` : `?limit=300`);

function norm(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .toLowerCase().replace(/-/g, " ").replace(/[^a-z\s']/g, "").replace(/\s+/g, " ").trim();
}
const numOrNull = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

// ESPN doesn't always use a tournament's popular/display name — e.g. Indian Wells
// is commonly listed as its sponsor name. Add known aliases here as they're found
// to be wrong; this list is necessarily incomplete and worth checking against a
// live response if a bracket or deadline looks off for a given event.
const NAME_ALIASES = {
  "indian wells": ["indian wells", "bnp paribas open"],
  "roland garros": ["roland garros", "french open"],
  "wimbledon": ["wimbledon", "the championships"],
  "australian open": ["australian open"],
  "us open": ["us open"],
};
function aliasesFor(nameFilter) {
  return NAME_ALIASES[nameFilter] || [nameFilter];
}

// Matches live at ESPN's standard, documented site-API location: events[].competitions[].
// This USED to be an unconstrained recursive walk that grabbed any object anywhere in the
// response with a 2+-entry `competitors` array — but combined ATP+WTA weeks (e.g. Indian
// Wells) embed extra nested stuff elsewhere in the payload (cross-tour links, related-event
// blocks) that can coincidentally look match-shaped, which was leaking the other tour's
// players into this one's bracket and inflating some rounds with bogus entries. Scoping to
// the documented path only is a strict narrowing — it can drop false positives, never add
// legitimate matches ESPN wasn't already putting there.
function collectMatches(root, out) {
  const events = Array.isArray(root?.events) ? root.events : [];
  for (const ev of events) {
    const comps = Array.isArray(ev?.competitions) ? ev.competitions : [];
    for (const c of comps) {
      if (Array.isArray(c?.competitors) && c.competitors.length >= 2) out.push(c);
    }
  }
}

function isCompleted(comp) {
  const t = (comp && (comp.status?.type || comp.status)) || {};
  return Boolean(t.completed) || t.state === "post" ||
    /final|complete/i.test(String(t.name || t.description || ""));
}

// pull exactly one athlete (singles) out of a competitor; null for doubles/unknown
function singleAthlete(c) {
  if (!c || typeof c !== "object") return null;
  if (Array.isArray(c.athletes) && c.athletes.length > 1) return null; // doubles
  const a = c.athlete || (Array.isArray(c.athletes) ? c.athletes[0] : null);
  if (!a) return null;
  const name = a.displayName || a.fullName || a.shortName || a.name;
  if (!name) return null;
  return { name, seed: numOrNull(c.seed ?? c.curatedRank?.current ?? a.seed) };
}

// Best-effort round name for a match — ESPN doesn't document a stable field for
// this, so try several plausible spots before giving up.
function roundLabel(m) {
  return (
    m.notes?.[0]?.headline ||
    m.round?.displayName ||
    m.round?.text ||
    m.type?.text ||
    m.competitionType?.text ||
    m.header ||
    "Unknown round"
  );
}

// Canonical left-to-right column order for the bracket, independent of whatever
// order ESPN happens to list rounds in. Unrecognized labels sort to the end.
function roundRank(label) {
  const s = norm(label);
  if (/\b128\b/.test(s)) return 1;
  if (/\b64\b/.test(s)) return 2;
  if (/\b32\b/.test(s)) return 3;
  if (/\b16\b/.test(s) || /fourth round|4th round/.test(s)) return 4;
  if (/quarter/.test(s)) return 5;
  if (/semi/.test(s)) return 6;
  if (/\bfinal\b/.test(s)) return 7;
  return 99;
}

// Best-effort scheduled start time for a match — try several plausible fields.
function matchDate(m) {
  const d = m.date || m.startDate || m.competitions?.[0]?.date;
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : d;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const dates = url.searchParams.get("dates") || "";
  const nameFilter = norm(url.searchParams.get("name") || "");

  const players = {}; // normFullName -> { name, wins }
  const seeds = {};   // normFullName -> seed
  let matchesSeen = 0;
  const sources = [];
  const bracket = { atp: [], wta: [] };
  let firstMatchAt = null; // ISO string — earliest scheduled match across both leagues

  for (const lg of ["atp", "wta"]) {
    let data;
    try {
      const r = await fetch(ESPN(lg, dates), { headers: { accept: "application/json" } });
      if (!r.ok) { sources.push(`${lg}:HTTP_${r.status}`); continue; }
      data = await r.json();
    } catch { sources.push(`${lg}:fetch_error`); continue; }
    sources.push(`${lg}:ok`);

    // Narrow to the requested tournament by event name. IMPORTANT: if a name
    // filter was given but nothing matches, this must NOT fall back to the full
    // unfiltered event list — that would silently mix in every other tournament
    // happening at the same time (this was a real bug: Indian Wells' ESPN listing
    // uses its sponsor name, "BNP Paribas Open," not "Indian Wells," so an
    // exact-substring check found nothing and quietly showed everything).
    let root = data;
    if (nameFilter && Array.isArray(data.events)) {
      const terms = aliasesFor(nameFilter).map(norm);
      const ev = data.events.filter((e) => {
        const en = norm(e.name || e.shortName || "");
        return terms.some((t) => en.includes(t) || t.includes(en));
      });
      root = { events: ev }; // empty on no match — fail safe, not fail open
      sources.push(`${lg}:matched_events=${ev.length}`);
    }

    const matches = [];
    collectMatches(root, matches);

    const roundsMap = {}; // label -> { label, rank, matches: [] }

    for (const m of matches) {
      // Qualifying is a separate pre-tournament event ESPN bundles under the same
      // scoreboard — it's not part of the main draw picks/scoring/bracket cares
      // about (its "Qualifying Final" also collides with the real main-draw
      // Final under roundRank's \bfinal\b match, so it needs excluding before
      // that logic runs too, not just visually filtering it out later).
      const label = roundLabel(m);
      if (/qualif/i.test(label)) continue;

      const [p1, p2] = m.competitors.map(singleAthlete);
      if (!p1 || !p2) continue; // doubles or unparseable — skip for both tally and bracket

      // seed lookup, used elsewhere on the site
      if (p1.seed != null) seeds[norm(p1.name)] = p1.seed;
      if (p2.seed != null) seeds[norm(p2.name)] = p2.seed;

      const completed = isCompleted(m);
      const winnerComp = m.competitors.find((c) => c.winner === true || c.winner === "true");
      const winnerName = winnerComp ? singleAthlete(winnerComp)?.name || null : null;

      if (completed && winnerName) {
        matchesSeen++;
        const key = norm(winnerName);
        (players[key] || (players[key] = { name: winnerName, wins: 0 })).wins++;
      }

      const rank = roundRank(label);
      if (!roundsMap[label]) roundsMap[label] = { label, rank, matches: [] };
      roundsMap[label].matches.push({ p1, p2, winner: completed ? winnerName : null, completed });

      const d = matchDate(m);
      if (d && (!firstMatchAt || new Date(d).getTime() < new Date(firstMatchAt).getTime())) {
        firstMatchAt = d;
      }
    }

    bracket[lg] = Object.values(roundsMap).sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  }

  return json({ players, seeds, matches: matchesSeen, sources, bracket, firstMatchAt });
}

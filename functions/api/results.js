// Cloudflare Pages Function: tally singles match wins per player, AND expose the
// individual matches themselves (grouped by round) so the site can render a
// columns-per-round bracket view, from ESPN's unofficial tennis scoreboard JSON.
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
// full span if the bracket looks incomplete.
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

// recursively collect any object that looks like a match (has 2+ competitors)
function collectMatches(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const x of node) collectMatches(x, out); return; }
  if (Array.isArray(node.competitors) && node.competitors.length >= 2) out.push(node);
  for (const k in node) { const v = node[k]; if (v && typeof v === "object") collectMatches(v, out); }
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

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const dates = url.searchParams.get("dates") || "";
  const nameFilter = norm(url.searchParams.get("name") || "");

  const players = {}; // normFullName -> { name, wins }
  const seeds = {};   // normFullName -> seed
  let matchesSeen = 0;
  const sources = [];
  const bracket = { atp: [], wta: [] };

  for (const lg of ["atp", "wta"]) {
    let data;
    try {
      const r = await fetch(ESPN(lg, dates), { headers: { accept: "application/json" } });
      if (!r.ok) { sources.push(`${lg}:HTTP_${r.status}`); continue; }
      data = await r.json();
    } catch { sources.push(`${lg}:fetch_error`); continue; }
    sources.push(`${lg}:ok`);

    // optionally narrow to the requested tournament by event name
    let root = data;
    if (nameFilter && Array.isArray(data.events)) {
      const ev = data.events.filter((e) =>
        norm(e.name || e.shortName || "").includes(nameFilter) ||
        nameFilter.includes(norm(e.shortName || "")));
      if (ev.length) root = { events: ev };
    }

    const matches = [];
    collectMatches(root, matches);

    const roundsMap = {}; // label -> { label, rank, matches: [] }

    for (const m of matches) {
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

      const label = roundLabel(m);
      const rank = roundRank(label);
      if (!roundsMap[label]) roundsMap[label] = { label, rank, matches: [] };
      roundsMap[label].matches.push({ p1, p2, winner: completed ? winnerName : null, completed });
    }

    bracket[lg] = Object.values(roundsMap).sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
  }

  return json({ players, seeds, matches: matchesSeen, sources, bracket });
}

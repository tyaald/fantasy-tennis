// Cloudflare Pages Function: tally singles match wins per player from ESPN's
// unofficial tennis scoreboard JSON. No API key, no cost.
//
// IMPORTANT: ESPN's tennis feed is UNOFFICIAL and its exact JSON shape can change
// without notice (and tennis is one of ESPN's less consistent feeds). The parser
// below walks the response defensively rather than hard-coding deep paths, but you
// should verify it once against a live response and tweak `singleAthlete` /
// `isCompleted` if ESPN's field names differ. See README "Verifying the scraper".
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

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const dates = url.searchParams.get("dates") || "";
  const nameFilter = norm(url.searchParams.get("name") || "");

  const players = {}; // normFullName -> { name, wins }
  const seeds = {};   // normFullName -> seed
  let matchesSeen = 0;
  const sources = [];

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
    for (const m of matches) {
      if (!isCompleted(m)) continue;
      const winner = m.competitors.find((c) => c.winner === true || c.winner === "true");
      if (!winner) continue;
      const w = singleAthlete(winner);
      if (!w) continue; // doubles or unparseable
      matchesSeen++;
      const key = norm(w.name);
      (players[key] || (players[key] = { name: w.name, wins: 0 })).wins++;
      for (const c of m.competitors) {
        const s = singleAthlete(c);
        if (s && s.seed != null) seeds[norm(s.name)] = s.seed;
      }
    }
  }

  return json({ players, seeds, matches: matchesSeen, sources });
}

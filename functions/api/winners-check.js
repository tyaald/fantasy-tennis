// Cloudflare Pages Function: checks every tournament the pool has actually used
// this year (i.e. has a saved roster) against live ESPN results. The moment BOTH
// a men's and a women's tennis champion are found (7 match wins) — used purely as
// the "tournament is actually over" signal — it works out who won each bracket OF
// THE POOL, records that into the same Record Books ledger the site's own "Record
// to Record Books" button writes to, and emails the mailing list with the pool
// winners (not the real tennis champions — those are only the trigger signal).
// Recording happens even if email isn't configured; each event is only ever
// processed once (tracked via winners-sent:<event>).
//
// This is pinged on a schedule by a small separate Worker (see /cron-worker) —
// Cloudflare Pages Functions don't support Cron Triggers directly, only plain
// Workers do. Protected by CRON_SECRET so randoms can't trigger sends.
//
// Relies on the same unverified ESPN scraper as functions/api/results.js — see
// the README's "Verifying the scraper" section. If that feed's shape changes,
// this silently finds nothing rather than sending anything wrong.

const J = { "Content-Type": "application/json" };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: J });

const TOURNAMENTS = [
  { id: "ao",  name: "Australian Open" },
  { id: "iw",  name: "Indian Wells" },
  { id: "rg",  name: "Roland Garros" },
  { id: "wim", name: "Wimbledon" },
  { id: "uso", name: "US Open" },
];

// Scoring rules — MUST match CATEGORIES and UNCAPPED_EVENTS in src/App.jsx.
const CATEGORIES = [
  { key: "winner",    cap: null },
  { key: "runnerUp",  cap: 6 },
  { key: "sf1",       cap: 5 },
  { key: "sf2",       cap: 5 },
  { key: "darkHorse", cap: null },
  { key: "longShot",  cap: null },
  { key: "dreamer",   cap: null },
];
const UNCAPPED_EVENTS = new Set(["iw-2024", "iw-2025", "wim-2025", "uso-2025", "ao-2026"]);

// MUST match the normalizer in functions/api/results.js and src/App.jsx.
const norm = (s) => String(s || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/-/g, " ").replace(/[^a-z\s']/g, "").replace(/\s+/g, " ").trim();

// Match a roster/pick entry (usually a surname) against the scraped
// { normFullName: {name, wins} } map. MUST match matchScraped in src/App.jsx.
function matchScraped(pickName, scrapedPlayers) {
  const p = norm(pickName);
  if (!p) return null;
  const pLast = p.split(" ").pop();
  let hit = null, ambiguous = false;
  for (const k in scrapedPlayers) {
    const last = k.split(" ").pop();
    const ok = k === p || last === pLast || k.endsWith(" " + p) || p.endsWith(" " + last);
    if (ok) {
      if (hit && norm(hit.name) !== norm(scrapedPlayers[k].name)) ambiguous = true;
      hit = scrapedPlayers[k];
    }
  }
  return ambiguous ? null : hit;
}

const scoreFor = (matchWins, cap, useCaps) => {
  const w = Number(matchWins) || 0;
  return (useCaps && cap != null) ? Math.min(w, cap) : w;
};

function champFor(rosterNames, players) {
  for (const name of rosterNames || []) {
    const hit = matchScraped(name, players);
    if (hit && hit.wins >= 7) return hit.name;
  }
  return null;
}

// Reads every saved pick for this event out of KV and returns [{name, men, women}].
async function getPool(kv, ek) {
  const out = [];
  let cursor;
  do {
    const list = await kv.list({ prefix: `picks:${ek}:`, cursor });
    for (const k of list.keys) {
      const raw = await kv.get(k.name);
      if (!raw) continue;
      try { out.push(JSON.parse(raw)); } catch { /* skip bad entry */ }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return out;
}

// Works out who won the pool's Men's bracket and Women's bracket — same scoring
// and same tiebreak order (Champion, Runner-up, Best Semi-Finalist, Dreamer, Long
// Shot, Dark Horse, compared only within one bracket) as the Standings tab.
function poolBracketWinners(pool, players, capsApply) {
  const catScore = (picks, key) => {
    const cap = CATEGORIES.find((c) => c.key === key).cap;
    const hit = matchScraped((picks || {})[key], players);
    return scoreFor(hit?.wins, cap, capsApply);
  };
  const sideTotal = (picks) => CATEGORIES.reduce((sum, c) => sum + catScore(picks, c.key), 0);

  const rows = pool.map((r) => ({
    name: r.name,
    men_pts: sideTotal(r.men || {}),
    women_pts: sideTotal(r.women || {}),
    men: r.men || {},
    women: r.women || {},
  }));

  const bestSF = (picks) => Math.max(catScore(picks, "sf1"), catScore(picks, "sf2"));

  const winnerOf = (side) => {
    const pts = side === "men" ? "men_pts" : "women_pts";
    const ranked = [...rows].sort((a, b) => {
      const pa = a[side], pb = b[side];
      return (
        b[pts] - a[pts] ||
        catScore(pb, "winner") - catScore(pa, "winner") ||
        catScore(pb, "runnerUp") - catScore(pa, "runnerUp") ||
        bestSF(pb) - bestSF(pa) ||
        catScore(pb, "dreamer") - catScore(pa, "dreamer") ||
        catScore(pb, "longShot") - catScore(pa, "longShot") ||
        catScore(pb, "darkHorse") - catScore(pa, "darkHorse") ||
        a.name.localeCompare(b.name)
      );
    });
    const top = ranked[0];
    return top && top[pts] > 0 ? { name: top.name, pts: top[pts] } : null;
  };

  return { menPoolChamp: winnerOf("men"), womenPoolChamp: winnerOf("women") };
}

async function getSubscriberEmails(kv) {
  const emails = [];
  let cursor;
  do {
    const list = await kv.list({ prefix: "subscriber:", cursor });
    for (const k of list.keys) {
      const raw = await kv.get(k.name);
      if (!raw) continue;
      try { const p = JSON.parse(raw); if (p.email) emails.push(p.email); } catch { /* skip */ }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return [...new Set(emails.map((e) => e.toLowerCase()))];
}

// Writes into the same shared "champions" ledger the site's own "Record to Record
// Books" button uses (championsKey() in src/App.jsx — one JSON object, keyed by
// event, shared across every event). Never overwrites an entry that's already
// there, so a manual correction someone made in the UI always wins over this.
async function recordChampions(kv, ek, entry) {
  const raw = await kv.get("champions");
  let champions = {};
  try { champions = raw ? JSON.parse(raw) : {}; } catch { champions = {}; }
  if (champions[ek]) return false; // already recorded — leave it alone
  champions[ek] = entry;
  await kv.put("champions", JSON.stringify(champions));
  return true;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.CRON_SECRET || request.headers.get("x-cron-secret") !== env.CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  const kv = env.POOL_KV;
  if (!kv) return json({ error: "POOL_KV not bound" }, 500);

  const year = new Date().getFullYear();
  const origin = new URL(request.url).origin;
  const outcome = [];

  for (const t of TOURNAMENTS) {
    const ek = `${t.id}-${year}`;

    // Only check events the pool has actually touched this year.
    const rosterRaw = await kv.get(`roster:${ek}`);
    if (!rosterRaw) continue;
    let roster;
    try { roster = JSON.parse(rosterRaw); } catch { continue; }
    if (!roster?.men?.length || !roster?.women?.length) continue;

    // Already sent for this event — skip.
    if (await kv.get(`winners-sent:${ek}`)) continue;

    let data;
    try {
      const r = await fetch(`${origin}/api/results?name=${encodeURIComponent(t.name)}`);
      data = await r.json();
    } catch {
      outcome.push({ ek, error: "results fetch failed" });
      continue;
    }
    const players = data?.players || {};

    const menWinner = champFor(roster.men, players);
    const womenWinner = champFor(roster.women, players);

    if (!menWinner || !womenWinner) {
      outcome.push({ ek, done: false });
      continue;
    }

    const pool = await getPool(kv, ek);
    const capsApply = !UNCAPPED_EVENTS.has(ek);
    const { menPoolChamp, womenPoolChamp } = poolBracketWinners(pool, players, capsApply);

    // Record to the Record Books first — this happens regardless of whether email
    // is configured, so results still get archived even if Resend isn't set up.
    const recorded = await recordChampions(kv, ek, {
      men: menPoolChamp?.name || "",
      women: womenPoolChamp?.name || "",
    });

    const poolLine = (label, champ) =>
      champ ? `🏆 <b>${champ.name}</b> takes the ${label} bracket with ${champ.pts} points.` : null;
    const poolLines = [poolLine("Men's", menPoolChamp), poolLine("Women's", womenPoolChamp)]
      .filter(Boolean).join(" ");

    let emailSent = false, emailError = null;

    if (!env.RESEND_API_KEY || !env.FROM_EMAIL) {
      emailError = "RESEND_API_KEY/FROM_EMAIL not set";
    } else {
      const emails = await getSubscriberEmails(kv);
      if (!emails.length) {
        emailError = "no subscribers";
      } else {
        const html =
          `Tennis aficionados:<br><br>` +
          `${t.name} ${year} is in the books! ` +
          (poolLines
            ? `In the pool: ${poolLines}<br><br>`
            : `Pool standings will update on the site shortly.<br><br>`) +
          `Check the site for the full breakdown.`;

        const upstream = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: env.FROM_EMAIL,
            to: [...new Set([env.FROM_EMAIL, ...emails])],
            subject: `Champions crowned: ${t.name} ${year}`,
            html,
          }),
        });

        if (upstream.ok) emailSent = true;
        else emailError = await upstream.text();
      }
    }

    // Mark this event as fully processed either way — the tournament is over and
    // the Record Books are updated, so there's nothing left to re-check on future
    // runs even if email failed (e.g. Resend not configured yet).
    await kv.put(`winners-sent:${ek}`, JSON.stringify({
      menPoolChamp: menPoolChamp?.name || null,
      womenPoolChamp: womenPoolChamp?.name || null,
      recorded, emailSent, emailError,
      sentAt: Date.now(),
    }));
    outcome.push({ ek, done: true, recorded, emailSent, emailError, menPoolChamp, womenPoolChamp });
  }

  return json({ checked: TOURNAMENTS.length, year, outcome });
}

export async function onRequest(context) {
  if (context.request.method !== "POST") return json({ error: "POST only" }, 405);
  return onRequestPost(context);
}

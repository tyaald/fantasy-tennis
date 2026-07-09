// Cloudflare Pages Function: checks every tournament the pool has actually used
// this year (i.e. has a saved roster) against live ESPN results. The moment BOTH
// a men's and a women's champion are found (7 match wins), it emails the mailing
// list once and marks that event as sent.
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

// MUST match the normalizer in functions/api/results.js and src/App.jsx.
const norm = (s) => String(s || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/-/g, " ").replace(/[^a-z\s']/g, "").replace(/\s+/g, " ").trim();

// Match a roster entry (usually a surname) against the scraped { normFullName: {name, wins} } map.
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

function champFor(rosterNames, players) {
  for (const name of rosterNames || []) {
    const hit = matchScraped(name, players);
    if (hit && hit.wins >= 7) return hit.name;
  }
  return null;
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

    if (!env.RESEND_API_KEY || !env.FROM_EMAIL) {
      outcome.push({ ek, done: true, sent: false, error: "RESEND_API_KEY/FROM_EMAIL not set" });
      continue;
    }

    const emails = await getSubscriberEmails(kv);
    if (!emails.length) {
      outcome.push({ ek, done: true, sent: false, error: "no subscribers" });
      continue;
    }

    const html =
      `Tennis aficionados:<br><br>` +
      `${t.name} ${year} is in the books! Congratulations to <b>${menWinner}</b> (Men's) ` +
      `and <b>${womenWinner}</b> (Women's). 🏆<br><br>` +
      `Standings will update on the pool site shortly.`;

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

    if (!upstream.ok) {
      outcome.push({ ek, done: true, sent: false, error: await upstream.text() });
      continue;
    }

    await kv.put(`winners-sent:${ek}`, JSON.stringify({ men: menWinner, women: womenWinner, sentAt: Date.now() }));
    outcome.push({ ek, done: true, sent: true, menWinner, womenWinner, count: emails.length });
  }

  return json({ checked: TOURNAMENTS.length, year, outcome });
}

export async function onRequest(context) {
  if (context.request.method !== "POST") return json({ error: "POST only" }, 405);
  return onRequestPost(context);
}

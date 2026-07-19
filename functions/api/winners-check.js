// Cloudflare Pages Function, pinged on a schedule by /cron-worker (Pages
// Functions can't hold Cron Triggers themselves — only plain Workers can).
// Protected by CRON_SECRET. Each cycle, for every tournament the pool tracks:
//
//  1. AUTO-ANNOUNCE: if ESPN shows the draw is out (a scheduled first match
//     exists) and nobody's been told yet, build the roster via the same
//     AI+web-search call "Load field from draw" uses, then compose and send
//     the draw-release email with ZERO human review — draw links come from
//     DRAW_LINKS below, the deadline is the tournament's real first-match
//     time, and the buy-in/rule-note/sign-off wording reuses whatever you
//     used in your last manual send (functions/api/send-email.js persists
//     that as "email-defaults" on every successful manual send).
//  2. DEADLINE SYNC: keeps the pick-lock deadline matched to the real first
//     match time, once announced (see #1). Never overwrites a manual pin.
//  3. WINNERS: the moment both a men's and women's tennis champion are found
//     (7 match wins — used purely as "the tournament is actually over"),
//     works out who won each bracket OF THE POOL, records it to the Record
//     Books ledger, and emails the list with the pool winners (not the real
//     tennis champions — those are only the trigger signal).
//
// Every step here is best-effort against ESPN's UNOFFICIAL, undocumented
// tennis feed — see functions/api/results.js and the README's "Verifying the
// scraper" section. A parsing miss means something silently doesn't fire,
// not that something wrong gets sent — but with #1 now fully automatic and
// unreviewed, it's worth actually watching your inbox around a new draw the
// first few times this runs, not just assuming it worked.

const J = { "Content-Type": "application/json" };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: J });

const TOURNAMENTS = [
  { id: "ao",  name: "Australian Open" },
  { id: "iw",  name: "Indian Wells" },
  { id: "rg",  name: "Roland Garros" },
  { id: "wim", name: "Wimbledon" },
  { id: "uso", name: "US Open" },
];

// Best-effort official draw-page links per tournament. MUST match DRAW_LINKS
// in src/App.jsx (kept in sync manually — see note there). Verify before a
// new season if a link 404s; site structures change.
const DRAW_LINKS = {
  ao:  { men: "https://ausopen.com/draws",                                women: "https://ausopen.com/draws" },
  iw:  { men: "https://bnpparibasopen.com/scores/draws",                  women: "https://bnpparibasopen.com/scores/draws?selected=womensSingles" },
  rg:  { men: "https://www.rolandgarros.com/en-us/draws",                 women: "https://www.rolandgarros.com/en-us/draws" },
  wim: { men: "https://www.wimbledon.com/en_GB/draws/gentlemens-singles", women: "https://www.wimbledon.com/en_GB/draws/ladies-singles" },
  uso: { men: "https://www.usopen.org/en_US/draws/mens-singles.html",     women: "https://www.usopen.org/en_US/draws/womens-singles.html" },
};

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

async function sendResendEmail(env, { subject, html, emails }) {
  const upstream = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [...new Set([env.FROM_EMAIL, ...emails])],
      subject,
      html,
    }),
  });
  if (upstream.ok) return { ok: true };
  return { ok: false, error: await upstream.text() };
}

// Same prompt/parsing as fetchDraw's `ask()` in src/App.jsx, called server-to-
// server instead of from the browser. Needs ANTHROPIC_API_KEY set (same secret
// "Load field from draw" already relies on).
async function buildRosterViaAI(origin, tourName, year) {
  const ask = async (label) => {
    const prompt =
`List every player in the ${label} singles MAIN DRAW of the ${tourName} ${year} tennis tournament. If the official draw is not out yet, use the confirmed entry list (the field).

For seeded players, use the SEED NUMBER the tournament assigned in THIS event's draw (usually 1–32) — NOT the player's ATP/WTA world ranking. These often differ when higher-ranked players are absent; always use the draw's seeding.

Respond with ONLY a JSON array of strings, one per player. Prefix a seeded player's name with their seed number and a pipe, e.g. "5|Rune". Unseeded players are just the name, e.g. "Brooksby". Use surname only, or "F. Surname" to disambiguate. No prose, no markdown. Example: ["1|Alcaraz","2|Sinner","Brooksby","Mpetshi Perricard"]`;
    const res = await fetch(`${origin}/api/anthropic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic request failed (${res.status})`);
    const data = await res.json();
    if (data?.type === "error") throw new Error(data.error?.message || "anthropic API error");
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const a = text.indexOf("["), b = text.lastIndexOf("]");
    if (a === -1 || b === -1) return { names: [], seeds: {} };
    let arr; try { arr = JSON.parse(text.slice(a, b + 1)); } catch { return { names: [], seeds: {} }; }
    if (!Array.isArray(arr)) return { names: [], seeds: {} };
    const names = []; const seeds = {};
    arr.forEach((entry) => {
      if (typeof entry !== "string") return;
      const m = /^\s*(\d{1,2})\s*\|\s*(.+)$/.exec(entry);
      const nm = (m ? m[2] : entry).trim();
      if (!nm) return;
      if (!names.includes(nm)) names.push(nm);
      if (m) seeds[nm] = Number(m[1]);
    });
    names.sort((x, y) => x.localeCompare(y));
    return { names, seeds };
  };

  const [m, w] = await Promise.all([ask("men's (ATP)"), ask("women's (WTA)")]);
  return { men: m.names, women: w.names, menSeeds: m.seeds, womenSeeds: w.seeds };
}

function buildAnnounceEmailHtml({ tournament, firstMatchAt, mensUrl, womensUrl, siteUrl, buyin, ruleNote, sender }) {
  const mensLink = mensUrl ? `<a href="${mensUrl}">Men's</a>` : "Men's";
  const womensLink = womensUrl ? `<a href="${womensUrl}">Women's</a>` : "Women's";
  const siteLink = siteUrl ? `<a href="${siteUrl}">pool site</a>` : "pool site";
  const deadlineText = firstMatchAt
    ? new Date(firstMatchAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
    : "the tournament's first match";

  let body = `Tennis aficionados:<br><br>`;
  body += `It's time for ${tournament}, which means it's time to make your bets<br><br>`;
  body += `Please enter your picks for the ${mensLink} and ${womensLink} brackets on the ${siteLink} by ${deadlineText}, when picks lock automatically.<br><br>`;
  if (ruleNote) body += `${ruleNote}<br><br>`;
  body += `The buy-in remains the same, with ${buyin || "the usual amount — check with the organizer"}. Buy-in goes as a donation to <a href="https://visionaries-international.org/donate/">Visionaries International.</a><br><br>`;
  body += `You are welcome to share this with others (which means if you win you get more money 😉). `;
  body += `Note that "Top 10, 20, 30" refers to the seeding in the tournament, not the ATP or WTA ranking. `;
  body += `Please be sure to fill in only the player's last name correctly (if there are multiple players with the same last name, fill in the name with the first letter of the first name).<br><br>`;
  body += `Good luck, have fun!<br>${sender || ""}`;
  body += `<br><br><span style="font-size:11px;color:#888">This email was sent automatically once the draw was detected — no human reviewed it before it went out.</span>`;
  return body;
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

    // Request an explicit ~6-week window centered on today (not forward-only —
    // a tournament already in progress needs its earlier days included too, or
    // completed-match win-tallying breaks) rather than relying on ESPN's
    // undocumented default, which may only cover "today" and miss the schedule
    // entirely before a tournament starts — exactly when firstMatchAt matters most.
    const today = new Date();
    const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const windowStart = new Date(today.getTime() - 21 * 86400000);
    const windowEnd = new Date(today.getTime() + 21 * 86400000);
    const dates = `${fmt(windowStart)}-${fmt(windowEnd)}`;

    let data;
    try {
      const r = await fetch(`${origin}/api/results?name=${encodeURIComponent(t.name)}&dates=${dates}`);
      data = await r.json();
    } catch {
      outcome.push({ ek, error: "results fetch failed" });
      continue;
    }
    const players = data?.players || {};

    // ---------- 1. AUTO-ANNOUNCE ----------
    // If the draw looks out (ESPN has a scheduled first match) and nobody's
    // been told yet, build the roster if it doesn't exist, then compose and
    // send the draw email with zero review.
    let announced = await kv.get(`email-sent:${ek}`);
    if (!announced && data?.firstMatchAt) {
      let roster = null;
      const rosterRaw = await kv.get(`roster:${ek}`);
      if (rosterRaw) { try { roster = JSON.parse(rosterRaw); } catch { roster = null; } }

      if (!roster || !roster.men?.length || !roster.women?.length) {
        try {
          roster = await buildRosterViaAI(origin, t.name, year);
          if (roster.men?.length && roster.women?.length) {
            await kv.put(`roster:${ek}`, JSON.stringify(roster));
          }
        } catch (err) {
          outcome.push({ ek, autoAnnounce: false, error: `roster build failed: ${err.message}` });
          roster = null;
        }
      }

      if (roster?.men?.length && roster?.women?.length && env.RESEND_API_KEY && env.FROM_EMAIL) {
        const emails = await getSubscriberEmails(kv);
        if (emails.length) {
          let defaults = {};
          try { defaults = JSON.parse((await kv.get("email-defaults")) || "{}"); } catch { defaults = {}; }

          const html = buildAnnounceEmailHtml({
            tournament: `${t.name} ${year}`,
            firstMatchAt: data.firstMatchAt,
            mensUrl: DRAW_LINKS[t.id]?.men || "",
            womensUrl: DRAW_LINKS[t.id]?.women || "",
            siteUrl: origin,
            buyin: defaults.buyin,
            ruleNote: defaults.ruleNote,
            sender: defaults.sender,
          });

          const sent = await sendResendEmail(env, {
            subject: `Picks are open: ${t.name} ${year}`,
            html,
            emails,
          });

          if (sent.ok) {
            await kv.put(`email-sent:${ek}`, JSON.stringify({ sentAt: Date.now(), auto: true }));
            announced = "1";
            outcome.push({ ek, autoAnnounce: true, count: emails.length });
          } else {
            outcome.push({ ek, autoAnnounce: false, error: sent.error });
          }
        } else {
          outcome.push({ ek, autoAnnounce: false, error: "no subscribers" });
        }
      }
    }

    // Only check events with a usable roster from here on (may have just been
    // created above).
    const rosterRaw2 = await kv.get(`roster:${ek}`);
    if (!rosterRaw2) continue;
    let roster2;
    try { roster2 = JSON.parse(rosterRaw2); } catch { continue; }
    if (!roster2?.men?.length || !roster2?.women?.length) continue;

    // ---------- 2. DEADLINE SYNC ----------
    // Keep the pick-lock deadline synced to the tournament's actual first
    // scheduled match. Only starts once announced (see #1) — the countdown
    // shouldn't start ticking before anyone's been told about it. Never
    // overwrites a manually-pinned deadline (source: "manual").
    if (announced && data?.firstMatchAt) {
      const deadlineRaw = await kv.get(`deadline:${ek}`);
      let current = null;
      try { current = deadlineRaw ? JSON.parse(deadlineRaw) : null; } catch { current = null; }
      const isManual = current?.source === "manual";
      const alreadySynced = current?.source === "auto" && current?.value === data.firstMatchAt;
      if (!isManual && !alreadySynced) {
        await kv.put(`deadline:${ek}`, JSON.stringify({
          value: data.firstMatchAt, source: "auto", updatedAt: Date.now(),
        }));
      }
    }

    // ---------- 3. WINNERS ----------
    // Already sent for this event — skip.
    if (await kv.get(`winners-sent:${ek}`)) continue;

    const menWinner = champFor(roster2.men, players);
    const womenWinner = champFor(roster2.women, players);

    if (!menWinner || !womenWinner) {
      outcome.push({
        ek, done: false,
        announced: Boolean(announced),
        deadlineSyncedTo: announced ? (data?.firstMatchAt || null) : null,
      });
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

        const sent = await sendResendEmail(env, { subject: `Champions crowned: ${t.name} ${year}`, html, emails });
        emailSent = sent.ok;
        emailError = sent.ok ? null : sent.error;
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

# Tennis Pool — Cloudflare Pages

A fantasy tennis pool. React (Vite) front end, with Cloudflare Pages Functions:

- `functions/api/kv.js` — shared storage for everyone's picks/results, backed by a **KV namespace**.
- `functions/api/anthropic.js` — a **key-protected proxy** to the Anthropic API, used by the
  "Auto-fetch results" and "Load field from draw" features.
- `functions/api/subscribe.js`, `subscribers.js`, `send-email.js` — the **Join & Notify** tab: a
  public mailing-list sign-up, plus a password-gated composer that emails everyone when a new
  draw is out.

The original app ran inside Claude and used Claude's built-in storage and API access. Those have
been swapped for the functions above so it can run as a normal website.

---

## 1. Prerequisites

- **Node 18+** and npm.
- A free **Cloudflare** account.
- An **Anthropic API key** (https://console.anthropic.com) — required only for the auto-fetch and
  draw features. Everything else works without it.

```bash
npm install
```

## 2. Run it locally

Front end only (storage + AI calls will no-op gracefully):

```bash
npm run dev
```

Full stack locally (functions + KV + your key) — recommended:

```bash
cp .dev.vars.example .dev.vars      # then put your real key in .dev.vars
npm run build
npx wrangler pages dev dist --kv POOL_KV
```

`--kv POOL_KV` gives you a local KV store. Open the printed localhost URL.

## 3. Create the KV namespace (one time)

```bash
npx wrangler kv namespace create POOL_KV
```

Copy the printed `id` into `wrangler.toml` (replace `PUT_YOUR_KV_NAMESPACE_ID_HERE`).

## 4. Deploy

### Option A — Wrangler CLI (fastest)

```bash
npx wrangler login
npm run deploy            # builds, then `wrangler pages deploy dist`
```

Then set your secret and (if you didn't use wrangler.toml) bind KV:

```bash
npx wrangler pages secret put ANTHROPIC_API_KEY
```

### Option B — Git + Cloudflare dashboard (auto-deploy on push)

1. Push this folder to a GitHub/GitLab repo.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build settings:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. After the first deploy, open the project → **Settings**:
   - **Functions → KV namespace bindings:** add variable name `POOL_KV` → your namespace.
   - **Environment variables:** add `ANTHROPIC_API_KEY` and click **Encrypt** (makes it a secret).
5. Re-deploy so the bindings take effect.

Every push to the connected branch now redeploys automatically.

---

## How it maps to the code

| App needs            | Provided by                          | Binding / secret      |
|----------------------|--------------------------------------|-----------------------|
| Shared pool storage  | `functions/api/kv.js` + KV namespace | `POOL_KV` (KV)        |
| Results / draw fetch | `functions/api/anthropic.js`         | `ANTHROPIC_API_KEY`   |
| Draw-release emails  | `functions/api/send-email.js`        | `RESEND_API_KEY`, `FROM_EMAIL`, `SEND_PASSWORD` |
| Automatic winners email | `functions/api/winners-check.js` + `cron-worker/` | `CRON_SECRET` (+ the three above) |
| Pick-lock deadline + countdown | `functions/api/deadline.js` | `SEND_PASSWORD` (reused, no new secret) |
| Automatic draw announcement | `functions/api/winners-check.js` + `functions/api/anthropic.js` | `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `FROM_EMAIL` (all reused) |

The front end calls `/api/kv` and `/api/anthropic` — same-origin, so no CORS and the key never
reaches the browser.

## Notes & costs

- **KV is eventually consistent** (a write can take up to ~60s to be visible everywhere). Fine for a
  pool; just don't expect instant cross-device sync to the millisecond.
- **The AI features bill to YOUR Anthropic key**, and they use Anthropic's **web search** tool, which
  is a paid add-on. The proxy caps `max_tokens` at 1000 as a small guardrail. Turn off "Auto-check on
  load" in the app if you want to minimize calls.
- **Model / tool versions:** the front end requests model `claude-sonnet-4-6` and the
  `web_search_20250305` tool. If Anthropic updates these, change the strings in `src/App.jsx`
  (two spots each) — see https://docs.claude.com for current values.
- **No accounts/auth:** like the original, the pool is open — anyone with the URL can add or edit
  picks. If you want it private, put Cloudflare Access in front of the Pages project.

## Results: free ESPN scrape, Claude as backup

Results now come from **ESPN's free, unofficial JSON** instead of a paid Claude call:

- `functions/api/results.js` fetches the ATP + WTA tennis scoreboards from
  `site.api.espn.com`, walks the JSON, and tallies how many singles matches each player has
  **won** in the tournament (doubles and unfinished matches are ignored). It returns
  `{ players: { "carlos alcaraz": { name, wins } }, seeds: {...} }`.
- The app matches those winners to your picks by surname (`matchScraped` in `App.jsx`) and applies
  them with the same "only goes up, confirm a drop" logic as before.
- **Claude is only a fallback.** If the scrape returns nothing usable (endpoint changed, event not
  found), `fetchResults` falls back to the `/api/anthropic` call. So in the normal case, results
  cost **$0**; Claude is the safety net.

The **seeded draw** (Load field from draw) still uses Claude, on purpose: ESPN's scoreboard only
lists players once they have matches, so it can't give you the full pre-tournament seeded draw.
That call is one-time per event and ~15¢, and Claude reads the official seeded draw reliably.

### ⚠️ Verifying the scraper (do this once)

ESPN's tennis feed is unofficial and its field names can differ from what this parser assumes — and
I couldn't test it against a live response while building it. Before you rely on it:

1. Open `https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard` in a browser during a
   live tournament and look at the JSON.
2. Confirm the parser's assumptions in `functions/api/results.js`:
   - `isCompleted()` — how ESPN marks a finished match (`status.type.completed` / `state: "post"`).
   - `singleAthlete()` — where the player name lives (`competitor.athlete.displayName`) and where the
     **seed** lives (`competitor.seed`).
   - winner flag — `competitor.winner === true`.
3. Tweak those three spots if the live shape differs. The traversal (`collectMatches`) is generic, so
   usually only field names need adjusting.

If you'd rather not maintain a scraper at all, delete `functions/api/results.js` and the `viaEspn`
block in `fetchResults` — the app falls back to the Claude path automatically.

## Join & Notify: mailing list + draw-release email

The **Join & Notify** tab has two halves:

- **Public sign-up** — anyone visiting the site can enter their name and email to join the
  mailing list. Stored in the same `POOL_KV` namespace (key prefix `subscriber:`), so no extra
  storage to set up.
- **Organizer panel** — enter a send password, fill in the details that change each tournament
  (deadline, draw links, etc.), watch the live preview, and click **Send to mailing list**. It
  emails everyone in the format you already use, via [Resend](https://resend.com).

To turn this on, set three more secrets (same method as `ANTHROPIC_API_KEY` above):

```bash
npx wrangler pages secret put RESEND_API_KEY   # free at resend.com, verify a sending domain
npx wrangler pages secret put FROM_EMAIL        # e.g. "Tennis Pool <pool@yourdomain.com>"
npx wrangler pages secret put SEND_PASSWORD     # any password — typed into the admin panel to send
```

Or in the dashboard: **Settings → Environment variables → Add**, mark each as a **Secret**, then
redeploy. Without these three set, sign-ups still work (they just sit in KV); sending returns a
clear error telling you which one is missing.

**Everyone's address is visible, on purpose.** Both the draw email and the winners email put all
subscribers (plus you) in the `to` field — not `bcc` — so people can reply-all and chat with each
other about picks. That also means each subscriber can see everyone else's email address; if you'd
rather keep addresses private and lose reply-all, switch `to: [...]` back to `to: env.FROM_EMAIL` /
`bcc: emails` in `functions/api/send-email.js` and `functions/api/winners-check.js`.

There's no reliable way to auto-detect when a tournament actually releases its draw (no schedule
or feed for that), so sending stays a one-click action you fire whenever the draw is out.

## Bracket tab

Shows the live draw as columns per round (Round of 128 → ... → Final), pulled from the same free
ESPN feed the auto-results fetch already uses. Winners are highlighted; unplayed/live matches are
marked. Toggle between Men's and Women's, "⟳ Reload bracket" to refresh.

This required upgrading `functions/api/results.js`, which previously only returned each player's
*total* match-win count and threw away everything else. It now also keeps each individual match
(both players, the round, and the winner) grouped by round, exposed as a new `bracket: {atp, wta}`
field alongside the existing `players`/`seeds`/`matches` fields (unchanged, so nothing else that
reads this endpoint broke).

**What this isn't:** a pixel-perfect bracket with connecting lines between exact slot positions —
ESPN's feed doesn't reliably expose slot/seed positions, only round-by-round match results. What
you get instead is "columns of rounds, matches as cards, winners carried forward" — reads as a
bracket, doesn't require guessing at slot geometry.

**Extra scraper risk worth knowing:** round names (`roundLabel` in `functions/api/results.js`) are
read from several guessed field names since ESPN doesn't document this — if none match, a match
gets bucketed under "Unknown round" rather than dropped, so a labeling miss is visible instead of
silently losing data. Same "unverified feed" caveat as the rest of the scraper applies here, only
more so, since this now depends on more of ESPN's undocumented shape than the simple win-tally did.

## Pick-lock deadline + countdown

A real, structured deadline per event — separate from the free-text "Deadline" wording in the draw
email, which is just for phrasing (e.g. "10:59 AM PST tomorrow"). This one's an actual date/time,
drives a live countdown on the Make Picks tab, and locks picks the moment it passes — not just
whenever the tournament happens to start.

**It's kept in sync automatically — but only after you've sent the draw email.**
`functions/api/winners-check.js` — the same cron job that checks for tournament winners every few
hours — pulls the tournament's actual earliest scheduled match time from ESPN (`firstMatchAt`,
added to `functions/api/results.js`) and writes it in as the deadline. This only starts once
`functions/api/send-email.js` has recorded that the draw email actually went out for that event
(`email-sent:<event>` in `POOL_KV`) — the countdown shouldn't start ticking before anyone's been
told a deadline exists at all. Until you send that email, no deadline gets set automatically.

**Manual override still exists, and matters more than it might look like.** Join & Notify →
organizer panel → pick a date/time → **Pin manually**. A manual entry is never overwritten by
auto-sync until you hit **Clear**. This isn't just a nice-to-have:

> ⚠️ **Real uncertainty worth knowing about:** this assumes ESPN's scoreboard feed actually lists a
> tournament's matches *before* it starts. That's genuinely untested — ESPN's tennis endpoint is
> unofficial and undocumented, and it's entirely possible it only returns "today's" matches, in
> which case `firstMatchAt` wouldn't become available until the tournament's first day has already
> arrived — which defeats the purpose of a deadline that's supposed to lock picks *before* play
> begins. The sync now requests an explicit ~6-week window centered on today (rather than relying
> on ESPN's undocumented default) specifically to improve the odds of this working, but it's still
> worth checking once, right after a new draw is loaded: open Join & Notify and see whether a
> deadline appears within a few hours. If it never does, use **Pin manually** — it's the reliable
> fallback this whole feature was built to have.

**Storage format:** `deadline:<event>` in `POOL_KV` is now `{ value: ISOString, source: "auto" |
"manual", updatedAt }` — both `functions/api/deadline.js` and the pick-lock check in
`functions/api/kv.js` read this format (with a legacy plain-string fallback in case anything was
saved under the old format before this change).

**New/changed endpoints:**
- `functions/api/deadline.js` — `GET ?ek=<event>` is public (the countdown needs to read it
  without a password); `POST`/`DELETE` require the `x-admin-password` header, same pattern as
  `subscribers.js`. `POST` always sets `source: "manual"`.
- `functions/api/results.js` — now also returns `firstMatchAt`, the earliest scheduled match time
  found across both ATP and WTA for the filtered tournament.
- `functions/api/send-email.js` — now takes an `ek` field in the request body (sent automatically
  by the Join & Notify tab) and, on a successful send, records `email-sent:<event>` in `POOL_KV`.
  This is the gate that lets deadline auto-sync start.
- `functions/api/winners-check.js` — syncs the deadline every cron cycle (only for events with
  `email-sent:<event>` set), before checking for winners, so it applies before a tournament
  finishes, not just after.

**Two independent lock triggers, either one locks:** the existing "tournament has started" signal
(at least one live result recorded), OR this deadline having passed. If no deadline is ever set or
synced for an event, only the first trigger applies — nothing changes from before this feature
existed. Enforced both client-side (Make Picks tab disables itself) and server-side
(`functions/api/kv.js` rejects pick writes past either trigger).

**Also re-fixed in this pass:** `functions/api/results.js`'s `NAME_ALIASES` / fail-safe name
matching (the "Indian Wells shows wrong players" fix from earlier) — check your deployed site
still has this; it appears to have been dropped from the repo at some point after it was first
sent over. If Indian Wells or another event's bracket/results look wrong, this is almost certainly
why — see the note in `functions/api/results.js` itself.

## Picks stay anonymous — and locked — once the tournament starts

Nobody can see anyone else's picks on the Standings tab until results start coming in for that
event. Cells show a 🔒 instead of the player's name; totals stay at 0 for everyone in the
meantime. You can still see your own picks any time via "Load my picks" on the Make Picks tab —
this only affects what other entrants can see.

Picks are also **locked from further editing** at the same moment — the Make Picks tab disables
every selector and the save button once the tournament has started, so nobody can watch early
results and then go back and change a pick. This is enforced in two places:

- **Client-side**: the Make Picks tab disables the form once `started` is true.
- **Server-side**: `functions/api/kv.js` also rejects any write to a `picks:<event>:*` key once
  that event has a non-empty `results:<event>` entry — so someone calling the API directly (not
  through the UI) can't bypass the lock either.

**How "started" is detected:** `Object.keys(results).length > 0` for the current event — i.e. the
moment at least one match result has been recorded (via "Apply suggested" or the auto-fetch flow).
There's no explicit tournament-start date stored anywhere, so this piggybacks on the same results
data the rest of the app already tracks rather than adding a new field to keep in sync. The
practical effect: locking/reveal happens whenever the *first* result gets applied, which for most
people will be shortly after the first match finishes. One asymmetry worth knowing: the
server-side check only sees live KV results, not the historical `RESULTS_SEED` baked into the
frontend bundle — this only matters for old, already-finished events, where there's no realistic
scenario of someone trying to submit new picks anyway.

## Draw announcement: fully automatic, zero review

⚠️ **This sends an unreviewed email to your entire mailing list with no human in the loop.** Worth
reading this whole section once before it's live, since it's a meaningfully bigger leap than
everything else in this file.

**What it does:** every cron cycle, `functions/api/winners-check.js` checks whether ESPN shows a
tournament's draw as out (a scheduled first match exists — `firstMatchAt` from
`functions/api/results.js`). The moment that's true for an event nobody's been told about yet, it:

1. Builds the player roster using the exact same AI + web-search call "Load field from draw"
   already uses (`functions/api/anthropic.js`) — just triggered server-side instead of by someone
   opening the Make Picks tab.
2. Composes the draw-release email — tournament name and draw links are computable
   (`DRAW_LINKS`, duplicated from `src/App.jsx` — **keep both copies in sync manually**, there's no
   shared import between the two runtimes), the deadline is the tournament's real first-match time
   (no more "10:59 AM PST tomorrow" guessing), and the buy-in / rule-note / sign-off wording reuses
   whatever you used in your **most recent manual send** (persisted to `email-defaults` in
   `POOL_KV` by `functions/api/send-email.js` on every successful manual send).
3. Sends it. Nobody sees a preview first.

**Send at least one manual email before relying on this.** `email-defaults` doesn't exist until a
human send has happened once. Until then, an auto-sent email falls back to generic placeholder
wording for the buy-in line and omits the rule note entirely — not wrong, just not yours.

**Two independent, compounding sources of risk, both now unreviewed:**
- The AI-built roster could have a wrong name, a wrong seed, or an incomplete field — previously
  you'd likely notice this on the Make Picks tab before anyone relied on it; now it goes straight
  into an email.
- The ESPN "draw is out" detection is the same unofficial, undocumented feed flagged everywhere
  else in this file. A false read (or a naming mismatch like the Indian Wells one from earlier)
  means either an email fires on stale/wrong data, or doesn't fire at all and nobody notices until
  someone asks where the announcement is.

**Practical recommendation:** watch your inbox closely around the first few draws after turning
this on. If anything looks off, you still have full manual control — compose and send from Join &
Notify same as always — and can always email everyone a correction.

## Winners email: fully automatic, no button

When both a men's and women's tennis champion have been decided, two things happen automatically —
no one has to open the site or click anything:

- **The pool's own champions get recorded to the Record Books** — same shared `champions` ledger
  the site's "Record to Record Books" button writes to. If you'd already recorded it manually by
  the time this runs, your entry is left alone; this only fills it in if nobody has yet.
- **The mailing list gets an email** announcing who won each bracket of the pool — the pool
  participant with the highest Men's score and the one with the highest Women's score, using the
  exact same scoring and tiebreak order (Champion, Runner-up, Best Semi-Finalist, Dreamer, Long
  Shot, Dark Horse — compared only within one bracket) as the Standings tab. This can never
  disagree with what the site shows, because it's the same comparator, just re-implemented for the
  server since this function can't import from `src/App.jsx`.

Recording to the Record Books happens regardless of whether `RESEND_API_KEY`/`FROM_EMAIL` are set —
so even without email configured, results still get archived automatically. Each event is only
ever processed once (tracked via a `winners-sent:<event>` KV flag), so if email fails (e.g. Resend
isn't set up yet), it won't keep retrying that same event once it's already been recorded.

Note: this does **not** announce who won the real tournament — the men's/women's ATP/WTA champion
is only used internally as the "the tournament is actually over" signal to know when to fire.

**How it detects "the tournament is over":** `functions/api/winners-check.js` looks at every
tournament the pool has actually used this year (i.e. has a saved roster from "Load field from
draw"), pulls live results from the same ESPN scraper the site already uses
(`functions/api/results.js`), and checks whether a player from the men's roster and a player from
the women's roster has each reached 7 match wins — the number needed to win a 128-player draw.
The moment both are found, it scores every saved pick against those same live results to work out
the pool's own bracket winners, emails the list once with everything, and remembers it did (so it
won't send twice).

**Why there's a second, separate Worker (`/cron-worker`):** Cloudflare Pages Functions can't run
on a schedule — only standalone Workers can. So `cron-worker/worker.js` is a tiny, separate Worker
whose only job is to wake up periodically and ping `/api/winners-check` on your Pages site. It
holds no logic and no KV of its own.

**Keeping the two copies of the scoring rules in sync:** `functions/api/winners-check.js` can't
import from `src/App.jsx` (different runtime), so `CATEGORIES` and `UNCAPPED_EVENTS` are
duplicated at the top of that file with a comment marking them as such. If you ever change a cap,
a seed threshold, or add an uncapped event in `src/App.jsx`, update both.

**Setup:**

1. On the **Pages project**, add one more secret (alongside `RESEND_API_KEY`, `FROM_EMAIL`,
   `SEND_PASSWORD` from above):
   ```bash
   npx wrangler pages secret put CRON_SECRET
   ```
   (any random string — this stops strangers from pinging the endpoint and forcing a send.)

2. Deploy the cron worker as its own project:
   ```bash
   cd cron-worker
   npx wrangler login              # if you haven't already
   ```
   Edit `wrangler.toml` and replace `SITE_URL` with your actual Pages URL, then:
   ```bash
   npx wrangler deploy
   npx wrangler secret put CRON_SECRET   # same value as step 1, exactly
   ```
   By default it checks every 3 hours (`0 */3 * * *` in `wrangler.toml`) — adjust if you want
   faster turnaround during a tournament's final weekend.

**Honesty about the moving parts this depends on:**

- It relies on the **same unverified ESPN scraper** the rest of the app uses — see "Verifying the
  scraper" above. If ESPN changes its feed shape, this silently finds nothing rather than sending
  something wrong, but it also won't fire until you fix the parser.
- It only checks events with a saved **roster** for the current calendar year — if you never open
  "Make picks" for an event (which auto-loads the roster), this won't know that event exists.
  Visiting the Make picks tab once per tournament is enough; no other setup needed per event.
- Champion detection is "someone from the men's/women's roster reached 7 wins," matched by surname
  the same way the site matches your picks to results. Byes, retirements, or a walkover recorded
  oddly by ESPN could in theory throw this off — it's the same matching logic already trusted
  elsewhere in the app, not new risk, but still worth knowing about.
- This does **not** touch the Record Books — crowning champions there is still the separate manual
  "Record to Record Books" button. This only sends the email.

## Project layout

```
tennis-pool/
├─ index.html
├─ vite.config.js
├─ wrangler.toml
├─ src/
│  ├─ main.jsx          # mounts the app
│  └─ App.jsx           # the whole pool (your component)
├─ functions/
│  └─ api/
│     ├─ kv.js              # shared storage
│     ├─ results.js         # ESPN results scraper (free)
│     ├─ anthropic.js       # AI proxy (draw seeds + results fallback)
│     ├─ subscribe.js       # public mailing-list sign-up
│     ├─ subscribers.js     # admin: list/remove subscribers (password-protected)
│     ├─ send-email.js      # admin: send the draw-release email (password-protected)
│     └─ winners-check.js   # auto-detect champions + email the list (cron-secret protected)
└─ cron-worker/          # separate deployable Worker — see "Winners email" above
   ├─ worker.js
   └─ wrangler.toml
```

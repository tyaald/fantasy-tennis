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

There's no reliable way to auto-detect when a tournament actually releases its draw (no schedule
or feed for that), so sending stays a one-click action you fire whenever the draw is out.

## Project layout

```
tennis-pool/
├─ index.html
├─ vite.config.js
├─ wrangler.toml
├─ src/
│  ├─ main.jsx          # mounts the app
│  └─ App.jsx           # the whole pool (your component)
└─ functions/
   └─ api/
      ├─ kv.js           # shared storage
      ├─ results.js      # ESPN results scraper (free)
      ├─ anthropic.js    # AI proxy (draw seeds + results fallback)
      ├─ subscribe.js    # public mailing-list sign-up
      ├─ subscribers.js  # admin: list/remove subscribers (password-protected)
      └─ send-email.js   # admin: send the draw-release email (password-protected)
```

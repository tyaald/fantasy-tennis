# Tennis Pool — Cloudflare Pages

A fantasy tennis pool. React (Vite) front end, with two Cloudflare Pages Functions:

- `functions/api/kv.js` — shared storage for everyone's picks/results, backed by a **KV namespace**.
- `functions/api/anthropic.js` — a **key-protected proxy** to the Anthropic API, used by the
  "Auto-fetch results" and "Load field from draw" features.

The original app ran inside Claude and used Claude's built-in storage and API access. Those have
been swapped for the two functions above so it can run as a normal website.

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
      ├─ kv.js          # shared storage
      └─ anthropic.js   # AI proxy
```

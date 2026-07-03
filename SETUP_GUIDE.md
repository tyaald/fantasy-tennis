# Setup Guide — Tennis Pool on Cloudflare Pages

A start-to-finish walkthrough. No prior Cloudflare experience assumed. Budget ~30 minutes the first time.

When you're done you'll have: a public URL, everyone's picks saved in shared storage, results pulled
automatically from ESPN (free), and the seeded draw pulled by Claude.

---

## 0. Get these ready first

- A **Cloudflare account** (free): https://dash.cloudflare.com/sign-up
- A **GitHub account** (free) — used in the recommended path below.
- **Node.js 18 or newer** on your computer: https://nodejs.org (the LTS version is fine).
  Check with `node -v`.
- The project folder (unzip `tennis-pool-cloudflare.zip`).
- **Optional:** an **Anthropic API key** from https://console.anthropic.com → *API Keys*.
  You only need this for "Load field from draw" and the results fallback. The site runs without it;
  those two buttons just won't work until it's set.

> There are two ways to deploy. **Path A (GitHub)** is mostly clicking and auto-deploys whenever you
> make changes — recommended. **Path B (terminal)** is faster if you're comfortable with a command line.
> Do one or the other, then continue to "Test it."

---

## Path A — Deploy from GitHub (recommended)

### A1. Put the code on GitHub
1. Create a new **empty repository** on GitHub (e.g. `tennis-pool`).
2. Upload the project files (drag-and-drop in GitHub's "uploading an existing file", or use git):
   ```bash
   cd tennis-pool
   git init && git add . && git commit -m "tennis pool"
   git branch -M main
   git remote add origin https://github.com/<you>/tennis-pool.git
   git push -u origin main
   ```

### A2. Create the Pages project
1. In the Cloudflare dashboard, go to **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**.
2. Pick your `tennis-pool` repo.
3. Set the build configuration:
   - **Framework preset:** None (or "Vite" if offered)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Click **Save and Deploy**. The first build runs. It will succeed, but the storage and AI features
   won't work yet — that's the next two steps.

> **Deploy command.** If Cloudflare lets you leave it empty, do — it publishes `dist` for you.
> If it *requires* a deploy command, set it to (replace with your project's name):
> ```
> npx wrangler pages deploy dist --project-name=YOUR_PROJECT_NAME
> ```
> Do **not** use `npx wrangler deploy` (that's the Workers command and will fail on Pages), and do
> **not** add a `wrangler.toml` to the repo for this path. (The included `wrangler.toml.example` is
> only for the terminal path below.)

### A3. Create the KV namespace (shared storage)
1. In the dashboard go to **Storage & Databases** → **KV** (or **Workers & Pages** → **KV**).
2. Click **Create instance / Create namespace**, name it `tennis-pool-kv`, and create it.

### A4. Bind KV + add your API key, then redeploy
1. Go to **Workers & Pages** → your **tennis-pool** project → **Settings** → **Bindings** →
   **Add** → **KV namespace**.
   - **Variable name:** `POOL_KV`  ← must be exactly this
   - **KV namespace:** select `tennis-pool-kv`
   - Save.
2. Still in **Settings**, open **Variables and Secrets** → **Add**:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** your key
   - Choose **Secret / Encrypt**, then Save. *(Skip this if you're not using the AI features.)*
3. Go to **Deployments** → open the latest → **Retry deployment** (or push any change) so the new
   bindings take effect.

### A5. Open your site
Your URL is shown at the top of the project (like `https://tennis-pool.pages.dev`). Open it.
Jump to **"Test it"** below.

From now on, every `git push` to `main` redeploys automatically.

---

## Path B — Deploy from your terminal (Wrangler)

### B1. Install dependencies and log in
```bash
cd tennis-pool
mv wrangler.toml.example wrangler.toml   # CLI path needs this file
npm install
npx wrangler login          # opens a browser to authorize
```

### B2. Create the KV namespace and record its id
```bash
npx wrangler kv namespace create POOL_KV
```
Copy the `id` it prints, and paste it into **`wrangler.toml`**, replacing
`PUT_YOUR_KV_NAMESPACE_ID_HERE`.

### B3. Deploy
```bash
npm run deploy              # builds, then uploads to Pages
```
The first run may ask you to create/choose the project name — accept `tennis-pool`.

### B4. Add your Anthropic key (for the AI features)
```bash
npx wrangler pages secret put ANTHROPIC_API_KEY
# paste your key when prompted
```
The KV binding is already handled by `wrangler.toml`, so you're done. Re-run `npm run deploy` if you
added the secret after the first deploy.

---

## Test it

1. Open your site URL.
2. Go to **Make picks**, type a name, choose a few players, and switch tabs and back — your picks
   should still be there. Reload the page: still there. ✅ That confirms **KV storage** works.
   - If picks vanish on reload, KV isn't bound → recheck **A4 step 1** (variable name must be
     `POOL_KV`) and redeploy.
3. On **Make picks**, click **⟳ Load field from draw**. If players load, the **Anthropic key** works.
   - If you get an error, the key is missing or wrong → recheck the secret.
4. On **Standings**, click **⟳ Auto-fetch results** during (or after) a live tournament to confirm
   the ESPN scrape.

---

## After it's live

**Costs.** Storage and results are effectively free. The only paid piece is the Anthropic key, used
for the seeded draw (~15¢ once per event) and as a results fallback. For a private pool this is a few
dollars per Grand Slam at most.

**Turn auto-fetch down (optional).** Results auto-refresh on load, capped to once per 15 minutes for
the whole pool. To make it cheaper/quieter, in `src/App.jsx` change `AUTO_THROTTLE_MS` from
`15 * 60 * 1000` to e.g. `60 * 60 * 1000` (once an hour), or set the "Auto-check on load" toggle off.

**Verify the ESPN scraper.** ESPN's tennis JSON is unofficial — see the "Verifying the scraper"
section in `README.md` to confirm three field names against a live response. If it ever breaks, the
app falls back to Claude automatically.

**Make it private (optional).** The pool is open to anyone with the link. To gate it, add
**Cloudflare Access** (Zero Trust → Access → Applications) in front of the Pages project and allow
only specific emails.

**Update the site later.** Path A: push to GitHub and it redeploys. Path B: run `npm run deploy`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Picks don't persist on reload | KV not bound. Add binding `POOL_KV` (A4), then redeploy. |
| `/api/kv` returns 500 | Same as above — namespace not bound, or wrong variable name. |
| "Load field" / results error | `ANTHROPIC_API_KEY` missing or invalid; re-add it and redeploy. |
| Build fails on Cloudflare | Ensure build command `npm run build`, output `dist`. If a Node error, add an env var `NODE_VERSION` = `20`. |
| Deploy fails: "Workers-specific command in a Pages project" / `wrangler deploy` | Remove `wrangler.toml` from the repo. Set the **Deploy command** to `npx wrangler pages deploy dist --project-name=YOUR_PROJECT_NAME` (or clear it if allowed). Redeploy. |
| Deploy fails: `Project not found ... [code: 8000007]` | The target Pages project doesn't exist yet. Create it: `npx wrangler pages project create <NAME> --production-branch=main` (or dashboard → Pages → Upload assets → name it), then set its bindings and retry. |
| Simplest of all | Skip the deploy-command/token entirely: connect the repo via **Pages → Connect to Git** instead of Workers. No deploy command, no token, auto-creates the project. |
| Results button finds nothing | Normal outside a live/recent event, or ESPN field names changed — see scraper verification in `README.md`. |

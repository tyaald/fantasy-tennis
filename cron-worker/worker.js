// A separate, tiny Cloudflare Worker. Cloudflare Pages Functions don't support
// Cron Triggers directly — only standalone Workers do — so this exists purely to
// wake up on a schedule and ping the real logic living in the Pages project at
// /api/winners-check. It holds no app logic and no KV binding of its own.
//
// Deploy from inside this folder:
//   npx wrangler deploy
//   npx wrangler secret put CRON_SECRET     # must match the same value set on the Pages project
//
// Then set SITE_URL below (or as a var in wrangler.toml) to your deployed Pages URL.

export default {
  async scheduled(controller, env, ctx) {
    const res = await fetch(`${env.SITE_URL}/api/winners-check`, {
      method: "POST",
      headers: { "x-cron-secret": env.CRON_SECRET },
    });
    console.log("winners-check ping:", res.status, await res.text());
  },

  // Lets you trigger it manually by visiting the worker's URL, handy for testing.
  async fetch(request, env, ctx) {
    const res = await fetch(`${env.SITE_URL}/api/winners-check`, {
      method: "POST",
      headers: { "x-cron-secret": env.CRON_SECRET },
    });
    return new Response(await res.text(), { status: res.status });
  },
};

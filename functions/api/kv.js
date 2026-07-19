// Cloudflare Pages Function: shared key/value storage backed by a KV namespace.
// Bind a KV namespace named POOL_KV in your Pages project (see README).
// Routes: GET /api/kv?key=...  |  GET /api/kv?prefix=...  |  PUT /api/kv  |  DELETE /api/kv?key=...

const J = { "Content-Type": "application/json" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: J });

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.POOL_KV;
  if (!kv) return json({ error: "POOL_KV namespace is not bound" }, 500);

  const url = new URL(request.url);
  const method = request.method;

  try {
    if (method === "GET") {
      const prefix = url.searchParams.get("prefix");
      if (prefix != null) {
        const out = [];
        let cursor;
        // page through results so prefixes with >1000 keys still work
        do {
          const list = await kv.list({ prefix, cursor });
          out.push(...list.keys.map((k) => k.name));
          cursor = list.list_complete ? undefined : list.cursor;
        } while (cursor);
        return json({ keys: out });
      }
      const key = url.searchParams.get("key");
      if (!key) return json({ error: "missing key" }, 400);
      const value = await kv.get(key);
      return json({ value }); // string or null
    }

    if (method === "PUT") {
      const { key, value } = await request.json();
      if (!key) return json({ error: "missing key" }, 400);

      // Belt-and-suspenders: the UI disables pick editing once the tournament has
      // started OR the announced deadline has passed, but that's client-side
      // only. Reject the write here too, so someone calling this API directly
      // can't bypass the lock. Two independent triggers, either one locks:
      //   1. "Started" — at least one live result recorded for this event.
      //      Note this only sees live KV results, not the historical
      //      RESULTS_SEED baked into the frontend bundle, which only matters
      //      for old/already-finished events.
      //   2. "Deadline passed" — an explicit deadline was set via the Join &
      //      Notify tab (functions/api/deadline.js) and that time has passed.
      //      Optional: if no deadline was ever set for this event, this check
      //      simply doesn't apply and trigger #1 is the only one that matters.
      const picksMatch = key.match(/^picks:([^:]+):/);
      if (picksMatch) {
        const ek = picksMatch[1];

        const resultsRaw = await kv.get(`results:${ek}`);
        if (resultsRaw) {
          try {
            const parsed = JSON.parse(resultsRaw);
            if (parsed && Object.keys(parsed).length > 0) {
              return json({ error: "Picks are locked — this tournament has started." }, 403);
            }
          } catch { /* malformed stored value — fail open, don't block on a parse error */ }
        }

        const deadlineRaw = await kv.get(`deadline:${ek}`);
        if (deadlineRaw) {
          // deadline.js stores { value, source, updatedAt } as of this version;
          // fall back to treating the raw value as a plain ISO string in case
          // anything was written before that format existed.
          let deadlineMs = NaN;
          try {
            const parsed = JSON.parse(deadlineRaw);
            deadlineMs = new Date(parsed?.value).getTime();
          } catch {
            deadlineMs = new Date(deadlineRaw).getTime();
          }
          if (!Number.isNaN(deadlineMs) && Date.now() >= deadlineMs) {
            return json({ error: "Picks are locked — the deadline has passed." }, 403);
          }
        }
      }

      await kv.put(key, value == null ? "" : String(value));
      return json({ ok: true });
    }

    if (method === "DELETE") {
      const key = url.searchParams.get("key");
      if (!key) return json({ error: "missing key" }, 400);
      await kv.delete(key);
      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    return json({ error: String(e && e.message ? e.message : e) }, 500);
  }
}

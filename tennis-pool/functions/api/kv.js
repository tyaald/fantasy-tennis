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

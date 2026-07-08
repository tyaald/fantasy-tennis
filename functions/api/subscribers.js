// Cloudflare Pages Function: admin view of the mailing list (list + remove).
// Protected by SEND_PASSWORD (same secret used to send the draw email), passed
// in the "x-admin-password" header. Uses the shared POOL_KV namespace.

const J = { "Content-Type": "application/json" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: J });

function authed(request, env) {
  const password = request.headers.get("x-admin-password");
  return !!env.SEND_PASSWORD && password === env.SEND_PASSWORD;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!authed(request, env)) return json({ error: "Wrong password." }, 401);
  const kv = env.POOL_KV;
  if (!kv) return json({ error: "POOL_KV namespace is not bound" }, 500);

  const out = [];
  let cursor;
  do {
    const list = await kv.list({ prefix: "subscriber:", cursor });
    for (const k of list.keys) {
      const raw = await kv.get(k.name);
      if (raw) { try { out.push(JSON.parse(raw)); } catch { /* skip bad entry */ } }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  out.sort((a, b) => a.name.localeCompare(b.name));
  return json({ subscribers: out });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!authed(request, env)) return json({ error: "Wrong password." }, 401);
  const kv = env.POOL_KV;
  if (!kv) return json({ error: "POOL_KV namespace is not bound" }, 500);

  const url = new URL(request.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  if (!email) return json({ error: "Missing email." }, 400);

  await kv.delete(`subscriber:${email}`);
  return json({ ok: true });
}

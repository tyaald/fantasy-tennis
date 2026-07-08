// Cloudflare Pages Function: add a subscriber to the mailing list.
// Uses the same POOL_KV namespace as the rest of the app (key prefix "subscriber:").

const J = { "Content-Type": "application/json" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: J });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.POOL_KV;
  if (!kv) return json({ error: "POOL_KV namespace is not bound" }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400); }

  // honeypot: real people never fill this hidden field
  if (body.company) return json({ ok: true });

  const name = String(body.name || "").trim().slice(0, 100);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 200);

  if (!name) return json({ error: "Name is required." }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "That email doesn't look valid." }, 400);

  await kv.put(`subscriber:${email}`, JSON.stringify({ name, email, joinedAt: Date.now() }));
  return json({ ok: true });
}

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }
  return onRequestPost(context);
}

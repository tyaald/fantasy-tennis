// Cloudflare Pages Function: the pool's actual, structured pick-lock deadline
// per event — separate from the free-text wording in the draw email.
//
// Storage format: deadline:<event> = JSON { value: ISOString, source: "auto"|"manual", updatedAt }
//   - "auto"   — kept in sync automatically by functions/api/winners-check.js
//                with the tournament's actual first scheduled match time.
//   - "manual" — someone explicitly set it via the Join & Notify admin panel;
//                the auto-sync will never overwrite a manual entry. Use DELETE
//                to un-pin it and let auto-sync take over again.
//
// Reading is public (the countdown needs it, no login involved); setting or
// clearing requires the same SEND_PASSWORD used elsewhere in Join & Notify.

const J = { "Content-Type": "application/json" };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: J });

function authed(request, env) {
  const password = request.headers.get("x-admin-password");
  return !!env.SEND_PASSWORD && password === env.SEND_PASSWORD;
}

// Accepts both the current object format and a legacy plain-ISO-string value
// (in case anything was saved before this format existed), so nothing breaks.
function parseDeadline(raw) {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && obj.value) return obj;
  } catch { /* not JSON — fall through to legacy plain-string handling */ }
  const t = new Date(raw).getTime();
  if (!Number.isNaN(t)) return { value: new Date(raw).toISOString(), source: "manual", updatedAt: null };
  return null;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const kv = env.POOL_KV;
  if (!kv) return json({ error: "POOL_KV not bound" }, 500);

  const ek = new URL(request.url).searchParams.get("ek");
  if (!ek) return json({ error: "missing ek" }, 400);

  const parsed = parseDeadline(await kv.get(`deadline:${ek}`));
  return json({ ek, deadline: parsed?.value || null, source: parsed?.source || null });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!authed(request, env)) return json({ error: "Wrong password." }, 401);
  const kv = env.POOL_KV;
  if (!kv) return json({ error: "POOL_KV not bound" }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const { ek, deadline } = body;
  if (!ek) return json({ error: "missing ek" }, 400);
  if (!deadline || Number.isNaN(new Date(deadline).getTime())) {
    return json({ error: "deadline must be a valid date/time" }, 400);
  }

  // Setting one manually here always pins it — auto-sync (winners-check.js)
  // will leave it alone until it's cleared.
  const value = new Date(deadline).toISOString();
  await kv.put(`deadline:${ek}`, JSON.stringify({ value, source: "manual", updatedAt: Date.now() }));
  return json({ ok: true, ek, deadline: value, source: "manual" });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!authed(request, env)) return json({ error: "Wrong password." }, 401);
  const kv = env.POOL_KV;
  if (!kv) return json({ error: "POOL_KV not bound" }, 500);

  const ek = new URL(request.url).searchParams.get("ek");
  if (!ek) return json({ error: "missing ek" }, 400);

  await kv.delete(`deadline:${ek}`);
  return json({ ok: true });
}

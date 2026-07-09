// Cloudflare Pages Function: send the "draw is out" email to everyone on the mailing list.
// Requires three secrets set in the Pages project (see README): RESEND_API_KEY, FROM_EMAIL,
// SEND_PASSWORD. Recipients come from the shared POOL_KV namespace (key prefix "subscriber:").

const J = { "Content-Type": "application/json" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: J });

async function getSubscriberEmails(kv) {
  const emails = [];
  let cursor;
  do {
    const list = await kv.list({ prefix: "subscriber:", cursor });
    for (const k of list.keys) {
      const raw = await kv.get(k.name);
      if (!raw) continue;
      try {
        const p = JSON.parse(raw);
        if (p.email) emails.push(p.email);
      } catch { /* skip bad entry */ }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  return [...new Set(emails.map((e) => e.toLowerCase()))];
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid JSON body" }, 400); }

  if (!env.SEND_PASSWORD || body.password !== env.SEND_PASSWORD) {
    return json({ error: "Wrong password." }, 401);
  }
  if (!env.RESEND_API_KEY) return json({ error: "RESEND_API_KEY is not set" }, 500);
  if (!env.FROM_EMAIL) return json({ error: "FROM_EMAIL is not set" }, 500);

  const kv = env.POOL_KV;
  if (!kv) return json({ error: "POOL_KV namespace is not bound" }, 500);

  const emails = await getSubscriberEmails(kv);
  if (!emails.length) {
    return json({ error: "No subscribers yet — share the Join & Notify tab first." }, 400);
  }
  if (!body.html) return json({ error: "Missing email content." }, 400);

  const subject = `Picks are open: ${body.tournament || "the next event"}`;

  const upstream = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [...new Set([env.FROM_EMAIL, ...emails])],   // everyone's visible, reply-all works
      subject,
      html: body.html,
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    return json({ error: `Resend error: ${detail}` }, 502);
  }

  return json({ ok: true, count: emails.length });
}

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json({ error: "POST only" }, 405);
  }
  return onRequestPost(context);
}

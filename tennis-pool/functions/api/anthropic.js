// Cloudflare Pages Function: proxy to the Anthropic Messages API.
// Keeps your ANTHROPIC_API_KEY on the server (never in the browser).
// Set ANTHROPIC_API_KEY as a secret in your Pages project (see README).

const J = { "Content-Type": "application/json" };

export async function onRequestPost(context) {
  const { request, env } = context;
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is not set" }), { status: 500, headers: J });

  let body;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON body" }), { status: 400, headers: J }); }

  // Optional safety: cap output size so a runaway request can't rack up cost.
  if (typeof body.max_tokens !== "number" || body.max_tokens > 2000) body.max_tokens = 1000;

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  // pass the response straight back through
  const text = await upstream.text();
  return new Response(text, { status: upstream.status, headers: J });
}

// Reject other methods cleanly
export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: J });
  }
  return onRequestPost(context);
}

/**
 * UE-Blog custom Worker entry point.
 *
 * Handles /api/comments, /api/likes, /api/moderate/delete directly (backed
 * by the D1 database bound as `DB`), and falls back to serving the static
 * blog files (env.ASSETS) for every other request.
 *
 * This deploys as part of the normal blog build (same repo, same
 * `npx wrangler deploy`) — no separate Worker to create, no separate
 * dashboard code editor needed. Just bind a D1 database as `DB` and add
 * an `ADMIN_TOKEN` secret in this project's Settings -> Bindings /
 * Variables, same as any other setting.
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function badRequest(message) {
  return json({ error: message }, 400);
}

function looksLikeSpam(name, comment, website) {
  if (website && website.trim() !== "") return true; // honeypot — real users never fill this
  if (name.length < 1 || name.length > 60) return true;
  if (comment.length < 1 || comment.length > 1000) return true;
  const linkCount = (comment.match(/https?:\/\//gi) || []).length;
  if (linkCount > 2) return true;
  return false;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function handleApi(request, env, url) {
  const { pathname } = url;

  // ---- GET /api/comments?slug=X ----
  if (pathname === "/api/comments" && request.method === "GET") {
    const slug = url.searchParams.get("slug");
    if (!slug) return badRequest("Missing slug");
    const { results } = await env.DB.prepare(
      "SELECT id, name, comment, created_at FROM comments WHERE post_slug = ? ORDER BY created_at DESC"
    )
      .bind(slug)
      .all();
    return json({ comments: results });
  }

  // ---- POST /api/comments ----
  if (pathname === "/api/comments" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body) return badRequest("Invalid JSON");
    const { slug, name, comment, website } = body;
    if (!slug || !name || !comment) return badRequest("Missing fields");

    if (looksLikeSpam(name, comment, website || "")) {
      return json({ ok: true }); // pretend success, don't store it
    }

    const safeName = escapeHtml(name.trim());
    const safeComment = escapeHtml(comment.trim());

    const result = await env.DB.prepare(
      "INSERT INTO comments (post_slug, name, comment) VALUES (?, ?, ?) RETURNING id, name, comment, created_at"
    )
      .bind(slug, safeName, safeComment)
      .first();

    return json({ ok: true, comment: result });
  }

  // ---- POST /api/moderate/delete ----
  if (pathname === "/api/moderate/delete" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body) return badRequest("Invalid JSON");
    const { id, token } = body;
    if (token !== env.ADMIN_TOKEN) return json({ error: "Unauthorized" }, 401);
    if (!id) return badRequest("Missing id");
    await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  // ---- GET /api/likes?slug=X ----
  if (pathname === "/api/likes" && request.method === "GET") {
    const slug = url.searchParams.get("slug");
    if (!slug) return badRequest("Missing slug");
    const row = await env.DB.prepare("SELECT count FROM likes WHERE post_slug = ?")
      .bind(slug)
      .first();
    return json({ slug, count: row ? row.count : 0 });
  }

  // ---- POST /api/likes ----
  if (pathname === "/api/likes" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || !body.slug) return badRequest("Missing slug");
    const { slug } = body;
    await env.DB.prepare(
      `INSERT INTO likes (post_slug, count) VALUES (?, 1)
       ON CONFLICT(post_slug) DO UPDATE SET count = count + 1`
    )
      .bind(slug)
      .run();
    const row = await env.DB.prepare("SELECT count FROM likes WHERE post_slug = ?")
      .bind(slug)
      .first();
    return json({ slug, count: row.count });
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        return json({ error: "Server error", details: String(err) }, 500);
      }
    }

    // Everything else: serve the static blog exactly as before
    return env.ASSETS.fetch(request);
  },
};

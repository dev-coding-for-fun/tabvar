const TOPO_INDEX = "https://app.tabvar.org/topos";

export function getLegacyTopoResponse(request: Request): Response | undefined {
  const url = new URL(request.url);
  if (url.hostname !== "topos.tabvar.org") return undefined;

  if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
    return Response.redirect(TOPO_INDEX, 301);
  }

  const page = `<!doctype html><html lang="en">
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Page retired | TABVAR</title>
    <h1>This page has been retired</h1>
    <p>The old TABVAR topo site has closed. This page or file is no longer available.</p>
    <p><a href="${TOPO_INDEX}">Browse current topos</a></p>
  </html>`;
  return new Response(request.method === "HEAD" ? null : page, {
    status: 410,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

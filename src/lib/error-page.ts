/**
 * Self-contained HTML fallback served when SSR fails catastrophically.
 * Must NOT import any app code — the same module-init failure that
 * triggered the wrapper could also break the error page.
 */
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>BAYCMC — Something went wrong</title>
<style>
  :root { color-scheme: dark; }
  html,body { margin:0; padding:0; height:100%; background:#0a0a0a; color:#f5f5f4;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .wrap { min-height:100%; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { max-width:420px; text-align:center; }
  h1 { font-size:1.5rem; margin:0 0 .5rem; background:linear-gradient(135deg,#d4af37,#f6c75c);
    -webkit-background-clip:text; background-clip:text; color:transparent; }
  p { color:#a3a3a3; font-size:.95rem; line-height:1.5; margin:0 0 1.5rem; }
  .actions { display:flex; gap:.75rem; justify-content:center; flex-wrap:wrap; }
  button, a.btn { font:inherit; padding:.6rem 1.1rem; border-radius:.5rem; cursor:pointer;
    border:1px solid #2a2a2a; background:#171717; color:#f5f5f4; text-decoration:none; }
  button.primary { background:linear-gradient(135deg,#d4af37,#b8902c); color:#0a0a0a; border:0; font-weight:600; }
</style>
</head>
<body>
<div class="wrap"><div class="card">
  <h1>Something went wrong</h1>
  <p>The clubhouse hit a snag loading this page. Refresh to try again, or head back to the lobby.</p>
  <div class="actions">
    <button class="primary" onclick="location.reload()">Refresh</button>
    <a class="btn" href="/">Go home</a>
  </div>
</div></div>
</body></html>`;
}

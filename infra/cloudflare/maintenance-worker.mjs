const MAINTENANCE_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#fffaf3">
<title>Sirevya — mantenimiento temporal</title>
<style>
:root{color-scheme:light;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#302b27;background:#fffaf3}
*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px}
main{width:min(100%,560px);padding:clamp(28px,7vw,56px);text-align:center;background:#fff;border:1px solid #e7d7b5;border-radius:24px;box-shadow:0 18px 50px rgba(74,48,18,.08)}
h1{margin:0 0 14px;color:#785410;font-family:Georgia,serif;font-size:clamp(30px,7vw,44px);font-weight:500}
p{margin:0;color:#55504b;font-size:16px;line-height:1.65}
</style>
</head>
<body><main><h1>Sirevya está en mantenimiento</h1><p>Estamos realizando mejoras para atenderte mejor. Disculpa la interrupción y vuelve a visitarnos pronto.</p></main></body>
</html>`;

function maintenanceEnabled(value) {
  return ["1", "true", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function retryAfterSeconds(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) ? Math.max(60, Math.min(86400, parsed)) : 3600;
}

export function createMaintenanceWorker({ fetcher = fetch } = {}) {
  return {
    async fetch(request, env = {}) {
      const url = new URL(request.url);
      if (url.pathname.toLowerCase() === "/robots.txt") return fetcher(request);
      if (!maintenanceEnabled(env.MAINTENANCE_MODE)) return fetcher(request);

      return new Response(request.method.toUpperCase() === "HEAD" ? null : MAINTENANCE_HTML, {
        status: 503,
        statusText: "Service Unavailable",
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Content-Type": "text/html; charset=utf-8",
          "Retry-After": String(retryAfterSeconds(env.RETRY_AFTER_SECONDS)),
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  };
}

export default createMaintenanceWorker();

import assert from "node:assert/strict";
import { createMaintenanceWorker } from "../../infra/cloudflare/maintenance-worker.mjs";

const originCalls = [];
const worker = createMaintenanceWorker({
  fetcher: async (request) => {
    originCalls.push({ url: request.url, method: request.method });
    return new Response("origin-served", { status: 200, headers: { "Content-Type": "text/plain" } });
  },
});

const off = await worker.fetch(new Request("https://sirevya.com.co/catalogo?x=1"), { MAINTENANCE_MODE: "off" });
assert.equal(off.status, 200);
assert.equal(await off.text(), "origin-served");
assert.equal(originCalls.length, 1, "Modo apagado usa el origen existente.");
assert.equal(originCalls[0].url, "https://sirevya.com.co/catalogo?x=1", "El Worker no cambia el dominio ni la ruta.");

const on = await worker.fetch(new Request("https://sirevya.com.co/"), {
  MAINTENANCE_MODE: "true",
  RETRY_AFTER_SECONDS: "1800",
});
assert.equal(on.status, 503, "Mantenimiento devuelve un 503 HTTP real.");
assert.equal(on.headers.get("retry-after"), "1800");
assert.equal(on.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
assert.match(await on.text(), /Sirevya está en mantenimiento/);
assert.equal(originCalls.length, 1, "El 503 no consulta ni altera el origen.");

const robots = await worker.fetch(new Request("https://sirevya.com.co/robots.txt?check=1"), { MAINTENANCE_MODE: "on" });
assert.equal(robots.status, 200, "robots.txt sigue disponible durante el mantenimiento.");
assert.equal(await robots.text(), "origin-served");
assert.equal(originCalls.at(-1).url, "https://sirevya.com.co/robots.txt?check=1");

const head = await worker.fetch(new Request("https://sirevya.com.co/admin.html", { method: "HEAD" }), {
  MAINTENANCE_MODE: "1",
  RETRY_AFTER_SECONDS: "10",
});
assert.equal(head.status, 503);
assert.equal(head.headers.get("retry-after"), "60", "Retry-After se limita a un mínimo seguro.");
assert.equal(await head.text(), "", "HEAD no devuelve cuerpo.");

const invalidMode = await worker.fetch(new Request("https://sirevya.com.co/"), { MAINTENANCE_MODE: "enabled" });
assert.equal(invalidMode.status, 200, "Los valores ambiguos no activan el cierre.");
assert.equal(originCalls.length, 3);

console.log("maintenance_worker_regression: PASS (503 real, pass-through y robots.txt intacto)");

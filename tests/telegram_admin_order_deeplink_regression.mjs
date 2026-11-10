import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const adminHtml = fs.readFileSync(new URL("../admin.html", import.meta.url), "utf8");
const start = adminHtml.indexOf("function consumeTelegramWebOrderDeepLink(){");
const end = adminHtml.indexOf("\nfunction setDateText()", start);
assert.ok(start >= 0 && end > start, "debe existir la función de deep-link antes del render del admin");
const functionSource = adminHtml.slice(start, end);
const orderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function runDeepLink(href) {
  const calls = { search: { value: "" }, history: [], navigation: [] };
  const ctx = vm.createContext({
    URL,
    window: {
      location: { href },
      history: {
        state: { source: "telegram" },
        replaceState(state, title, nextUrl) { calls.history.push({ state, title, nextUrl }); },
      },
    },
    document: {
      title: "Admin",
      querySelector(selector) { calls.navSelector = selector; return { selector }; },
    },
    isValidWebOrderId(value) {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
    },
    $(id) { return id === "buscarPedido" ? calls.search : null; },
    show(id, button) { calls.navigation.push({ id, button }); },
    pedidosPage: 7,
  });
  vm.runInContext(`${functionSource}\nglobalThis.result = consumeTelegramWebOrderDeepLink();`, ctx);
  return { calls, result: ctx.result, page: ctx.pedidosPage };
}

const valid = runDeepLink(`https://sirevya.com.co/admin.html?web_order=${orderId}&source=telegram`);
assert.equal(valid.result, true);
assert.equal(valid.calls.search.value, orderId);
assert.equal(valid.page, 1);
assert.equal(valid.calls.navigation.length, 1);
assert.equal(valid.calls.navigation[0].id, "pedidos");
assert.equal(valid.calls.navSelector, '.navbtn[data-view="pedidos"]');
assert.equal(valid.calls.history.length, 1);
assert.equal(valid.calls.history[0].nextUrl, "/admin.html?source=telegram");

const wrongOrigin = runDeepLink(`https://evil.example/admin.html?web_order=${orderId}`);
assert.equal(wrongOrigin.result, false);
assert.equal(wrongOrigin.calls.navigation.length, 0);
assert.equal(wrongOrigin.calls.history.length, 0);

const invalidId = runDeepLink("https://sirevya.com.co/admin.html?web_order=not-a-uuid");
assert.equal(invalidId.result, false);
assert.equal(invalidId.calls.navigation.length, 0);
assert.equal(invalidId.calls.history.length, 0);

console.log("telegram_admin_order_deeplink_regression: PASS");

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../supabase/functions/wompi-create-checkout/index.ts', import.meta.url), 'utf8');

const payStart = html.indexOf('async function payWithWompi(');
const payEnd = html.indexOf('\nlet contraEntregaInProgress=', payStart);
assert.ok(payStart >= 0 && payEnd > payStart, 'payWithWompi source must be present');
const pay = html.slice(payStart, payEnd);

const guardIndex = pay.indexOf('window.__sirevyaWompiInProgress=true');
const firstAwaitIndex = pay.indexOf('await ');
assert.ok(guardIndex >= 0 && guardIndex < firstAwaitIndex, 'the duplicate-submit guard must be set before any await');
assert.match(pay, /normalizeCheckoutQuote\(confirmedQuote\)/, 'Wompi must use the quote snapshot already confirmed by checkout');
const quoteRetryIndex = pay.indexOf('await requestCheckoutQuote(');
const edgeFetchIndex = pay.indexOf('response=await checkoutFetchWithTimeout(');
assert.ok(quoteRetryIndex > edgeFetchIndex && edgeFetchIndex >= 0, 'a read-only quote refresh is allowed only after the Edge request fails');
assert.equal([...pay.matchAll(/await\s+requestCheckoutQuote\(/g)].length, 1, 'the normal path must not issue a second client quote');
assert.match(pay, /confirmedQuoteFingerprint!==getCheckoutQuoteFingerprint\(/, 'changed cart/city/coupon data must abort before the Edge request');
assert.match(pay, /let authoritativeServerQuote=normalizeCheckoutQuote\(data\.quote\)/);
assert.match(pay, /if\(!quoteHasValidTotals\(authoritativeServerQuote,!!couponCode\)\)\{\s*try\{authoritativeServerQuote=await requestCheckoutQuote\(couponCode,checkoutItems\)\}catch\{\}/,
  'the deployed v41 409 contract must fall back to a fresh read-only quote');
assert.match(pay, /quoteHasValidTotals\(authoritativeServerQuote,!!couponCode\)/, 'a server-detected change must be validated before updating the display');
assert.match(pay, /setCheckoutServerQuote\(authoritativeServerQuote,checkoutItems\)/, 'a changed no-coupon quote must replace stale cached totals');
assert.match(pay, /setCheckoutCouponQuote\(authoritativeServerQuote,true\)/, 'a changed coupon quote must be displayed and await another confirmation');
assert.match(pay, /Desglose vigente: subtotal/,'a real quote change must show the complete current breakdown before retry');

const confirmStart = html.indexOf('async function confirmCheckout(){');
const confirmEnd = html.indexOf("\ndocument.addEventListener('keydown'", confirmStart);
assert.ok(confirmStart >= 0 && confirmEnd > confirmStart, 'confirmCheckout source must be present');
const confirm = html.slice(confirmStart, confirmEnd);
assert.match(confirm, /const confirmationFingerprint=getCheckoutQuoteFingerprint\(checkoutItems,couponCode\)/);
assert.match(confirm, /cartQuote=await requestCheckoutQuote\(couponCode,checkoutItems\)/);
assert.match(confirm, /payWithWompi\(payload,cartQuote,confirmationFingerprint\)/, 'the same quote and input snapshot must reach Wompi preparation');
assert.ok(confirm.indexOf('cartQuote=await requestCheckoutQuote') < confirm.indexOf('payWithWompi(payload,cartQuote,confirmationFingerprint)'));

assert.match(edge, /expectedTotal !== totalCop \|\| expectedDiscountTotal !== discountTotal \|\| expectedCouponDiscountTotal !== couponDiscountTotal/,
  'the server must keep validating client totals against its own authoritative quote');
assert.match(edge, /code: "WOMPI_QUOTE_CHANGED"/, 'the server must continue rejecting stale expected totals');
assert.match(edge, /prepare_storefront_wompi_checkout/, 'the atomic pricing/inventory guard must remain in the flow');

console.log('PASS Wompi frontend quote snapshot regression: one confirmed quote, synchronous duplicate guard, updated breakdown via read-only 409 fallback, server and atomic revalidation preserved.');

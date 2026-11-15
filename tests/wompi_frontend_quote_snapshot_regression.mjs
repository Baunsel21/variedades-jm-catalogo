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
assert.match(pay, /normalizeCheckoutQuote\(cloneCheckoutSnapshotValue\(snapshot\.quote\)\)/, 'Wompi must use the immutable quote snapshot already confirmed by checkout');
assert.match(pay, /const payload=cloneCheckoutSnapshotValue\(snapshot\.payload\)/, 'the payment payload must be derived only from the confirmed snapshot');
const settingRefreshIndex = pay.indexOf('await refreshOnlinePaymentSetting');
const postRefreshBlock = pay.slice(settingRefreshIndex, pay.indexOf('response=await checkoutFetchWithTimeout'));
assert.ok(settingRefreshIndex > 0, 'the current payment setting is still refreshed before invoking the Edge Function');
assert.doesNotMatch(postRefreshBlock, /getCheckoutItems\(|getCheckoutQuoteFingerprint\(|buildOrderPayload\(|\$\('(customerName|customerPhone|customerEmail|customerCity|customerAddress|customerNeighborhood|couponCode)'\)/,
  'after the asynchronous settings refresh, the request must not reconstruct data from mutable form controls');
assert.match(pay, /hasActiveWompiSnapshotChanges\(snapshot\)/, 'real user edits during async preparation must cancel before the Edge request');
const quoteRetryIndex = pay.indexOf('await requestCheckoutQuote(');
const edgeFetchIndex = pay.indexOf('response=await checkoutFetchWithTimeout(');
assert.ok(quoteRetryIndex > edgeFetchIndex && edgeFetchIndex >= 0, 'a read-only quote refresh is allowed only after the Edge request fails');
assert.equal([...pay.matchAll(/await\s+requestCheckoutQuote\(/g)].length, 1, 'the normal path must not issue a second client quote');
assert.match(pay, /let authoritativeServerQuote=normalizeCheckoutQuote\(data\.quote\)/);
assert.match(pay, /if\(!quoteHasValidTotals\(authoritativeServerQuote,!!couponCode\)\)\{\s*try\{authoritativeServerQuote=await requestCheckoutQuote\(couponCode,checkoutItems,snapshot\.payload\.city\)\}catch\{\}/,
  'the deployed 409 contract must fall back to a read-only quote with the confirmed city and items');
assert.match(pay, /quoteHasValidTotals\(authoritativeServerQuote,!!couponCode\)/, 'a server-detected change must be validated before updating the display');
assert.match(pay, /setCheckoutServerQuote\(authoritativeServerQuote,checkoutItems\)/, 'a changed no-coupon quote must replace stale cached totals');
assert.match(pay, /setCheckoutCouponQuote\(authoritativeServerQuote,true\)/, 'a changed coupon quote must be displayed and await another confirmation');
assert.match(pay, /Desglose vigente: subtotal/,'a real quote change must show the complete current breakdown before retry');
assert.match(html, /let wompiNewOrderConfirmationFingerprint='',wompiNewOrderConfirmationReference=''/,
  'the separate-order consent must live only in page memory');
assert.match(html, /getWompiOrderSnapshotFingerprint\(payload,authoritativeComboQuote,checkoutItems\)/,
  'consent must be bound to the exact buyer, cart, delivery and price snapshot');
assert.match(pay, /data\?\.code==='WOMPI_NEW_ORDER_CONFIRMATION_REQUIRED'/,
  'a terminal-order mismatch must return to the customer without starting payment');
assert.match(pay, /payload\.confirm_new_order_after_terminal_mismatch=true/);
assert.match(pay, /payload\.supersedes_reference=supersededOrderReference/);
assert.match(pay, /reservationReference=generateReservationReference\(\);\s*saveReservationDraft\(reservationReference,checkoutItems\)/,
  'the second confirmation must persist one fresh client reference before the request for idempotent retries');
assert.match(pay, /data\.newOrderAfterTerminalMismatch!==true/,
  'the browser must not redirect unless the server confirms the separately verified order path');
assert.match(edge, /snapshotMismatchFields\(existing/);
assert.match(edge, /verifyTerminalOrderHistory\(/,
  'the server must verify all historical attempts before reusing or superseding a terminal order');
assert.match(edge, /WOMPI_NEW_ORDER_CONFIRMATION_REQUIRED/);

const confirmStart = html.indexOf('async function confirmCheckout(){');
const confirmEnd = html.indexOf("\ndocument.addEventListener('keydown'", confirmStart);
assert.ok(confirmStart >= 0 && confirmEnd > confirmStart, 'confirmCheckout source must be present');
const confirm = html.slice(confirmStart, confirmEnd);
assert.match(confirm, /const confirmationFingerprint=getCheckoutQuoteFingerprint\(checkoutItems,couponCode\)/);
assert.match(confirm, /const confirmedPayload=paymentAtClick==='Contra entrega'\?null:buildOrderPayload\(\)/);
assert.match(confirm, /const quoteCity=payment==='Contra entrega'\?checkoutCityValue\(\):confirmedPayload\.city/);
assert.match(confirm, /cartQuote=await requestCheckoutQuote\(couponCode,checkoutItems,quoteCity\)/, 'Wompi quote must use the city from its confirmed payload; COD retains its prior current-city path');
assert.match(confirm, /payment==='Contra entrega'\?buildOrderPayload\(\):cloneCheckoutSnapshotValue\(confirmedPayload\)/, 'the Wompi snapshot must not change contraentrega payload construction');
assert.match(confirm, /createImmutableWompiCheckoutSnapshot\(/, 'the frontend must freeze buyer, cart, quote, coupon and reservation state');
assert.match(confirm, /payWithWompi\(snapshot\)/, 'the same immutable snapshot must reach Wompi preparation');
assert.ok(confirm.indexOf('cartQuote=await requestCheckoutQuote') < confirm.indexOf('payWithWompi(snapshot)'));
assert.match(html, /function checkoutSnapshotMatchesCurrent\(snapshot\)/, 'semantic form/cart checks must reject real changes before payment');
assert.match(html, /function trackActiveWompiSnapshotInput\(event\)/, 'input event tracking must catch real changes during async payment preparation');
assert.match(html, /function createImmutableWompiCheckoutSnapshot\(/);

assert.match(edge, /expectedTotal !== totalCop \|\| expectedDiscountTotal !== discountTotal \|\| expectedCouponDiscountTotal !== couponDiscountTotal/,
  'the server must keep validating client totals against its own authoritative quote');
assert.match(edge, /code: "WOMPI_QUOTE_CHANGED"/, 'the server must continue rejecting stale expected totals');
assert.match(edge, /advanceCheckoutRequest\([\s\S]*?"prepare"/, 'the atomic request-fenced pricing/inventory preparation must remain in the flow');

console.log('PASS Wompi frontend quote snapshot regression: immutable confirmed snapshot, no post-refresh form rebuild, semantic edit invalidation, server quote validation, terminal mismatch consent and reservation continuity retained.');

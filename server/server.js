#!/usr/bin/env node
/*
 * Ichiban Sushi — self-hosted site + pickup ordering system.
 * Zero npm dependencies: plain Node.js (>=18). Run: node server/server.js
 *
 * Env:
 *   PORT       (default 3000)
 *   ADMIN_PIN  (default 1234 — CHANGE IN PRODUCTION)
 *   SECRET     (cookie signing secret; default derived from ADMIN_PIN)
 *   DATA_DIR   (default ./data)
 */
'use strict';

// All times (opening hours, pickup slots, bookings) are restaurant-local.
// Pin the process to the restaurant's timezone no matter where the server runs
// — a VPS on UTC/EDT must never offer pickup times that are already past in Göteborg.
process.env.TZ = process.env.RESTAURANT_TZ || 'Europe/Stockholm';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

// minimal .env loader (real environment variables win over the file)
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file — fine */ }

const PUBLIC_DIR = path.join(ROOT, 'public');
const ADMIN_DIR = path.join(ROOT, 'admin');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const SECRET = process.env.SECRET || crypto.createHash('sha256').update('ichiban:' + ADMIN_PIN).digest('hex');
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';   // sk_live_... / sk_test_...
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || ''; // whsec_...
const ONLINE_PAYMENT = Boolean(STRIPE_SECRET_KEY);

// Swish Handel (merchant payment requests): requires an agreement via the bank
// and a client TLS certificate from getswish.se. SWISH_BASE_URL http://... enables
// a plain-http mock for tests.
const SWISH_PAYEE_ALIAS = process.env.SWISH_PAYEE_ALIAS || '';       // e.g. 1231234567
const SWISH_CERT = process.env.SWISH_CERT || '';                     // path to PEM cert
const SWISH_KEY = process.env.SWISH_KEY || '';                       // path to PEM key
const SWISH_BASE_URL = process.env.SWISH_BASE_URL || 'https://cpc.getswish.net/swish-cpcapi';
const SWISH_ENABLED = Boolean(SWISH_PAYEE_ALIAS && (SWISH_BASE_URL.startsWith('http://') || (SWISH_CERT && SWISH_KEY)));

// ---------------------------------------------------------------- opening hours
// 0=Sunday ... 6=Saturday  [open, close] in minutes from midnight
const HOURS = {
  1: [11 * 60, 20 * 60], // mån
  2: [11 * 60, 20 * 60], // tis
  3: [11 * 60, 20 * 60], // ons
  4: [11 * 60, 20 * 60], // tor
  5: [11 * 60, 21 * 60], // fre
  6: [13 * 60, 21 * 60], // lör
  0: [15 * 60, 21 * 60], // sön
};
const SLOT_STEP_MIN = 15;
const MIN_LEAD_MIN = 30; // minimum preparation time

// table bookings: how many guests can sit at once, and how long a table is held
const MAX_CONCURRENT_GUESTS = parseInt(process.env.MAX_CONCURRENT_GUESTS || '40', 10);
const BOOKING_DURATION_MIN = parseInt(process.env.BOOKING_DURATION_MIN || '90', 10);
const GOOGLE_PLACE_ID = process.env.GOOGLE_PLACE_ID || '';
const REVIEW_URL = process.env.REVIEW_URL || ''; // e.g. the official g.page/r/... short link

// ---------------------------------------------------------------- tiny JSON store
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch { return fallback; }
}
function saveJson(file, value) {
  const p = path.join(DATA_DIR, file);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, p);
}

let orders = loadJson('orders.json', []);
let reservations = loadJson('reservations.json', []);
let closures = loadJson('closures.json', []); // [{ id, from, to, message, message_en, createdAt }] — days the restaurant is closed

// ---------------------------------------------------------------- closures (holidays, private events, ...)
function isoDate(d) { return `${d.getFullYear()}-${fmt2(d.getMonth() + 1)}-${fmt2(d.getDate())}`; }
function closureFor(dateStr) { return closures.find((c) => c.from <= dateStr && dateStr <= c.to) || null; }
function upcomingClosures() {
  const t = isoDate(new Date());
  return closures.filter((c) => c.to >= t).sort((a, b) => a.from.localeCompare(b.from));
}
function publicClosure(c) { return { id: c.id, from: c.from, to: c.to, message: c.message, message_en: c.message_en }; }

function nextOrderNumber() {
  const today = new Date().toISOString().slice(0, 10);
  const todays = orders.filter(o => o.createdAt.slice(0, 10) === today);
  return todays.length + 1;
}

// ---------------------------------------------------------------- menu (source of truth)
let MENU = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'data', 'menu.json'), 'utf8'));
const ITEM_INDEX = {};
for (const cat of MENU.categories) for (const it of cat.items) ITEM_INDEX[it.id] = it;
fs.watchFile(path.join(PUBLIC_DIR, 'data', 'menu.json'), { interval: 5000 }, () => {
  try {
    MENU = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'data', 'menu.json'), 'utf8'));
    for (const k of Object.keys(ITEM_INDEX)) delete ITEM_INDEX[k];
    for (const cat of MENU.categories) for (const it of cat.items) ITEM_INDEX[it.id] = it;
    console.log('menu.json reloaded');
  } catch (e) { console.error('menu.json reload failed:', e.message); }
});

// ---------------------------------------------------------------- helpers
function hmac(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}
function timingEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function adminToken() { return 'v1.' + hmac('admin.v1'); }
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isAdmin(req) {
  const c = parseCookies(req);
  return c.adm && timingEqual(c.adm, adminToken());
}
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJsonBody(req) {
  const raw = await readBody(req);
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('invalid json'); }
}

// very small in-memory rate limiter: max N requests per IP per minute for POSTs
const RATE_MAX = parseInt(process.env.RATE_LIMIT_MAX || '10', 10);
const rl = new Map();
// Behind nginx every connection comes from 127.0.0.1, so the real client IP is the
// first X-Forwarded-For entry — trusted only when the socket really is the local proxy,
// otherwise a client could reset its own bucket by sending the header.
function clientIp(req) {
  const sock = req.socket.remoteAddress || '?';
  const local = sock === '127.0.0.1' || sock === '::1' || sock === '::ffff:127.0.0.1';
  // nginx APPENDS the real address to whatever the client sent, so the trustworthy
  // entry is the last one — never the first, which a client can forge.
  const fwd = local && String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
  return fwd || sock;
}
function rateLimited(req, max = 20) {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = rl.get(ip) || { t: now, n: 0 };
  if (now - entry.t > 60000) { entry.t = now; entry.n = 0; }
  entry.n++;
  rl.set(ip, entry);
  return entry.n > max;
}

// ---------------------------------------------------------------- pickup slots
function fmt2(n) { return String(n).padStart(2, '0'); }
function slotsForDate(date, now) {
  const dow = date.getDay();
  if (closureFor(isoDate(date))) return []; // closed that day: no pickup at all
  const [open, close] = HOURS[dow];
  const isToday = date.toDateString() === now.toDateString();
  const earliest = isToday ? (now.getHours() * 60 + now.getMinutes() + MIN_LEAD_MIN) : 0;
  const out = [];
  for (let m = open; m <= close - 15; m += SLOT_STEP_MIN) {
    if (m >= earliest) out.push(fmt2(Math.floor(m / 60)) + ':' + fmt2(m % 60));
  }
  return out;
}
function pickupSlots() {
  const now = new Date();
  const days = [];
  for (let d = 0; d < 2; d++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const slots = slotsForDate(date, now);
    if (slots.length) {
      days.push({
        date: `${date.getFullYear()}-${fmt2(date.getMonth() + 1)}-${fmt2(date.getDate())}`,
        label: d === 0 ? 'Idag' : 'Imorgon',
        slots,
      });
    }
  }
  return days;
}
function validPickup(dateStr, timeStr) {
  return pickupSlots().some(d => d.date === dateStr && d.slots.includes(timeStr));
}

// ---------------------------------------------------------------- SSE for admin
const sseClients = new Set();
const displayClients = new Set(); // public order board (/display) — no auth, no personal data
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) { try { res.write(msg); } catch { /* dropped */ } }
  // the public pickup board only needs to know *something* changed, then it re-fetches /api/display
  if (event === 'order' || event === 'order-status') {
    for (const res of displayClients) { try { res.write('event: refresh\ndata: {}\n\n'); } catch { /* dropped */ } }
  }
}
// The board shows numbers + pickup time only — never names, phones or dishes.
function displayBoard() {
  const map = (o) => ({ n: o.number, t: (o.pickup && o.pickup.time) || '', dinein: o.serviceType === 'dinein', u: o.updatedAt || o.createdAt || '' });
  const preparing = orders.filter((o) => o.status === 'new' || o.status === 'accepted').map(map).sort((a, b) => a.n - b.n);
  // ready newest-first, so the one that just became ready is the big "hero" number on the board
  const ready = orders.filter((o) => o.status === 'ready').map(map).sort((a, b) => (a.u < b.u ? 1 : a.u > b.u ? -1 : b.n - a.n));
  return { preparing, ready, updated: Date.now() };
}
setInterval(() => {
  broadcast('ping', { t: Date.now() });
  for (const res of displayClients) { try { res.write(': keepalive\n\n'); } catch { /* dropped */ } }
}, 25000).unref();

// ---------------------------------------------------------------- stripe (plain REST — no SDK)
function stripeRequest(method, apiPath, formParams, extraHeaders) {
  return new Promise((resolve, reject) => {
    const body = formParams ? new URLSearchParams(formParams).toString() : '';
    const req = https.request({
      hostname: 'api.stripe.com', path: apiPath, method,
      headers: {
        Authorization: 'Bearer ' + STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        ...(extraHeaders || {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(json.error ? json.error.message : 'stripe error'));
          else resolve(json);
        } catch { reject(new Error('stripe: bad response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('stripe timeout')); });
    req.end(body);
  });
}

// Where to send the customer back after Stripe. The browser's Origin header is
// the address the customer is actually using (test port today, ichiban.biz after
// cutover) — BASE_URL is only the fallback, so a stale BASE_URL can never strand
// a customer on a 404 page.
function returnOrigin(req) {
  const o = req && req.headers.origin;
  return o && /^https?:\/\/[^/\s]+$/.test(o) ? o : BASE_URL;
}

async function createCheckoutSession(order, origin = BASE_URL) {
  const params = {
    mode: 'payment',
    // no payment_method_types: the Stripe dashboard decides (cards, Apple Pay,
    // Google Pay, Klarna, ...) — enable/disable methods there, no code change.
    success_url: `${origin}/order?id=${order.id}&token=${order.token}`,
    cancel_url: `${origin}/bestall?cancelled=1`,
    'metadata[order_id]': order.id,
    locale: order.lang === 'en' ? 'en' : 'sv',
    expires_at: String(Math.floor(Date.now() / 1000) + 35 * 60), // 35 min (Stripe minimum is 30)
  };
  if (order.customer.email) params.customer_email = order.customer.email; // Stripe emails the receipt
  order.lines.forEach((l, i) => {
    params[`line_items[${i}][quantity]`] = String(l.qty);
    params[`line_items[${i}][price_data][currency]`] = 'sek';
    params[`line_items[${i}][price_data][unit_amount]`] = String(l.unitPrice * 100);
    params[`line_items[${i}][price_data][product_data][name]`] = l.name + (l.option ? ` (${l.option})` : '');
  });
  // idempotency key: a network retry can never create two sessions for one order
  const session = await stripeRequest('POST', '/v1/checkout/sessions', params, { 'Idempotency-Key': 'order-' + order.id });
  return session; // session.url is the hosted payment page
}

// Webhook-independent safety net: ask Stripe directly about a pending order.
// Even if the webhook never arrives, a paid order becomes visible to the kitchen.
async function reconcileOrder(o) {
  if (!o || o.status !== 'pending_payment' || !o.stripeSessionId) return;
  try {
    const session = await stripeRequest('GET', `/v1/checkout/sessions/${o.stripeSessionId}`);
    if (session.payment_status === 'paid') {
      markOrderPaid(o.id, session.payment_intent);
    } else if (session.status === 'expired') {
      o.status = 'cancelled';
      o.updatedAt = new Date().toISOString();
      saveJson('orders.json', orders);
    }
  } catch (e) { console.error('reconcile failed for #' + o.number + ':', e.message); }
}

// Sweep every minute: reconcile pending payments; cancel anything stuck > 45 min.
setInterval(() => {
  if (!ONLINE_PAYMENT && !SWISH_ENABLED) return;
  const now = Date.now();
  for (const o of orders) {
    if (o.status !== 'pending_payment') continue;
    const ageMin = (now - new Date(o.createdAt).getTime()) / 60000;
    if (ageMin > 45) {
      o.status = 'cancelled';
      o.updatedAt = new Date().toISOString();
      saveJson('orders.json', orders);
      cancelLinkedReservation(o);
    } else if (ageMin > (o.swishId ? 0.5 : 2)) {
      if (o.swishId) reconcileSwishOrder(o);
      else reconcileOrder(o);
    }
  }
}, 60000).unref();

function verifyStripeSignature(rawBody, sigHeader) {
  // header: t=timestamp,v1=signature[,v1=...]
  const parts = Object.create(null);
  for (const kv of String(sigHeader || '').split(',')) {
    const [k, v] = kv.split('=');
    if (k === 'v1') (parts.v1 = parts.v1 || []).push(v);
    else parts[k] = v;
  }
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return false; // 10 min tolerance
  const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${parts.t}.${rawBody}`).digest('hex');
  return parts.v1.some((sig) => {
    try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
  });
}

// ---------------------------------------------------------------- swish (payment requests — no card details, ever)
const swishUrl = new URL(SWISH_BASE_URL);
function swishRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: swishUrl.hostname,
      port: swishUrl.port || (swishUrl.protocol === 'https:' ? 443 : 80),
      path: swishUrl.pathname.replace(/\/$/, '') + apiPath,
      method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    if (swishUrl.protocol === 'https:') {
      try {
        opts.cert = fs.readFileSync(SWISH_CERT);
        opts.key = fs.readFileSync(SWISH_KEY);
      } catch (e) { return reject(new Error('swish cert: ' + e.message)); }
    }
    const mod = swishUrl.protocol === 'https:' ? https : http;
    const req = mod.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`swish ${res.statusCode}: ${d.slice(0, 200)}`));
        resolve({ status: res.statusCode, headers: res.headers, body: d ? JSON.parse(d) : null });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('swish timeout')));
    req.end(data);
  });
}

// 070-123 45 67 -> 46701234567 (Swish payerAlias format)
function swishAlias(phone) {
  let p = String(phone || '').replace(/\D/g, '');
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0')) p = '46' + p.slice(1);
  return /^46\d{8,10}$/.test(p) ? p : null;
}

async function createSwishPayment(order) {
  const payerAlias = swishAlias(order.customer.phone);
  if (!payerAlias) throw new Error('Ange ett svenskt mobilnummer för Swish.');
  const uuid = crypto.randomUUID().replace(/-/g, '').toUpperCase();
  await swishRequest('PUT', `/api/v2/paymentrequests/${uuid}`, {
    payeePaymentReference: String(order.number).padStart(6, '0'),
    callbackUrl: `${BASE_URL}/api/swish/callback`,
    payerAlias,
    payeeAlias: SWISH_PAYEE_ALIAS,
    amount: String(order.total),
    currency: 'SEK',
    message: `Ichiban Sushi order #${order.number}`,
  });
  return uuid;
}

// safety net (mirrors the Stripe reconciliation): ask Swish directly
async function reconcileSwishOrder(o) {
  if (!o || o.status !== 'pending_payment' || !o.swishId) return;
  try {
    const { body } = await swishRequest('GET', `/api/v1/paymentrequests/${o.swishId}`);
    if (body && body.status === 'PAID') markOrderPaid(o.id, null, body.paymentReference);
    else if (body && ['DECLINED', 'ERROR', 'CANCELLED'].includes(body.status)) {
      o.status = 'cancelled';
      o.updatedAt = new Date().toISOString();
      saveJson('orders.json', orders);
      cancelLinkedReservation(o);
    }
  } catch (e) { console.error('swish reconcile failed for #' + o.number + ':', e.message); }
}

// ---------------------------------------------------------------- orders
function sanitizeStr(s, max = 200) { return String(s || '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, max); }

function createOrder(body) {
  const name = sanitizeStr(body.name, 80);
  const phone = sanitizeStr(body.phone, 30).replace(/[^\d+\s()-]/g, '');
  const email = sanitizeStr(body.email, 120);
  const note = sanitizeStr(body.note, 500);
  const pickupDate = sanitizeStr(body.pickupDate, 10);
  const pickupTime = sanitizeStr(body.pickupTime, 5);
  const items = Array.isArray(body.items) ? body.items.slice(0, 60) : [];
  // dine-in order-ahead: the guest orders + pays before arriving; a table is reserved
  const dineIn = body.serviceType === 'dinein';
  const guests = dineIn ? Math.max(1, Math.min(20, parseInt(body.guests, 10) || 0)) : 0;

  if (name.length < 2) throw new Error('Ange ditt namn.');
  if (phone.replace(/\D/g, '').length < 7) throw new Error('Ange ett giltigt telefonnummer.');
  if (!items.length) throw new Error('Varukorgen är tom.');
  if (!validPickup(pickupDate, pickupTime)) throw new Error(dineIn ? 'Ogiltig ankomsttid — välj en ny tid.' : 'Ogiltig avhämtningstid — välj en ny tid.');
  if (dineIn) {
    if (!guests) throw new Error('Ange antal gäster.');
    const slots = bookingSlots(pickupDate, guests);
    const slot = slots && slots.find((s) => s.time === pickupTime);
    if (!slot || !slot.available) throw new Error('Tiden är tyvärr fullbokad — välj en annan ankomsttid.');
  }

  const lines = [];
  let total = 0;
  for (const raw of items) {
    const it = ITEM_INDEX[String(raw.id)];
    const qty = Math.max(1, Math.min(50, parseInt(raw.qty, 10) || 0));
    if (!it || !qty) throw new Error('Okänd rätt i varukorgen.');
    let option = null;
    if (it.options && raw.option && it.options.choices.includes(String(raw.option))) option = String(raw.option);
    lines.push({ id: it.id, name: it.name, name_en: it.name_en || '', qty, unitPrice: it.price, option, lineTotal: it.price * qty }); // name_en: kitchen staff can read the order in English
    total += it.price * qty;
  }

  const wantsOnline = ONLINE_PAYMENT && body.paymentMethod === 'online';
  const wantsSwish = SWISH_ENABLED && body.paymentMethod === 'swish';
  const id = crypto.randomUUID();
  const order = {
    id,
    number: nextOrderNumber(),
    token: crypto.randomBytes(12).toString('hex'), // lets the customer poll their own order status
    createdAt: new Date().toISOString(),
    // pending_payment -> (webhook) -> new -> accepted -> ready -> done | cancelled
    status: (wantsOnline || wantsSwish) ? 'pending_payment' : 'new',
    paid: false,
    paymentMethod: wantsSwish ? 'swish' : wantsOnline ? 'online' : 'pickup',
    serviceType: dineIn ? 'dinein' : 'pickup',
    guests,
    lang: body.lang === 'en' ? 'en' : 'sv',
    customer: { name, phone, email },
    note,
    pickup: { date: pickupDate, time: pickupTime },
    lines,
    total,
  };
  orders.push(order);
  saveJson('orders.json', orders);
  if (dineIn) {
    // reserve the table immediately (counts toward capacity; no separate alarm —
    // the linked order is the thing the kitchen accepts)
    const r = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(12).toString('hex'),
      createdAt: order.createdAt,
      status: 'confirmed',
      linkedOrderId: order.id,
      lang: order.lang,
      name, phone, email, guests,
      date: pickupDate, time: pickupTime,
      note: `🍽 Förbeställd mat — order #${order.number}`,
    };
    reservations.push(r);
    saveJson('reservations.json', reservations);
    order.reservationId = r.id;
    saveJson('orders.json', orders);
  }
  if (!wantsOnline && !wantsSwish) {
    // pay at the restaurant: the kitchen hears about it immediately
    broadcast('order', publicAdminOrder(order));
    if (dineIn) broadcast('reservation-status', { id: order.reservationId, status: 'confirmed' });
    sendReceipt(order); // confirmation with receipt link (email/sms if configured)
  }
  console.log(`ORDER #${order.number} (${order.serviceType}/${order.paymentMethod}) ${name} ${phone} — ${total} kr @ ${pickupDate} ${pickupTime}${dineIn ? ` · ${guests} gäster` : ''}`);
  return order;
}

// a cancelled dine-in order releases its table
function cancelLinkedReservation(order) {
  if (!order.reservationId) return;
  const r = reservations.find((x) => x.id === order.reservationId);
  if (r && r.status !== 'cancelled') {
    r.status = 'cancelled';
    saveJson('reservations.json', reservations);
    broadcast('reservation-status', { id: r.id, status: 'cancelled' });
  }
}

function markOrderPaid(orderId, paymentIntent, swishRef) {
  const o = orders.find((x) => x.id === orderId);
  if (!o || o.paid) return;
  o.paid = true;
  if (paymentIntent) o.paymentIntent = paymentIntent; // needed for refunds (stripe)
  if (swishRef) o.swishPaymentRef = swishRef;         // needed for refunds (swish)
  if (o.status === 'pending_payment') o.status = 'new';
  o.updatedAt = new Date().toISOString();
  saveJson('orders.json', orders);
  broadcast('order', publicAdminOrder(o)); // now the kitchen alarm rings
  sendReceipt(o);
  console.log(`PAID   #${o.number} — ${o.total} kr (Stripe)`);
}

function publicAdminOrder(o) {
  return { id: o.id, number: o.number, createdAt: o.createdAt, status: o.status, paid: o.paid, refunded: !!o.refunded, canRefund: !!(o.paid && (o.paymentIntent || o.swishPaymentRef) && !o.refunded), paymentMethod: o.paymentMethod, serviceType: o.serviceType || 'pickup', guests: o.guests || 0, customer: o.customer, note: o.note, pickup: o.pickup, lines: o.lines, total: o.total };
}
function publicCustomerOrder(o) {
  return { number: o.number, status: o.status, paid: o.paid, refunded: !!o.refunded, paymentMethod: o.paymentMethod, serviceType: o.serviceType || 'pickup', guests: o.guests || 0, pickup: o.pickup, lines: o.lines, total: o.total, createdAt: o.createdAt };
}

// ---------------------------------------------------------------- receipts (email/SMS — both optional)
// Email via Resend (resend.com, RESEND_API_KEY + RECEIPT_FROM), SMS via 46elks
// (46elks.com, ELKS_API_USER + ELKS_API_PASSWORD). Without keys: silently skipped —
// Stripe's own receipt still covers online payments.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RECEIPT_FROM = process.env.RECEIPT_FROM || 'Ichiban Sushi <kvitto@ichiban.biz>';
const ELKS_USER = process.env.ELKS_API_USER || '';
const ELKS_PASS = process.env.ELKS_API_PASSWORD || '';
const SMS_ON_READY = process.env.SMS_ON_READY === '1'; // text the customer when food is ready
const VAT_RATE = 0.12; // Swedish takeaway food VAT

function httpsJson(hostname, apiPath, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: apiPath, method: 'POST', headers }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => (res.statusCode < 400 ? resolve(d) : reject(new Error(`${hostname} ${res.statusCode}: ${d.slice(0, 200)}`))));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error(hostname + ' timeout')));
    req.end(body);
  });
}

function receiptHtml(o) {
  const en = o.lang === 'en';
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const vat = Math.round(o.total * VAT_RATE / (1 + VAT_RATE));
  const rows = o.lines.map((l) => `<tr><td style="padding:6px 0">${l.qty} × ${esc(l.name)}${l.option ? ' · ' + esc(l.option) : ''}</td><td align="right">${l.lineTotal} kr</td></tr>`).join('');
  return `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;color:#26211a">
    <div style="text-align:center;padding:6px 0 14px"><img src="${BASE_URL}/assets/img/site/logo-192.png" alt="Ichiban Sushi" width="84" height="84" style="display:inline-block"></div>
    <div style="background:#8a0018;color:#fff;border-radius:10px;padding:18px 22px">
      <div style="font-size:22px;font-weight:bold">Ichiban Sushi</div>
      <div style="opacity:.85;font-size:13px">Södra Vägen 91, 412 63 Göteborg · 031-83 17 86</div>
    </div>
    <div style="padding:20px 6px">
      <p style="font-size:16px">${en ? 'Thank you for your order' : 'Tack för din beställning'}, ${esc(o.customer.name)}!</p>
      <p><b>${en ? 'Order' : 'Beställning'} #${o.number}</b> — ${o.serviceType === 'dinein'
        ? (en ? `table for ${o.guests}, arrival` : `bord för ${o.guests}, ankomst`)
        : (en ? 'pickup' : 'avhämtning')} ${esc(o.pickup.date)} ${en ? 'at' : 'kl'} ${esc(o.pickup.time)}</p>
      ${o.serviceType === 'dinein' ? `<p style="font-size:13px;color:#666">${en ? 'Your table is reserved — the food is served shortly after you arrive.' : 'Ert bord är reserverat — maten serveras strax efter att ni kommit.'}</p>` : ''}
      <table width="100%" style="border-top:1px solid #ddd;border-bottom:1px solid #ddd;margin:12px 0;font-size:14px">${rows}</table>
      <table width="100%" style="font-size:14px">
        <tr><td>${en ? 'VAT (12%) included' : 'Varav moms (12 %)'}</td><td align="right">${vat} kr</td></tr>
        <tr><td style="font-size:17px;font-weight:bold;padding-top:6px">${en ? 'Total' : 'Summa'}</td><td align="right" style="font-size:17px;font-weight:bold;padding-top:6px">${o.total} kr</td></tr>
      </table>
      <p style="font-size:13px;color:#666">${o.paid ? (en ? 'Paid online.' : 'Betald online.') : (en ? 'Payment at pickup (card/Swish).' : 'Betalas vid avhämtning (kort/Swish).')}
      ${en ? 'Order status' : 'Beställningsstatus'}: <a href="${BASE_URL}/order?id=${o.id}&token=${o.token}" style="color:#8a0018">${BASE_URL}/order</a></p>
      <p style="font-size:12px;color:#999">${en ? 'Digital receipt — nothing to print. Welcome back!' : 'Digitalt kvitto — inget att skriva ut. Välkommen åter!'} いらっしゃいませ</p>
    </div>
  </div>`;
}

function sendReceipt(o) {
  if (RESEND_API_KEY && o.customer.email) {
    const en = o.lang === 'en';
    const body = JSON.stringify({
      from: RECEIPT_FROM, to: [o.customer.email],
      subject: en ? `Receipt — order #${o.number}, Ichiban Sushi` : `Kvitto — beställning #${o.number}, Ichiban Sushi`,
      html: receiptHtml(o),
    });
    httpsJson('api.resend.com', '/emails', { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, body)
      .then(() => console.log(`RECEIPT emailed for #${o.number}`))
      .catch((e) => console.error('receipt email failed:', e.message));
  }
}

function sendSms(to, text) {
  if (!ELKS_USER || !ELKS_PASS) return;
  const msisdn = to.replace(/[^\d+]/g, '').replace(/^0/, '+46');
  const body = new URLSearchParams({ from: 'Ichiban', to: msisdn, message: text }).toString();
  httpsJson('api.46elks.com', '/a1/sms', {
    Authorization: 'Basic ' + Buffer.from(ELKS_USER + ':' + ELKS_PASS).toString('base64'),
    'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body),
  }, body).then(() => console.log('SMS sent to ' + msisdn)).catch((e) => console.error('sms failed:', e.message));
}

// how many guests are already seated in the window overlapping [startMin, startMin+duration)
function bookedGuestsAt(date, startMin) {
  let sum = 0;
  for (const r of reservations) {
    if (r.date !== date || r.status === 'cancelled') continue;
    const [h, m] = r.time.split(':').map(Number);
    const rStart = h * 60 + m;
    if (rStart < startMin + BOOKING_DURATION_MIN && startMin < rStart + BOOKING_DURATION_MIN) sum += r.guests;
  }
  return sum;
}

// Wix-style availability: every 15-min slot for a date, marked available or not
function bookingSlots(dateStr, guests) {
  const d = new Date(dateStr + 'T12:00');
  if (isNaN(d)) return null;
  if (closureFor(dateStr)) return []; // closed: nothing bookable
  const [open, close] = HOURS[d.getDay()];
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const earliest = isToday ? now.getHours() * 60 + now.getMinutes() + MIN_LEAD_MIN : 0;
  const out = [];
  for (let m = open; m <= close - 45; m += SLOT_STEP_MIN) {
    const past = m < earliest;
    const full = bookedGuestsAt(dateStr, m) + guests > MAX_CONCURRENT_GUESTS;
    out.push({ time: fmt2(Math.floor(m / 60)) + ':' + fmt2(m % 60), available: !past && !full });
  }
  return out;
}

function createReservation(body) {
  const name = sanitizeStr(body.name, 80);
  const phone = sanitizeStr(body.phone, 30).replace(/[^\d+\s()-]/g, '');
  const email = sanitizeStr(body.email, 120);
  const guests = Math.max(1, Math.min(20, parseInt(body.guests, 10) || 0));
  const date = sanitizeStr(body.date, 10);
  const time = sanitizeStr(body.time, 5);
  const note = sanitizeStr(body.note, 300);
  if (name.length < 2) throw new Error('Ange ditt namn.');
  if (phone.replace(/\D/g, '').length < 7) throw new Error('Ange ett giltigt telefonnummer.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error('Ogiltigt datum eller tid.');
  const d = new Date(date + 'T' + time);
  if (isNaN(d) || d < new Date()) throw new Error('Tiden har redan passerat.');
  if (closureFor(date)) throw new Error('Vi håller stängt den dagen.');
  const [open, close] = HOURS[d.getDay()];
  const [th, tm] = time.split(':').map(Number);
  const mins = th * 60 + tm;
  if (mins < open || mins > close - 45) throw new Error('Utanför våra öppettider.');
  if (bookedGuestsAt(date, mins) + guests > MAX_CONCURRENT_GUESTS) {
    throw new Error('Tiden är tyvärr fullbokad — välj en annan tid.');
  }

  const r = {
    id: crypto.randomUUID(),
    token: crypto.randomBytes(12).toString('hex'), // lets the guest follow their booking status
    createdAt: new Date().toISOString(),
    status: 'new', // new -> confirmed | cancelled
    lang: body.lang === 'en' ? 'en' : 'sv',
    name, phone, email, guests, date, time, note,
  };
  reservations.push(r);
  saveJson('reservations.json', reservations);
  broadcast('reservation', r);
  console.log(`RESERVATION ${name} ${guests}p @ ${date} ${time}`);
  return r;
}

// notify the guest when the restaurant confirms or declines
function notifyReservation(r) {
  const en = r.lang === 'en';
  const confirmed = r.status === 'confirmed';
  const smsText = confirmed
    ? (en ? `Ichiban Sushi: your table for ${r.guests} on ${r.date} at ${r.time} is confirmed. Welcome!`
          : `Ichiban Sushi: ert bord för ${r.guests} pers ${r.date} kl ${r.time} är bekräftat. Välkomna!`)
    : (en ? `Ichiban Sushi: we could not confirm your booking ${r.date} ${r.time}. Please call 031-83 17 86.`
          : `Ichiban Sushi: vi kunde tyvärr inte bekräfta er bokning ${r.date} kl ${r.time}. Ring oss gärna på 031-83 17 86.`);
  sendSms(r.phone, smsText);
  if (RESEND_API_KEY && r.email) {
    const subject = confirmed
      ? (en ? 'Table confirmed — Ichiban Sushi' : 'Bordsbokning bekräftad — Ichiban Sushi')
      : (en ? 'About your booking — Ichiban Sushi' : 'Om din bokning — Ichiban Sushi');
    const body = JSON.stringify({
      from: RECEIPT_FROM, to: [r.email], subject,
      html: `<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;color:#26211a">
        <div style="text-align:center;padding:6px 0 14px"><img src="${BASE_URL}/assets/img/site/logo-192.png" alt="Ichiban Sushi" width="84" height="84" style="display:inline-block"></div>
        <div style="background:#8a0018;color:#fff;border-radius:10px;padding:18px 22px">
          <div style="font-size:22px;font-weight:bold">Ichiban Sushi</div>
          <div style="opacity:.85;font-size:13px">Södra Vägen 91, 412 63 Göteborg · 031-83 17 86</div>
        </div>
        <div style="padding:20px 6px"><p style="font-size:16px">${smsText.replace('Ichiban Sushi: ', '')}</p></div>
      </div>`,
    });
    httpsJson('api.resend.com', '/emails', { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, body)
      .catch((e) => console.error('booking email failed:', e.message));
  }
}

// ---------------------------------------------------------------- static files
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg',
};
function serveStatic(res, baseDir, urlPath, fallback) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  if (!path.extname(p)) p += '.html';
  const file = path.normalize(path.join(baseDir, p));
  if (!file.startsWith(baseDir)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) {
      if (fallback) return serveStatic(res, baseDir, fallback, null);
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta charset="utf-8"><title>404</title><p style="font-family:sans-serif;padding:3em">Sidan finns inte. <a href="/">Till startsidan</a>');
    }
    const ext = path.extname(file);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (/\/assets\//.test(p) || ext === '.woff2') headers['Cache-Control'] = 'public, max-age=604800';
    else headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    res.end(data);
  });
}

// ---------------------------------------------------------------- router
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    // ---------- public API
    if (p === '/api/menu' && req.method === 'GET') return sendJson(res, 200, MENU);
    if (p === '/api/config' && req.method === 'GET') {
      return sendJson(res, 200, {
        onlinePayment: ONLINE_PAYMENT,
        swish: SWISH_ENABLED,
        currency: 'SEK',
        reviewUrl: REVIEW_URL || (GOOGLE_PLACE_ID ? `https://search.google.com/local/writereview?placeid=` : null),
        closures: upcomingClosures().map(publicClosure), // current + future closed periods, for the site's notice
      });
    }

    if (p === '/api/booking-slots' && req.method === 'GET') {
      const date = sanitizeStr(url.searchParams.get('date'), 10);
      const guests = Math.max(1, Math.min(20, parseInt(url.searchParams.get('guests'), 10) || 2));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, 400, { error: 'bad date' });
      const slots = bookingSlots(date, guests);
      if (!slots) return sendJson(res, 400, { error: 'bad date' });
      return sendJson(res, 200, { date, guests, slots, closed: Boolean(closureFor(date)) });
    }
    if (p === '/api/pickup-slots' && req.method === 'GET') return sendJson(res, 200, { days: pickupSlots(), minLeadMin: MIN_LEAD_MIN });

    // public order board for the in-restaurant TV — numbers only, no personal data, no login
    if (p === '/api/display' && req.method === 'GET') return sendJson(res, 200, displayBoard());
    if (p === '/api/display/stream' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      res.write('event: refresh\ndata: {}\n\n');
      displayClients.add(res);
      req.on('close', () => displayClients.delete(res));
      return;
    }

    if (p === '/api/orders' && req.method === 'POST') {
      if (rateLimited(req, RATE_MAX)) return sendJson(res, 429, { error: 'För många försök — vänta en stund.' });
      const body = await readJsonBody(req);
      try {
        const order = createOrder(body);
        let payUrl = null;
        if (order.paymentMethod === 'swish') {
          try {
            order.swishId = await createSwishPayment(order);
            saveJson('orders.json', orders);
          } catch (e) {
            console.error('swish payment request failed:', e.message);
            if (/mobilnummer/.test(e.message)) {
              // bad payer number: let the customer fix it instead of silently falling back
              order.status = 'cancelled';
              cancelLinkedReservation(order);
              saveJson('orders.json', orders);
              return sendJson(res, 400, { error: e.message });
            }
            order.paymentMethod = 'pickup';
            order.status = 'new';
            saveJson('orders.json', orders);
            broadcast('order', publicAdminOrder(order));
          }
        }
        if (order.paymentMethod === 'online') {
          try {
            const session = await createCheckoutSession(order, returnOrigin(req));
            order.stripeSessionId = session.id;
            saveJson('orders.json', orders);
            payUrl = session.url;
          } catch (e) {
            // Stripe unavailable: fall back to pay-at-pickup instead of losing the order
            console.error('stripe checkout failed:', e.message);
            order.paymentMethod = 'pickup';
            order.status = 'new';
            saveJson('orders.json', orders);
            broadcast('order', publicAdminOrder(order));
          }
        }
        return sendJson(res, 201, { id: order.id, token: order.token, number: order.number, total: order.total, pickup: order.pickup, payUrl, swishPending: order.paymentMethod === 'swish' && order.status === 'pending_payment' });
      } catch (e) { return sendJson(res, 400, { error: e.message }); }
    }

    // Swish callback: we only use it as a wake-up signal, then verify with Swish directly
    if (p === '/api/swish/callback' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const o = orders.find((x) => x.swishId && body && body.id && x.swishId === body.id);
        if (o) await reconcileSwishOrder(o);
      } catch { /* malformed callback — reconciliation sweep covers it */ }
      return sendJson(res, 200, { received: true });
    }

    // Stripe webhook: raw body needed for signature verification
    if (p === '/api/stripe/webhook' && req.method === 'POST') {
      const raw = await readBody(req, 512 * 1024);
      if (!STRIPE_WEBHOOK_SECRET || !verifyStripeSignature(raw, req.headers['stripe-signature'])) {
        return sendJson(res, 400, { error: 'bad signature' });
      }
      let event;
      try { event = JSON.parse(raw); } catch { return sendJson(res, 400, { error: 'bad json' }); }
      if (event.type === 'checkout.session.completed') {
        const obj = event.data && event.data.object;
        const orderId = obj && obj.metadata && obj.metadata.order_id;
        if (orderId) markOrderPaid(orderId, obj.payment_intent);
      }
      if (event.type === 'checkout.session.expired') {
        const orderId = event.data && event.data.object && event.data.object.metadata && event.data.object.metadata.order_id;
        const o = orders.find((x) => x.id === orderId);
        if (o && o.status === 'pending_payment') {
          o.status = 'cancelled';
          saveJson('orders.json', orders);
          cancelLinkedReservation(o);
        }
      }
      return sendJson(res, 200, { received: true });
    }

    const mOrder = p.match(/^\/api\/orders\/([a-f0-9-]+)$/);
    if (mOrder && req.method === 'GET') {
      const o = orders.find(x => x.id === mOrder[1]);
      if (!o || !timingEqual(url.searchParams.get('token') || '', o.token)) return sendJson(res, 404, { error: 'not found' });
      // confirm payment even if the callback/webhook is late or missing
      if (o.status === 'pending_payment') await (o.swishId ? reconcileSwishOrder(o) : reconcileOrder(o));
      return sendJson(res, 200, publicCustomerOrder(o));
    }

    if (p === '/api/reservations' && req.method === 'POST') {
      if (rateLimited(req, RATE_MAX)) return sendJson(res, 429, { error: 'För många försök — vänta en stund.' });
      const body = await readJsonBody(req);
      try {
        const r = createReservation(body);
        return sendJson(res, 201, { id: r.id, token: r.token, date: r.date, time: r.time, guests: r.guests });
      } catch (e) { return sendJson(res, 400, { error: e.message }); }
    }

    // guest-facing booking status (polled by the confirmation view)
    const mResv = p.match(/^\/api\/reservations\/([a-f0-9-]+)$/);
    if (mResv && req.method === 'GET') {
      const r = reservations.find(x => x.id === mResv[1]);
      if (!r || !timingEqual(url.searchParams.get('token') || '', r.token || '')) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, { status: r.status, guests: r.guests, date: r.date, time: r.time });
    }

    // ---------- admin auth
    if (p === '/api/admin/login' && req.method === 'POST') {
      if (rateLimited(req, RATE_MAX)) return sendJson(res, 429, { error: 'För många försök.' });
      const body = await readJsonBody(req);
      if (timingEqual(String(body.pin || ''), ADMIN_PIN)) {
        res.setHeader('Set-Cookie', `adm=${adminToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${180 * 24 * 3600}`);
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 401, { error: 'Fel PIN-kod.' });
    }
    if (p === '/api/admin/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', 'adm=; Path=/; Max-Age=0');
      return sendJson(res, 200, { ok: true });
    }

    // ---------- admin API (PIN-protected)
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return sendJson(res, 401, { error: 'unauthorized' });

      // ---- closures: days the restaurant is closed (set from the dashboard)
      if (p === '/api/admin/closures' && req.method === 'GET') return sendJson(res, 200, { closures: upcomingClosures() });
      if (p === '/api/admin/closures' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const from = sanitizeStr(body.from, 10);
        const to = sanitizeStr(body.to, 10) || from;
        const dre = /^\d{4}-\d{2}-\d{2}$/;
        if (!dre.test(from) || !dre.test(to) || isNaN(new Date(from + 'T12:00')) || isNaN(new Date(to + 'T12:00'))) return sendJson(res, 400, { error: 'Ogiltigt datum.' });
        if (to < from) return sendJson(res, 400, { error: 'Slutdatum ligger före startdatum.' });
        if ((new Date(to + 'T12:00') - new Date(from + 'T12:00')) / 86400000 > 90) return sendJson(res, 400, { error: 'Max 90 dagar i taget.' });
        if (to < isoDate(new Date())) return sendJson(res, 400, { error: 'Datumet har redan passerat.' });
        const c = {
          id: crypto.randomUUID(), from, to,
          message: sanitizeStr(body.message, 200), message_en: sanitizeStr(body.message_en, 200),
          createdAt: new Date().toISOString(),
        };
        closures.push(c);
        saveJson('closures.json', closures);
        return sendJson(res, 201, { closure: c });
      }
      const closureDel = p.match(/^\/api\/admin\/closures\/([\w-]+)$/);
      if (closureDel && req.method === 'DELETE') {
        const before = closures.length;
        closures = closures.filter((c) => c.id !== closureDel[1]);
        if (closures.length === before) return sendJson(res, 404, { error: 'not found' });
        saveJson('closures.json', closures);
        return sendJson(res, 200, { ok: true });
      }

      if (p === '/api/admin/orders' && req.method === 'GET') {
        const today = new Date(); today.setDate(today.getDate() - 2);
        // pending_payment = abandoned/unfinished Stripe checkouts — kitchen never sees those
        const recent = orders
          .filter(o => new Date(o.createdAt) > today && o.status !== 'pending_payment')
          .map(publicAdminOrder).reverse();
        return sendJson(res, 200, { orders: recent });
      }
      const mStatus = p.match(/^\/api\/admin\/orders\/([a-f0-9-]+)\/status$/);
      if (mStatus && req.method === 'POST') {
        const body = await readJsonBody(req);
        const o = orders.find(x => x.id === mStatus[1]);
        const allowed = ['new', 'accepted', 'ready', 'done', 'cancelled'];
        if (!o || !allowed.includes(body.status)) return sendJson(res, 400, { error: 'bad request' });
        o.status = body.status;
        o.updatedAt = new Date().toISOString();
        saveJson('orders.json', orders);
        broadcast('order-status', { id: o.id, status: o.status });
        if (o.status === 'cancelled') cancelLinkedReservation(o);
        if (body.status === 'ready' && SMS_ON_READY) {
          sendSms(o.customer.phone, o.lang === 'en'
            ? `Ichiban Sushi: your order #${o.number} is ready for pickup!`
            : `Ichiban Sushi: din beställning #${o.number} är klar att hämtas!`);
        }
        return sendJson(res, 200, { ok: true });
      }

      // refund a paid online order (full refund via Stripe)
      const mRefund = p.match(/^\/api\/admin\/orders\/([a-f0-9-]+)\/refund$/);
      if (mRefund && req.method === 'POST') {
        const o = orders.find(x => x.id === mRefund[1]);
        if (!o) return sendJson(res, 404, { error: 'not found' });
        if (!o.paid || (!o.paymentIntent && !o.swishPaymentRef)) return sendJson(res, 400, { error: 'Ordern är inte betald online — inget att återbetala.' });
        if (o.refunded) return sendJson(res, 400, { error: 'Redan återbetald.' });
        try {
          let refund;
          if (o.swishPaymentRef) {
            const uuid = crypto.randomUUID().replace(/-/g, '').toUpperCase();
            await swishRequest('PUT', `/api/v2/refunds/${uuid}`, {
              originalPaymentReference: o.swishPaymentRef,
              callbackUrl: `${BASE_URL}/api/swish/callback`,
              payerAlias: SWISH_PAYEE_ALIAS,
              amount: String(o.total),
              currency: 'SEK',
              message: `Återbetalning order #${o.number}`,
            });
            refund = { id: uuid };
          } else {
            refund = await stripeRequest('POST', '/v1/refunds', { payment_intent: o.paymentIntent }, { 'Idempotency-Key': 'refund-' + o.id });
          }
          o.refunded = true;
          o.refundId = refund.id;
          o.status = 'cancelled';
          o.updatedAt = new Date().toISOString();
          saveJson('orders.json', orders);
          broadcast('order-status', { id: o.id, status: o.status });
          cancelLinkedReservation(o);
          console.log(`REFUND #${o.number} — ${o.total} kr (${refund.id})`);
          return sendJson(res, 200, { ok: true, refundId: refund.id });
        } catch (e) {
          console.error('refund failed:', e.message);
          return sendJson(res, 502, { error: 'Stripe: ' + e.message });
        }
      }
      if (p === '/api/admin/reservations' && req.method === 'GET') {
        const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 1);
        const recent = reservations.filter(r => new Date(r.date + 'T23:59') > cutoff).reverse();
        return sendJson(res, 200, { reservations: recent });
      }
      const mRes = p.match(/^\/api\/admin\/reservations\/([a-f0-9-]+)\/status$/);
      if (mRes && req.method === 'POST') {
        const body = await readJsonBody(req);
        const r = reservations.find(x => x.id === mRes[1]);
        if (!r || !['new', 'confirmed', 'cancelled'].includes(body.status)) return sendJson(res, 400, { error: 'bad request' });
        const prev = r.status;
        r.status = body.status;
        saveJson('reservations.json', reservations);
        broadcast('reservation-status', { id: r.id, status: r.status });
        if (prev === 'new' && (r.status === 'confirmed' || r.status === 'cancelled')) notifyReservation(r);
        return sendJson(res, 200, { ok: true });
      }
      if (p === '/api/admin/stream' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write('retry: 3000\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }
      return sendJson(res, 404, { error: 'not found' });
    }

    // ---------- admin static (login page is public; the data behind it is not)
    if (p === '/admin' || p.startsWith('/admin/')) {
      return serveStatic(res, ADMIN_DIR, p.replace(/^\/admin\/?/, '/') || '/', '/index.html');
    }

    // ---------- public static
    return serveStatic(res, PUBLIC_DIR, p, null);
  } catch (e) {
    console.error(e);
    return sendJson(res, 500, { error: 'internal error' });
  }
});

server.listen(PORT, () => {
  console.log(`Ichiban server igång: http://localhost:${PORT}  (admin: /admin, PIN: ${ADMIN_PIN === '1234' ? '1234 — ÄNDRA MED ADMIN_PIN!' : 'satt via env'})`);
});

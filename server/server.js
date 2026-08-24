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
const rl = new Map();
function rateLimited(req, max = 20) {
  const ip = req.socket.remoteAddress || '?';
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
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) { try { res.write(msg); } catch { /* dropped */ } }
}
setInterval(() => broadcast('ping', { t: Date.now() }), 25000).unref();

// ---------------------------------------------------------------- stripe (plain REST — no SDK)
function stripeRequest(method, apiPath, formParams) {
  return new Promise((resolve, reject) => {
    const body = formParams ? new URLSearchParams(formParams).toString() : '';
    const req = https.request({
      hostname: 'api.stripe.com', path: apiPath, method,
      headers: {
        Authorization: 'Bearer ' + STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
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

async function createCheckoutSession(order) {
  const params = {
    mode: 'payment',
    'payment_method_types[0]': 'card',
    success_url: `${BASE_URL}/order?id=${order.id}&token=${order.token}`,
    cancel_url: `${BASE_URL}/bestall?cancelled=1`,
    'metadata[order_id]': order.id,
    expires_at: String(Math.floor(Date.now() / 1000) + 35 * 60), // 35 min (Stripe minimum is 30)
  };
  order.lines.forEach((l, i) => {
    params[`line_items[${i}][quantity]`] = String(l.qty);
    params[`line_items[${i}][price_data][currency]`] = 'sek';
    params[`line_items[${i}][price_data][unit_amount]`] = String(l.unitPrice * 100);
    params[`line_items[${i}][price_data][product_data][name]`] = l.name + (l.option ? ` (${l.option})` : '');
  });
  const session = await stripeRequest('POST', '/v1/checkout/sessions', params);
  return session; // session.url is the hosted payment page
}

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

// ---------------------------------------------------------------- orders
function sanitizeStr(s, max = 200) { return String(s || '').replace(/[ -]/g, ' ').trim().slice(0, max); }

function createOrder(body) {
  const name = sanitizeStr(body.name, 80);
  const phone = sanitizeStr(body.phone, 30).replace(/[^\d+\s()-]/g, '');
  const email = sanitizeStr(body.email, 120);
  const note = sanitizeStr(body.note, 500);
  const pickupDate = sanitizeStr(body.pickupDate, 10);
  const pickupTime = sanitizeStr(body.pickupTime, 5);
  const items = Array.isArray(body.items) ? body.items.slice(0, 60) : [];

  if (name.length < 2) throw new Error('Ange ditt namn.');
  if (phone.replace(/\D/g, '').length < 7) throw new Error('Ange ett giltigt telefonnummer.');
  if (!items.length) throw new Error('Varukorgen är tom.');
  if (!validPickup(pickupDate, pickupTime)) throw new Error('Ogiltig avhämtningstid — välj en ny tid.');

  const lines = [];
  let total = 0;
  for (const raw of items) {
    const it = ITEM_INDEX[String(raw.id)];
    const qty = Math.max(1, Math.min(50, parseInt(raw.qty, 10) || 0));
    if (!it || !qty) throw new Error('Okänd rätt i varukorgen.');
    let option = null;
    if (it.options && raw.option && it.options.choices.includes(String(raw.option))) option = String(raw.option);
    lines.push({ id: it.id, name: it.name, qty, unitPrice: it.price, option, lineTotal: it.price * qty });
    total += it.price * qty;
  }

  const wantsOnline = ONLINE_PAYMENT && body.paymentMethod === 'online';
  const id = crypto.randomUUID();
  const order = {
    id,
    number: nextOrderNumber(),
    token: crypto.randomBytes(12).toString('hex'), // lets the customer poll their own order status
    createdAt: new Date().toISOString(),
    // pending_payment -> (webhook) -> new -> accepted -> ready -> done | cancelled
    status: wantsOnline ? 'pending_payment' : 'new',
    paid: false,
    paymentMethod: wantsOnline ? 'online' : 'pickup',
    customer: { name, phone, email },
    note,
    pickup: { date: pickupDate, time: pickupTime },
    lines,
    total,
  };
  orders.push(order);
  saveJson('orders.json', orders);
  if (!wantsOnline) {
    // pay-at-pickup: the kitchen hears about it immediately
    broadcast('order', publicAdminOrder(order));
  }
  console.log(`ORDER #${order.number} (${order.paymentMethod}) ${name} ${phone} — ${total} kr @ ${pickupDate} ${pickupTime}`);
  return order;
}

function markOrderPaid(orderId) {
  const o = orders.find((x) => x.id === orderId);
  if (!o || o.paid) return;
  o.paid = true;
  if (o.status === 'pending_payment') o.status = 'new';
  o.updatedAt = new Date().toISOString();
  saveJson('orders.json', orders);
  broadcast('order', publicAdminOrder(o)); // now the kitchen alarm rings
  console.log(`PAID   #${o.number} — ${o.total} kr (Stripe)`);
}

function publicAdminOrder(o) {
  return { id: o.id, number: o.number, createdAt: o.createdAt, status: o.status, paid: o.paid, paymentMethod: o.paymentMethod, customer: o.customer, note: o.note, pickup: o.pickup, lines: o.lines, total: o.total };
}
function publicCustomerOrder(o) {
  return { number: o.number, status: o.status, paid: o.paid, paymentMethod: o.paymentMethod, pickup: o.pickup, lines: o.lines, total: o.total, createdAt: o.createdAt };
}

function createReservation(body) {
  const name = sanitizeStr(body.name, 80);
  const phone = sanitizeStr(body.phone, 30).replace(/[^\d+\s()-]/g, '');
  const guests = Math.max(1, Math.min(20, parseInt(body.guests, 10) || 0));
  const date = sanitizeStr(body.date, 10);
  const time = sanitizeStr(body.time, 5);
  const note = sanitizeStr(body.note, 300);
  if (name.length < 2) throw new Error('Ange ditt namn.');
  if (phone.replace(/\D/g, '').length < 7) throw new Error('Ange ett giltigt telefonnummer.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error('Ogiltigt datum eller tid.');
  const d = new Date(date + 'T' + time);
  if (isNaN(d) || d < new Date()) throw new Error('Tiden har redan passerat.');
  const [open, close] = HOURS[d.getDay()];
  const mins = d.getHours() * 60 + d.getMinutes();
  if (mins < open || mins > close - 45) throw new Error('Utanför våra öppettider.');

  const r = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: 'new', // new -> confirmed | cancelled
    name, phone, guests, date, time, note,
  };
  reservations.push(r);
  saveJson('reservations.json', reservations);
  broadcast('reservation', r);
  console.log(`RESERVATION ${name} ${guests}p @ ${date} ${time}`);
  return r;
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
    if (p === '/api/config' && req.method === 'GET') return sendJson(res, 200, { onlinePayment: ONLINE_PAYMENT, currency: 'SEK' });
    if (p === '/api/pickup-slots' && req.method === 'GET') return sendJson(res, 200, { days: pickupSlots(), minLeadMin: MIN_LEAD_MIN });

    if (p === '/api/orders' && req.method === 'POST') {
      if (rateLimited(req, 10)) return sendJson(res, 429, { error: 'För många försök — vänta en stund.' });
      const body = await readJsonBody(req);
      try {
        const order = createOrder(body);
        let payUrl = null;
        if (order.paymentMethod === 'online') {
          try {
            const session = await createCheckoutSession(order);
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
        return sendJson(res, 201, { id: order.id, token: order.token, number: order.number, total: order.total, pickup: order.pickup, payUrl });
      } catch (e) { return sendJson(res, 400, { error: e.message }); }
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
        const orderId = event.data && event.data.object && event.data.object.metadata && event.data.object.metadata.order_id;
        if (orderId) markOrderPaid(orderId);
      }
      if (event.type === 'checkout.session.expired') {
        const orderId = event.data && event.data.object && event.data.object.metadata && event.data.object.metadata.order_id;
        const o = orders.find((x) => x.id === orderId);
        if (o && o.status === 'pending_payment') {
          o.status = 'cancelled';
          saveJson('orders.json', orders);
        }
      }
      return sendJson(res, 200, { received: true });
    }

    const mOrder = p.match(/^\/api\/orders\/([a-f0-9-]+)$/);
    if (mOrder && req.method === 'GET') {
      const o = orders.find(x => x.id === mOrder[1]);
      if (!o || !timingEqual(url.searchParams.get('token') || '', o.token)) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, publicCustomerOrder(o));
    }

    if (p === '/api/reservations' && req.method === 'POST') {
      if (rateLimited(req, 10)) return sendJson(res, 429, { error: 'För många försök — vänta en stund.' });
      const body = await readJsonBody(req);
      try {
        const r = createReservation(body);
        return sendJson(res, 201, { id: r.id, date: r.date, time: r.time, guests: r.guests });
      } catch (e) { return sendJson(res, 400, { error: e.message }); }
    }

    // ---------- admin auth
    if (p === '/api/admin/login' && req.method === 'POST') {
      if (rateLimited(req, 10)) return sendJson(res, 429, { error: 'För många försök.' });
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
        return sendJson(res, 200, { ok: true });
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
        r.status = body.status;
        saveJson('reservations.json', reservations);
        broadcast('reservation-status', { id: r.id, status: r.status });
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

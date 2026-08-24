// Smoke tests for the whole system — run with: node --test test/
// Boots the real server on an ephemeral port with an isolated data dir.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = 3910 + Math.floor(Math.random() * 50);
const B = `http://localhost:${PORT}`;
const WEBHOOK_SECRET = 'whsec_citest_' + crypto.randomBytes(8).toString('hex');
let server;
let tmpData;

// next Mon–Thu (full 11:00–20:00 hours) so 12:00/18:00 slots always exist,
// regardless of which weekday CI runs on
function nextFullDay() {
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.now() + i * 24 * 3600 * 1000);
    if (d.getDay() >= 1 && d.getDay() <= 4) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
}
const DATE = nextFullDay();

async function waitForServer(tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(B + '/api/config'); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

before(async () => {
  tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'ichiban-test-'));
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: tmpData,
      ADMIN_PIN: '9999',
      SECRET: 'ci-secret',
      RATE_LIMIT_MAX: '1000',
      BASE_URL: B,
      STRIPE_SECRET_KEY: '',           // offline: pay-at-pickup only
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      REVIEW_URL: 'https://example.com/review',
      RESEND_API_KEY: '', ELKS_API_USER: '', ELKS_API_PASSWORD: '',
    },
    stdio: 'ignore',
  });
  await waitForServer();
});

after(() => {
  server.kill();
  fs.rmSync(tmpData, { recursive: true, force: true });
});

const post = (p, body) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---------------------------------------------------------------- static + config
test('homepage and key pages respond', async () => {
  for (const p of ['/', '/meny', '/bestall', '/boka', '/om', '/integritet', '/admin']) {
    const r = await fetch(B + p);
    assert.equal(r.status, 200, p);
  }
});

test('config exposes review url, hides payment when stripe off', async () => {
  const cfg = await (await fetch(B + '/api/config')).json();
  assert.equal(cfg.onlinePayment, false);
  assert.equal(cfg.reviewUrl, 'https://example.com/review');
});

test('menu is valid and non-empty', async () => {
  const menu = await (await fetch(B + '/api/menu')).json();
  assert.ok(menu.categories.length > 0);
  for (const c of menu.categories) {
    assert.ok(c.id && c.name, 'category shape');
    for (const it of c.items) assert.ok(it.id && it.name && Number.isFinite(it.price), 'item shape: ' + JSON.stringify(it.id));
  }
});

// ---------------------------------------------------------------- orders
test('order validation rejects bad input', async () => {
  assert.equal((await post('/api/orders', { name: 'X', phone: '1', items: [] })).status, 400);
  assert.equal((await post('/api/orders', { name: 'Test', phone: '0701234567', items: [{ id: 'nope', qty: 1 }], pickupDate: DATE, pickupTime: '12:00' })).status, 400);
  assert.equal((await post('/api/orders', { name: 'Test', phone: '0701234567', items: [{ id: 'edamame', qty: 1 }], pickupDate: DATE, pickupTime: '03:00' })).status, 400);
});

let orderRef;
test('order lifecycle: create -> status -> admin accept -> customer sees it', async () => {
  const menu = await (await fetch(B + '/api/menu')).json();
  const item = menu.categories[0].items[0];
  const r = await post('/api/orders', { name: 'CI Kund', phone: '0701234567', items: [{ id: item.id, qty: 2 }], pickupDate: DATE, pickupTime: '12:00', lang: 'sv' });
  assert.equal(r.status, 201);
  orderRef = await r.json();
  assert.equal(orderRef.total, item.price * 2, 'server-side pricing');

  // wrong token rejected
  assert.equal((await fetch(`${B}/api/orders/${orderRef.id}?token=wrong`)).status, 404);
  const st = await (await fetch(`${B}/api/orders/${orderRef.id}?token=${orderRef.token}`)).json();
  assert.equal(st.status, 'new');

  // admin: wrong pin, right pin, accept
  assert.equal((await post('/api/admin/login', { pin: '0000' })).status, 401);
  const login = await post('/api/admin/login', { pin: '9999' });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(B + '/api/admin/orders')).status, 401, 'admin api needs cookie');
  const accept = await fetch(`${B}/api/admin/orders/${orderRef.id}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ status: 'accepted' }),
  });
  assert.equal(accept.status, 200);
  const st2 = await (await fetch(`${B}/api/orders/${orderRef.id}?token=${orderRef.token}`)).json();
  assert.equal(st2.status, 'accepted');
});

test('stripe webhook: bad signature rejected, good signature accepted', async () => {
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_ci', payment_intent: 'pi_ci', metadata: { order_id: orderRef.id } } } });
  const bad = await fetch(B + '/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': 't=' + Math.floor(Date.now() / 1000) + ',v1=deadbeef' }, body: payload });
  assert.equal(bad.status, 400);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(t + '.' + payload).digest('hex');
  const good = await fetch(B + '/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body: payload });
  assert.equal(good.status, 200);
  const st = await (await fetch(`${B}/api/orders/${orderRef.id}?token=${orderRef.token}`)).json();
  assert.equal(st.paid, true, 'webhook marked order paid');
});

// ---------------------------------------------------------------- bookings
test('booking capacity: overlapping windows fill up and reject overbooking', async () => {
  for (let i = 0; i < 2; i++) {
    const r = await post('/api/reservations', { name: 'Sällskap ' + i, phone: '0709999999', guests: 19, date: DATE, time: '18:00' });
    assert.equal(r.status, 201);
  }
  const slots = (await (await fetch(`${B}/api/booking-slots?date=${DATE}&guests=3`)).json()).slots;
  const at = (t) => slots.find((s) => s.time === t);
  assert.equal(at('18:00').available, false, '18:00 full for 3');
  assert.equal(at('17:00').available, false, 'overlap before');
  assert.equal(at('16:15').available, true, 'outside window free');
  const over = await post('/api/reservations', { name: 'Ola', phone: '0708888888', guests: 5, date: DATE, time: '18:00' });
  assert.equal(over.status, 400, 'server rejects overbooking');
  const fits = await post('/api/reservations', { name: 'Par', phone: '0707777777', guests: 2, date: DATE, time: '18:00' });
  assert.equal(fits.status, 201, '2 guests still fit (38+2=40)');
});

test('booking status token flow', async () => {
  const r = await (await post('/api/reservations', { name: 'Status CI', phone: '0706666666', guests: 2, date: DATE, time: '12:00', lang: 'en' })).json();
  assert.ok(r.token);
  const st = await (await fetch(`${B}/api/reservations/${r.id}?token=${r.token}`)).json();
  assert.equal(st.status, 'new');
  assert.equal((await fetch(`${B}/api/reservations/${r.id}?token=fel`)).status, 404);
});

test('booking validation: outside hours and past dates rejected', async () => {
  assert.equal((await post('/api/reservations', { name: 'X Y', phone: '0701111111', guests: 2, date: DATE, time: '23:00' })).status, 400);
  assert.equal((await post('/api/reservations', { name: 'X Y', phone: '0701111111', guests: 2, date: '2020-01-01', time: '18:00' })).status, 400);
});

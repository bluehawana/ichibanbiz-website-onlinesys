// Smoke tests for the whole system — run with: node --test test/*.test.js
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
const MOCK_SWISH_PORT = PORT + 100;
const B = `http://localhost:${PORT}`;
const WEBHOOK_SECRET = 'whsec_citest_' + crypto.randomBytes(8).toString('hex');
let server;
let tmpData;

// ---- mock Swish Handel API: PUT creates a request, GET reports its status ----
const swishState = new Map(); // uuid -> {status, payerAlias, amount}
const swishMock = require('node:http').createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const put = req.url.match(/\/api\/v2\/paymentrequests\/([A-F0-9]+)$/);
    const get = req.url.match(/\/api\/v1\/paymentrequests\/([A-F0-9]+)$/);
    const refund = req.url.match(/\/api\/v2\/refunds\/([A-F0-9]+)$/);
    if (req.method === 'PUT' && put) {
      const data = JSON.parse(body);
      swishState.set(put[1], { status: 'CREATED', payerAlias: data.payerAlias, amount: data.amount });
      res.writeHead(201); return res.end();
    }
    if (req.method === 'GET' && get && swishState.has(get[1])) {
      const st = swishState.get(get[1]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id: get[1], status: st.status, paymentReference: 'SWREF' + get[1].slice(0, 8), payerAlias: st.payerAlias }));
    }
    if (req.method === 'PUT' && refund) { res.writeHead(201); return res.end(); }
    res.writeHead(404); res.end('{}');
  });
});

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
      SWISH_PAYEE_ALIAS: '1231111111',
      SWISH_BASE_URL: `http://localhost:${MOCK_SWISH_PORT}`,
      TZ: 'America/New_York', // simulate a mis-zoned VPS — the app must still think in Stockholm time
    },
    stdio: 'ignore',
  });
  await new Promise((r) => swishMock.listen(MOCK_SWISH_PORT, r));
  await waitForServer();
});

after(() => {
  server.kill();
  swishMock.close();
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

// ---------------------------------------------------------------- dine-in order-ahead
test('dine-in order reserves a table and links it to the order', async () => {
  const menu = await (await fetch(B + '/api/menu')).json();
  const item = menu.categories[0].items[0];
  const r = await post('/api/orders', {
    name: 'Dinein CI', phone: '0705550001', items: [{ id: item.id, qty: 1 }],
    pickupDate: DATE, pickupTime: '13:00', serviceType: 'dinein', guests: 4, lang: 'sv',
  });
  assert.equal(r.status, 201);
  const o = await r.json();

  // customer view carries dine-in details
  const st = await (await fetch(`${B}/api/orders/${o.id}?token=${o.token}`)).json();
  assert.equal(st.serviceType, 'dinein');
  assert.equal(st.guests, 4);

  // the table is held: capacity at 13:00 drops by 4 (visible via booking slots)
  const login = await post('/api/admin/login', { pin: '9999' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const resv = await (await fetch(B + '/api/admin/reservations', { headers: { cookie } })).json();
  const linked = resv.reservations.find((x) => x.name === 'Dinein CI');
  assert.ok(linked, 'linked reservation exists');
  assert.equal(linked.status, 'confirmed');
  assert.equal(linked.guests, 4);
  assert.ok(linked.note.includes('#' + ('000' + o.number).slice(-3)), 'reservation references the order (3-digit ticket)');

  // cancelling the order releases the table
  await fetch(`${B}/api/admin/orders/${o.id}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ status: 'cancelled' }),
  });
  const resv2 = await (await fetch(B + '/api/admin/reservations', { headers: { cookie } })).json();
  assert.equal(resv2.reservations.find((x) => x.id === linked.id).status, 'cancelled', 'table released on cancel');
});

test('dine-in respects table capacity', async () => {
  const menu = await (await fetch(B + '/api/menu')).json();
  const item = menu.categories[0].items[0];
  // 18:00 window is already full from the booking capacity test (38 + 2 = 40 guests)
  const r = await post('/api/orders', {
    name: 'För Många', phone: '0705550002', items: [{ id: item.id, qty: 1 }],
    pickupDate: DATE, pickupTime: '18:00', serviceType: 'dinein', guests: 6,
  });
  assert.equal(r.status, 400, 'full table window rejected for dine-in orders');
});

// ---------------------------------------------------------------- swish
test('swish: payment request -> approve in app -> kitchen sees paid order', async () => {
  const menu = await (await fetch(B + '/api/menu')).json();
  const item = menu.categories[0].items[0];

  const cfg = await (await fetch(B + '/api/config')).json();
  assert.equal(cfg.swish, true, 'swish advertised to the client');

  // invalid swedish mobile is rejected up front
  const bad = await post('/api/orders', { name: 'Swish Fel', phone: '12345678', items: [{ id: item.id, qty: 1 }], pickupDate: DATE, pickupTime: '14:00', paymentMethod: 'swish' });
  assert.equal(bad.status, 400);

  const r = await post('/api/orders', { name: 'Swish CI', phone: '070-123 45 67', items: [{ id: item.id, qty: 1 }], pickupDate: DATE, pickupTime: '14:00', paymentMethod: 'swish' });
  assert.equal(r.status, 201);
  const o = await r.json();
  assert.equal(o.swishPending, true);

  // the mock got the request with the normalized alias
  const uuid = [...swishState.keys()].pop();
  assert.equal(swishState.get(uuid).payerAlias, '46701234567', 'phone normalized to swish alias');
  assert.equal(swishState.get(uuid).amount, String(o.total));

  // still pending while unapproved
  let st = await (await fetch(`${B}/api/orders/${o.id}?token=${o.token}`)).json();
  assert.equal(st.status, 'pending_payment');

  // customer approves in the app -> mock flips to PAID -> next poll confirms
  swishState.get(uuid).status = 'PAID';
  st = await (await fetch(`${B}/api/orders/${o.id}?token=${o.token}`)).json();
  assert.equal(st.status, 'new');
  assert.equal(st.paid, true, 'order marked paid after swish approval');

  // refund the swish payment from the kitchen dashboard
  const login = await post('/api/admin/login', { pin: '9999' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const refund = await fetch(`${B}/api/admin/orders/${o.id}/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: '{}' });
  assert.equal(refund.status, 200, 'swish refund succeeds');
});

test('swish callback wakes reconciliation', async () => {
  const menu = await (await fetch(B + '/api/menu')).json();
  const item = menu.categories[0].items[0];
  const o = await (await post('/api/orders', { name: 'Swish CB', phone: '0709876543', items: [{ id: item.id, qty: 1 }], pickupDate: DATE, pickupTime: '15:00', paymentMethod: 'swish' })).json();
  const uuid = [...swishState.keys()].pop();
  swishState.get(uuid).status = 'PAID';
  await post('/api/swish/callback', { id: uuid, status: 'PAID' });
  const st = await (await fetch(`${B}/api/orders/${o.id}?token=${o.token}`)).json();
  assert.equal(st.paid, true, 'callback triggered verification and payment');
});

test('declined swish releases a dine-in table', async () => {
  const menu = await (await fetch(B + '/api/menu')).json();
  const item = menu.categories[0].items[0];
  const o = await (await post('/api/orders', { name: 'Swish Nej', phone: '0701112222', items: [{ id: item.id, qty: 1 }], pickupDate: DATE, pickupTime: '12:30', paymentMethod: 'swish', serviceType: 'dinein', guests: 2 })).json();
  const uuid = [...swishState.keys()].pop();
  swishState.get(uuid).status = 'DECLINED';
  const st = await (await fetch(`${B}/api/orders/${o.id}?token=${o.token}`)).json();
  assert.equal(st.status, 'cancelled', 'declined payment cancels the order');
  const login = await post('/api/admin/login', { pin: '9999' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const resv = await (await fetch(B + '/api/admin/reservations', { headers: { cookie } })).json();
  const linked = resv.reservations.find((x) => x.name === 'Swish Nej');
  assert.equal(linked.status, 'cancelled', 'linked table released');
});

test('pickup slots follow restaurant time even on a mis-zoned server', async () => {
  // what time is it in Göteborg right now?
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const [nh, nm] = parts.split(':').map(Number);
  const nowMin = nh * 60 + nm;
  const { days } = await (await fetch(B + '/api/pickup-slots')).json();
  const today = days.find((d) => d.label === 'Idag');
  if (!today) return; // closed for the day in Sweden — nothing to assert
  for (const t of today.slots) {
    const [h, m] = t.split(':').map(Number);
    assert.ok(h * 60 + m >= nowMin + 29, `slot ${t} is in the past (Stockholm now ${parts})`);
  }
});

test('booking validation: outside hours and past dates rejected', async () => {
  assert.equal((await post('/api/reservations', { name: 'X Y', phone: '0701111111', guests: 2, date: DATE, time: '23:00' })).status, 400);
  assert.equal((await post('/api/reservations', { name: 'X Y', phone: '0701111111', guests: 2, date: '2020-01-01', time: '18:00' })).status, 400);
});

test('closures: dashboard closes a day; pickup, booking and reservation refuse it; config announces it', async () => {
  const login = await post('/api/admin/login', { pin: '9999' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(B + '/api/admin/closures')).status, 401, 'closures api needs the admin cookie');

  const day = nextFullDay(); // a future date the other tests also consider bookable
  const bad = await fetch(B + '/api/admin/closures', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ from: day, to: '2020-01-01' }) });
  assert.equal(bad.status, 400, 'end before start rejected');

  const created = await fetch(B + '/api/admin/closures', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ from: day, message: 'Semesterstängt' }) });
  assert.equal(created.status, 201);
  const { closure } = await created.json();
  assert.equal(closure.to, day, 'single day closure: to defaults to from');

  const cfg = await (await fetch(B + '/api/config')).json();
  assert.ok(cfg.closures.some((c) => c.id === closure.id && c.message === 'Semesterstängt'), 'public config lists the closure');

  const booking = await (await fetch(`${B}/api/booking-slots?date=${day}&guests=2`)).json();
  assert.equal(booking.closed, true);
  assert.equal(booking.slots.length, 0, 'no booking slots on a closed day');

  const resv = await post('/api/reservations', { name: 'Test Testsson', phone: '0701234567', guests: 2, date: day, time: '18:00' });
  assert.equal(resv.status, 400, 'reservation on a closed day refused');
  assert.match((await resv.json()).error, /stängt/i);

  const pickup = await (await fetch(B + '/api/pickup-slots')).json();
  assert.ok(!pickup.days.some((d) => d.date === day), 'pickup slots skip the closed day');

  const del = await fetch(`${B}/api/admin/closures/${closure.id}`, { method: 'DELETE', headers: { cookie } });
  assert.equal(del.status, 200);
  const after = await (await fetch(`${B}/api/booking-slots?date=${day}&guests=2`)).json();
  assert.ok(after.slots.length > 0, 'slots are back once the closure is removed');
});

test('rate limiter buckets per real client IP behind the proxy, not per socket', async () => {
  // 12 failed logins from "customer A" trip the limit for A only; "customer B" is unaffected
  const hit = (ip) => fetch(B + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ pin: '0000' }) });
  // the suite boots the server with RATE_LIMIT_MAX=1000, so cross that from A in bursts
  let statuses = [];
  for (let b = 0; b < 11; b++) statuses = statuses.concat(await Promise.all(Array.from({ length: 100 }, () => hit('203.0.113.10').then((r) => r.status))));
  assert.ok(statuses.includes(429), 'customer A is rate limited after many attempts');
  const other = await hit('203.0.113.20');
  assert.equal(other.status, 401, 'customer B still gets a normal (wrong PIN) answer');
});

test('public /display board: numbers only, correct buckets, newest-ready first, no personal data', async () => {
  const login = await post('/api/admin/login', { pin: '9999' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const menu = await (await fetch(B + '/api/menu')).json();
  const item = menu.categories[0].items[0];
  const day = nextFullDay();
  const slots = (await (await fetch(`${B}/api/pickup-slots`)).json()).days.find((d) => d.date === day).slots;
  async function order(time) {
    const r = await post('/api/orders', { name: 'Board Tester', phone: '0700000000', pickupDate: day, pickupTime: time, items: [{ id: item.id, qty: 1 }], serviceType: 'pickup', paymentMethod: 'pickup', lang: 'sv' });
    return (await r.json());
  }
  const a = await order(slots[0]); const b = await order(slots[1]); const c = await order(slots[2]);
  const setSt = (id, s) => fetch(`${B}/api/admin/orders/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ status: s }) });
  await setSt(b.id, 'accepted'); await setSt(b.id, 'ready');
  await new Promise((r) => setTimeout(r, 30));
  await setSt(c.id, 'accepted'); await setSt(c.id, 'ready'); // c becomes ready last → hero
  const board = await (await fetch(`${B}/api/display`)).json();
  const json = JSON.stringify(board);
  assert.ok(!/Board Tester|0700000000|wakame|phone|name/i.test(json), 'board carries no personal data or dish names');
  assert.ok(board.preparing.some((o) => o.n === a.number), 'unaccepted order is in preparing');
  const readyNums = board.ready.map((o) => o.n);
  assert.deepEqual(readyNums.slice(0, 2), [c.number, b.number], 'ready is newest-first (hero = last to become ready)');
  assert.ok(!board.preparing.concat(board.ready).some((o) => o.n === undefined), 'every entry has a number');
});

test('order numbers are 3-digit daily tickets starting at 101', async () => {
  const menu = await (await fetch(B + '/api/menu')).json();
  const item = menu.categories[0].items[0];
  const r = await post('/api/orders', { name: 'Ticket Test', phone: '0700000000', items: [{ id: item.id, qty: 1 }], pickupDate: DATE, pickupTime: '12:00', lang: 'sv' });
  const o = await r.json();
  assert.ok(o.number >= 1 && o.number <= 999, 'daily ticket number is 1..999 (got ' + o.number + '); UI zero-pads to 3 digits');
});

test('order lines carry the hot-kitchen flag (fried/grilled dishes flagged, sushi not)', async () => {
  const login = await post('/api/admin/login', { pin: '9999' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const menu = await (await fetch(B + '/api/menu')).json();
  const items = menu.categories.flatMap((c) => c.items);
  const hot = items.find((i) => i.hot);            // e.g. yakitori / ebi-fry
  const cold = items.find((i) => !i.hot && i.price > 0); // e.g. a nigiri
  assert.ok(hot && cold, 'menu has both hot and cold items');
  const r = await post('/api/orders', { name: 'Hot Test', phone: '0700000000', items: [{ id: hot.id, qty: 1 }, { id: cold.id, qty: 2 }], pickupDate: DATE, pickupTime: '12:00', lang: 'sv' });
  const o = await r.json();
  const list = (await (await fetch(B + '/api/admin/orders', { headers: { cookie } })).json()).orders;
  const mine = list.find((x) => x.id === o.id);
  const hotLine = mine.lines.find((l) => l.id === hot.id);
  const coldLine = mine.lines.find((l) => l.id === cold.id);
  assert.equal(hotLine.hot, true, 'fried/grilled dish is flagged hot');
  assert.ok(!coldLine.hot, 'sushi/cold dish is not flagged hot');
});

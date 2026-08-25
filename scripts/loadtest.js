#!/usr/bin/env node
// Pre-release functional + load test for the Ichiban server. Zero dependencies (Node 18+).
//
//   node scripts/loadtest.js --base http://127.0.0.1:3001 --pin 1234 --functional --load
//   options: --orders 300 --concurrency 40 --bookings 60 --sse 25 --gets 2000 --tag LOADTEST --quiet
//
// --functional: order in → kitchen SSE event ("alarm") → status flow → customer page; online
//               checkout → Stripe URL and NOT on the kitchen screen; booking in → SSE → confirm;
//               dine-in order-ahead; closed day blocks slots/bookings/orders.
// --load:       GET burst, concurrent orders from many simulated customers (distinct
//               X-Forwarded-For), a booking race against table capacity, SSE fan-out to many
//               kitchen screens, and an integrity check (unique order numbers, counts match).
// Everything created is tagged (customer name starts with the tag) so it can be cleaned up.
'use strict';
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'] : []).filter(Boolean));
const BASE = (args.base || 'http://127.0.0.1:3000').replace(/\/$/, '');
const PIN = args.pin || process.env.ADMIN_PIN || '';
const TAG = args.tag || 'LOADTEST';
const N = { orders: +args.orders || 300, conc: +args.concurrency || 40, bookings: +args.bookings || 60, sse: +args.sse || 25, gets: +args.gets || 2000 };
const quiet = args.quiet === 'true';
const results = []; let failures = 0;
const ok = (name, cond, detail = '') => { results.push({ name, ok: !!cond, detail }); if (!cond) failures++; if (!quiet) console.log(`${cond ? '  ✔' : '  ✖'} ${name}${detail ? ' — ' + detail : ''}`); };
const log = (...a) => { if (!quiet) console.log(...a); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stats = (ms) => `n=${ms.length} p50=${pct(ms, .5)}ms p95=${pct(ms, .95)}ms p99=${pct(ms, .99)}ms max=${Math.max(0, ...ms)}ms`;

async function req(method, path, { body, cookie, ip, headers } = {}) {
  const h = { ...(headers || {}) };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (cookie) h.cookie = cookie;
  if (ip) h['x-forwarded-for'] = ip;
  h.origin = BASE;
  const t = Date.now();
  const res = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json, ms: Date.now() - t, headers: res.headers };
}
async function pool(items, conc, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: e.message }; } } }));
  return out;
}

// ---- SSE client: collects events from /api/admin/stream
async function sseClient(cookie) {
  const ctrl = new AbortController();
  const res = await fetch(BASE + '/api/admin/stream', { headers: { cookie, accept: 'text/event-stream' }, signal: ctrl.signal });
  if (res.status !== 200) throw new Error('sse status ' + res.status);
  const events = []; const waiters = [];
  (async () => {
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const ev = { event: 'message', data: '' };
          for (const line of chunk.split('\n')) { if (line.startsWith('event:')) ev.event = line.slice(6).trim(); else if (line.startsWith('data:')) ev.data += line.slice(5).trim(); }
          try { ev.data = JSON.parse(ev.data); } catch {}
          ev.at = Date.now(); events.push(ev);
          waiters.splice(0).forEach((w) => w());
        }
      }
    } catch {}
  })();
  const waitFor = (pred, timeout = 3000) => new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    const check = () => { const hit = events.find(pred); if (hit) return resolve(hit); if (Date.now() > deadline) return resolve(null); waiters.push(check); setTimeout(check, 50); };
    check();
  });
  return { events, waitFor, close: () => ctrl.abort() };
}

let cookie = '', menuItems = [], slots = null, config = null;
async function setup() {
  config = (await req('GET', '/api/config')).json;
  const menu = (await req('GET', '/api/menu')).json;
  menuItems = menu.categories.flatMap((c) => c.items).filter((i) => i.price > 0);
  slots = (await req('GET', '/api/pickup-slots')).json;
  ok('server answers /api/config, /api/menu, /api/pickup-slots', config && menuItems.length > 20 && slots && slots.days, `${menuItems.length} dishes, ${slots.days.length} pickup day(s)`);
  if (!slots.days.length) throw new Error('no pickup slots available right now (closed?) — run during opening hours or the day before');
  const login = await req('POST', '/api/admin/login', { body: { pin: PIN }, ip: '10.9.9.9' });
  ok('kitchen login with PIN', login.status === 200);
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];
}
const lastSlot = () => { const d = slots.days[slots.days.length - 1]; return { date: d.date, time: d.slots[d.slots.length - 1] }; };
const orderBody = (i, extra = {}) => {
  const it = menuItems[i % menuItems.length]; const s = lastSlot();
  return { name: `${TAG} kund ${i}`, phone: '0700000000', email: '', note: `${TAG} – testorder, laga inte`, pickupDate: s.date, pickupTime: s.time, items: [{ id: it.id, qty: 1 + (i % 3) }], serviceType: 'pickup', paymentMethod: 'pickup', lang: 'sv', ...extra };
};
const created = { orders: [], reservations: [] };

async function functional() {
  log('\n— Functional —');
  const sse = await sseClient(cookie);
  ok('kitchen live stream (SSE) connects', true);

  // 1. order in → alarm event → status flow → customer page
  let r = await req('POST', '/api/orders', { body: orderBody(1), ip: '10.1.0.1' });
  ok('pickup order accepted (201)', r.status === 201, r.status !== 201 ? JSON.stringify(r.json) : `#${r.json.number}`);
  const o = r.json; created.orders.push(o);
  const ev = await sse.waitFor((e) => e.event === 'order' && e.data && e.data.id === o.id, 3000);
  ok('kitchen screen receives the "order" event (this is what rings the alarm)', !!ev, ev ? `${ev.at - Date.now() + 3000 > 0 ? '' : ''}within 3s` : 'no event in 3s');
  let cust = await req('GET', `/api/orders/${o.id}?token=${o.token}`);
  ok('customer order page shows status "new"', cust.status === 200 && cust.json.status === 'new', cust.json && cust.json.status);
  for (const st of ['accepted', 'ready', 'done']) {
    const a = await req('POST', `/api/admin/orders/${o.id}/status`, { body: { status: st }, cookie });
    const sev = await sse.waitFor((e) => e.event === 'order-status' && e.data.id === o.id && e.data.status === st, 2000);
    cust = await req('GET', `/api/orders/${o.id}?token=${o.token}`);
    ok(`kitchen sets "${st}" → customer page updates`, a.status === 200 && sev && cust.json.status === st);
  }
  const bad = await req('GET', `/api/orders/${o.id}?token=wrongtoken`);
  ok('order page refuses a wrong token', bad.status === 401 || bad.status === 403 || bad.status === 404, String(bad.status));

  // 2. online checkout: Stripe URL, and NOT on the kitchen screen until paid
  if (config.onlinePayment) {
    r = await req('POST', '/api/orders', { body: orderBody(2, { paymentMethod: 'online' }), ip: '10.1.0.2' });
    ok('online order creates a Stripe Checkout session', r.status === 201 && /^https:\/\/checkout\.stripe\.com\//.test(r.json.payUrl || ''), r.status === 201 ? (r.json.payUrl || 'no payUrl').slice(0, 45) : JSON.stringify(r.json));
    if (r.status === 201) {
      created.orders.push(r.json);
      const leaked = await sse.waitFor((e) => e.event === 'order' && e.data && e.data.id === r.json.id, 1500);
      ok('unpaid online order does NOT reach the kitchen screen', !leaked);
      await req('POST', `/api/admin/orders/${r.json.id}/status`, { body: { status: 'cancelled' }, cookie });
    }
  } else log('  (online payment disabled on this server — Stripe step skipped)');

  // 3. booking in → event → confirm → customer status
  const bdate = slots.days[slots.days.length - 1].date;
  const bs = await req('GET', `/api/booking-slots?date=${bdate}&guests=2`);
  const free = (bs.json.slots || []).find((s) => s.available);
  ok('booking availability grid has free times', !!free, free ? `${bdate} ${free.time}` : JSON.stringify(bs.json).slice(0, 80));
  if (free) {
    r = await req('POST', '/api/reservations', { body: { name: `${TAG} gäst`, phone: '0700000000', email: '', guests: 2, date: bdate, time: free.time, note: `${TAG}`, lang: 'sv' }, ip: '10.1.0.3' });
    ok('table booking accepted (201)', r.status === 201, r.status !== 201 ? JSON.stringify(r.json) : '');
    if (r.status === 201) {
      const b = r.json; created.reservations.push(b);
      const bev = await sse.waitFor((e) => e.event === 'reservation' && e.data && e.data.id === b.id, 3000);
      ok('kitchen screen receives the "reservation" event', !!bev);
      const c = await req('POST', `/api/admin/reservations/${b.id}/status`, { body: { status: 'confirmed' }, cookie });
      const cs = await req('GET', `/api/reservations/${b.id}?token=${b.token}`);
      ok('kitchen confirms → guest status page shows "confirmed"', c.status === 200 && cs.json && cs.json.status === 'confirmed', cs.json && cs.json.status);
      const dup = await req('POST', '/api/reservations', { body: { name: `${TAG} gäst`, phone: '0700000000', guests: 99, date: bdate, time: free.time, lang: 'sv' }, ip: '10.1.0.4' });
      ok('oversized party (99) is capped or refused', dup.status === 400 || (dup.status === 201 && dup.json.guests <= 20), `${dup.status}${dup.status === 201 ? ' capped to ' + dup.json.guests : ''}`);
      if (dup.status === 201) created.reservations.push(dup.json);
    }
  }

  // 4. dine-in order-ahead: order + table in one go (arrival time must be a bookable time)
  const dslots = (await req('GET', `/api/booking-slots?date=${bdate}&guests=2`)).json.slots || [];
  const dfree = dslots.filter((s) => s.available); const dtime = (dfree[Math.floor(dfree.length / 2)] || dfree[0] || {}).time;
  r = await req('POST', '/api/orders', { body: orderBody(5, { serviceType: 'dinein', guests: 2, pickupDate: bdate, pickupTime: dtime }), ip: '10.1.0.5' });
  // the public order response doesn't expose the table link — check the kitchen side instead
  const dResv = r.status === 201 ? (await req('GET', '/api/admin/reservations', { cookie })).json.reservations.find((x) => x.name === `${TAG} kund 5` && x.date === bdate && x.time === dtime) : null;
  ok('dine-in order-ahead accepted and a table is reserved for it', r.status === 201 && !!dResv, r.status !== 201 ? JSON.stringify(r.json) : (dResv ? `${bdate} ${dtime}, ${dResv.status}` : 'no matching reservation on the kitchen side'));
  if (r.status === 201) created.orders.push(r.json);
  if (dResv) created.reservations.push(dResv);

  // 5. closed day: blocks booking + pickup + order, announced in config; then removed
  const closeDate = slots.days.length > 1 ? slots.days[1].date : slots.days[0].date;
  const cl = await req('POST', '/api/admin/closures', { body: { from: closeDate, to: closeDate, message: `${TAG} stängt` }, cookie });
  ok('dashboard can close a day', cl.status === 201, JSON.stringify(cl.json).slice(0, 80));
  if (cl.status === 201) {
    const cfg = (await req('GET', '/api/config')).json;
    ok('site config announces the closure (lightbox source)', (cfg.closures || []).some((c) => c.id === cl.json.closure.id));
    const b2 = await req('GET', `/api/booking-slots?date=${closeDate}&guests=2`);
    ok('no booking times on the closed day', b2.json.closed === true && b2.json.slots.length === 0);
    const ps = (await req('GET', '/api/pickup-slots')).json;
    ok('no pickup slots on the closed day', !ps.days.some((d) => d.date === closeDate));
    const o2 = await req('POST', '/api/orders', { body: { ...orderBody(6), pickupDate: closeDate, pickupTime: '18:00' }, ip: '10.1.0.6' });
    ok('order for the closed day is refused', o2.status === 400);
    const rm = await req('DELETE', `/api/admin/closures/${cl.json.closure.id}`, { cookie });
    const ps2 = (await req('GET', '/api/pickup-slots')).json;
    ok('closure removed → slots are back', rm.status === 200 && ps2.days.length === slots.days.length);
  }
  sse.close();
}

async function load() {
  log('\n— Load —');
  // a) GET burst: menu / slots / config / home page, 100 in flight
  const paths = ['/api/menu', '/api/pickup-slots', '/api/config', '/', '/meny', '/css/style.css'];
  const g = await pool(Array.from({ length: N.gets }, (_, i) => paths[i % paths.length]), 100, async (p) => { const t = Date.now(); const r = await fetch(BASE + p); await r.arrayBuffer(); return { s: r.status, ms: Date.now() - t }; });
  const gOk = g.filter((x) => x && x.s === 200);
  ok(`${N.gets} GETs at 100 concurrent, all 200`, gOk.length === N.gets, stats(gOk.map((x) => x.ms)) + (gOk.length !== N.gets ? ` FAILED=${N.gets - gOk.length}` : ''));

  // b) concurrent orders from many simulated customers
  const screens = await Promise.all(Array.from({ length: Math.min(N.sse, 5) }, () => sseClient(cookie)));
  const t0 = Date.now();
  const o = await pool(Array.from({ length: N.orders }, (_, i) => i), N.conc, (i) => req('POST', '/api/orders', { body: orderBody(100 + i), ip: `10.${(i >> 8) & 255}.${i & 255}.${1 + (i % 250)}` }));
  const wall = Date.now() - t0;
  const oOk = o.filter((x) => x && x.status === 201);
  oOk.forEach((x) => created.orders.push(x.json));
  const byStatus = o.reduce((m, x) => { const k = x ? x.status : 'err'; m[k] = (m[k] || 0) + 1; return m; }, {});
  ok(`${N.orders} orders at ${N.conc} concurrent customers, all accepted`, oOk.length === N.orders, `${stats(oOk.map((x) => x.ms))} wall=${wall}ms (${Math.round(N.orders / (wall / 1000))} orders/s) statuses=${JSON.stringify(byStatus)}`);
  const nums = new Set(oOk.map((x) => x.json.number));
  ok('order numbers are unique under concurrency', nums.size === oOk.length, `${nums.size} unique of ${oOk.length}`);
  await sleep(1500);
  const seen = screens.map((s) => new Set(s.events.filter((e) => e.event === 'order').map((e) => e.data.id)));
  const allSeen = seen.every((set) => oOk.every((x) => set.has(x.json.id)));
  ok(`every kitchen screen (${screens.length} connected) received every order event`, allSeen, seen.map((s) => s.size).join('/') + ` of ${oOk.length}`);
  screens.forEach((s) => s.close());

  // c) booking race: many parties want the same time; capacity must hold
  const bdate = slots.days[slots.days.length - 1].date;
  const bs = (await req('GET', `/api/booking-slots?date=${bdate}&guests=4`)).json;
  const free = (bs.slots || []).filter((s) => s.available);
  const target = free[Math.floor(free.length / 2)] || free[0];
  if (target) {
    const before = (await req('GET', '/api/admin/reservations', { cookie })).json.reservations.length;
    const b = await pool(Array.from({ length: N.bookings }, (_, i) => i), N.bookings, (i) => req('POST', '/api/reservations', { body: { name: `${TAG} sällskap ${i}`, phone: '0700000000', guests: 4, date: bdate, time: target.time, lang: 'sv' }, ip: `10.200.${i >> 8}.${1 + (i & 255)}` }));
    const bOk = b.filter((x) => x && x.status === 201); bOk.forEach((x) => created.reservations.push(x.json));
    const full = b.filter((x) => x && x.status === 400 && /fullbokad/i.test((x.json || {}).error || ''));
    const after = (await req('GET', '/api/admin/reservations', { cookie })).json.reservations;
    const startMin = +target.time.slice(0, 2) * 60 + +target.time.slice(3);
    const overlap = after.filter((r) => r.date === bdate && r.status !== 'cancelled').filter((r) => { const m = +r.time.slice(0, 2) * 60 + +r.time.slice(3); return m < startMin + 90 && startMin < m + 90; }).reduce((s, r) => s + r.guests, 0);
    ok(`${N.bookings} parties of 4 race for ${bdate} ${target.time}: capacity respected`, overlap <= 40 && bOk.length + full.length === N.bookings, `accepted=${bOk.length} "fullbokad"=${full.length} guests-seated-in-window=${overlap} (max 40)`);
    ok('no reservation was lost or duplicated in the race', after.length === before + bOk.length, `${before} → ${after.length}`);
  } else ok('booking race', false, 'no free time found');

  // d) SSE fan-out to many kitchen screens
  const many = await Promise.all(Array.from({ length: N.sse }, () => sseClient(cookie)));
  const r = await req('POST', '/api/orders', { body: orderBody(999), ip: '10.250.0.1' });
  if (r.status === 201) created.orders.push(r.json);
  const got = await Promise.all(many.map((s) => s.waitFor((e) => e.event === 'order' && e.data && e.data.id === r.json.id, 3000)));
  ok(`${N.sse} kitchen screens connected at once all get a new order within 3s`, got.every(Boolean), `${got.filter(Boolean).length}/${N.sse}`);
  many.forEach((s) => s.close());

  // e) integrity: the dashboard sees everything we created
  const adminOrders = (await req('GET', '/api/admin/orders', { cookie })).json.orders;
  const ids = new Set(adminOrders.map((x) => x.id));
  ok('dashboard lists every created order', created.orders.every((x) => ids.has(x.id)), `${created.orders.length} created`);
}

(async () => {
  console.log(`Ichiban pre-release test → ${BASE}`);
  try {
    await setup();
    if (args.functional === 'true') await functional();
    if (args.load === 'true') await load();
  } catch (e) { ok('run completed without crash', false, e.message); }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed${failures ? ` — ${failures} FAILED` : ''}. Created: ${created.orders.length} orders, ${created.reservations.length} reservations (tag "${TAG}").`);
  console.log('RESULT_JSON ' + JSON.stringify({ base: BASE, passed, total: results.length, failed: results.filter((r) => !r.ok), created: { orders: created.orders.length, reservations: created.reservations.length } }));
  process.exit(failures ? 1 : 0);
})();

// Demo Kök — kitchen dashboard.
// New orders arrive over SSE and ring a repeating alarm until every one is accepted.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let ordersList = [];
  let bookings = [];
  let tab = 'orders';
  let es = null;

  // ---------------- alarm (WebAudio — no sound file needed) ----------------
  let audioCtx = null;
  let alarmTimer = null;

  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return false; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx.state === 'running' || audioCtx.state === 'suspended';
  }
  function beepBurst() {
    if (!audioCtx || audioCtx.state !== 'running') return;
    const t0 = audioCtx.currentTime;
    // three insistent two-tone chimes
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.45;
      [880, 1320].forEach((f, j) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + j * 0.18);
        g.gain.exponentialRampToValueAtTime(0.28, t + j * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + j * 0.18 + 0.16);
        o.connect(g).connect(audioCtx.destination);
        o.start(t + j * 0.18); o.stop(t + j * 0.18 + 0.2);
      });
    }
    if (navigator.vibrate) navigator.vibrate([300, 120, 300]);
  }
  function hasUnacked() {
    return ordersList.some((o) => o.status === 'new') || bookings.some((b) => b.status === 'new');
  }
  function syncAlarm() {
    if (hasUnacked()) {
      if (!alarmTimer) { beepBurst(); alarmTimer = setInterval(beepBurst, 2500); }
    } else if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; }
    document.title = hasUnacked() ? '🔔 NY BESTÄLLNING — Demo Kök' : 'Demo Kök — beställningar';
  }
  function notify(title, body) {
    if (Notification.permission === 'granted') {
      try { new Notification(title, { body, tag: 'ichiban-order', renotify: true }); } catch {}
    }
  }

  // ---------------- rendering ----------------
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });

  function orderCard(o) {
    const st = o.refunded ? 'Återbetald' : ({ new: 'NY', accepted: 'Accepterad', ready: 'Klar', done: 'Uthämtad', cancelled: 'Avbruten' }[o.status] || o.status);
    // paid online orders get a refund button (tap twice to confirm)
    const refundBtn = o.canRefund ? `<button class="b-cancel b-refund" data-refund="${esc(o.id)}">↩ Återbetala</button>` : '';
    const actions = ({
      new: `<button class="b-accept" data-a="accepted">✓ Acceptera</button><button class="b-cancel" data-a="cancelled">Avvisa</button>`,
      accepted: `<button class="b-ready" data-a="ready">🍣 Maten är klar</button><button class="b-cancel" data-a="cancelled">Avbryt</button>`,
      ready: `<button class="b-done" data-a="done">✓ Uthämtad</button>`,
      done: '', cancelled: '',
    }[o.status] || '') + refundBtn;
    return `<div class="card ${o.status === 'new' ? 'new' : ''}" data-id="${esc(o.id)}" data-kind="order">
      <div class="row">
        <span class="num">#${o.number}</span>
        <span class="pickup">Hämtas ${esc(o.pickup.time)}</span>
        <span class="st ${esc(o.status)}">${st}</span>
      </div>
      <p class="meta">${esc(o.customer.name)} · <a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a> · inkom ${fmtTime(o.createdAt)}</p>
      <div class="lines">
        ${o.lines.map((l) => `<div><span><span class="q">${l.qty} ×</span> ${esc(l.name)}${l.option ? ' · ' + esc(l.option) : ''}</span><span>${l.lineTotal} kr</span></div>`).join('')}
      </div>
      ${o.note ? `<div class="note">✎ ${esc(o.note)}</div>` : ''}
      <div class="total"><span>${o.paid ? '<span class="paid">✓ BETALD ONLINE</span>' : '<span class="unpaid">Betalas vid avhämtning</span>'}</span><span>${o.total} kr</span></div>
      <div class="actions">${actions}</div>
    </div>`;
  }

  function bookingCard(b) {
    const st = { new: 'NY', confirmed: 'Bekräftad', cancelled: 'Avvisad' }[b.status] || b.status;
    const actions = b.status === 'new'
      ? `<button class="b-accept" data-a="confirmed">✓ Bekräfta</button><button class="b-cancel" data-a="cancelled">Avvisa</button>`
      : '';
    return `<div class="card ${b.status === 'new' ? 'new' : ''}" data-id="${esc(b.id)}" data-kind="booking">
      <div class="row">
        <span class="num">${b.guests} gäster</span>
        <span class="pickup">${esc(b.date)} kl ${esc(b.time)}</span>
        <span class="st ${b.status === 'new' ? 'new' : b.status === 'confirmed' ? 'ready' : ''}">${st}</span>
      </div>
      <p class="meta">${esc(b.name)} · <a href="tel:${esc(b.phone)}">${esc(b.phone)}</a> · inkom ${fmtTime(b.createdAt)}</p>
      ${b.note ? `<div class="note">✎ ${esc(b.note)}</div>` : ''}
      <div class="actions">${actions}</div>
    </div>`;
  }

  function render() {
    const list = $('list');
    if (tab === 'orders') {
      const active = ordersList.filter((o) => !['done', 'cancelled'].includes(o.status));
      const rest = ordersList.filter((o) => ['done', 'cancelled'].includes(o.status)).slice(0, 10);
      list.innerHTML = (active.length || rest.length)
        ? active.map(orderCard).join('') + rest.map(orderCard).join('')
        : '<p class="empty">Inga beställningar ännu idag.</p>';
    } else {
      list.innerHTML = bookings.length ? bookings.map(bookingCard).join('') : '<p class="empty">Inga bokningar.</p>';
    }
    const nOrders = ordersList.filter((o) => o.status === 'new').length;
    const nBook = bookings.filter((b) => b.status === 'new').length;
    $('badge-orders').textContent = nOrders; $('badge-orders').hidden = !nOrders;
    $('badge-bookings').textContent = nBook; $('badge-bookings').hidden = !nBook;
    syncAlarm();
  }

  // ---------------- data ----------------
  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
    return res.json();
  }
  async function loadAll() {
    const [o, b] = await Promise.all([api('/api/admin/orders'), api('/api/admin/reservations')]);
    ordersList = o.orders; bookings = b.reservations;
    render();
  }
  function connectSSE() {
    if (es) es.close();
    es = new EventSource('/api/admin/stream');
    es.onopen = () => $('conn').classList.add('on');
    es.onerror = () => $('conn').classList.remove('on');
    es.addEventListener('order', (e) => {
      const o = JSON.parse(e.data);
      ordersList.unshift(o);
      notify(`Ny beställning #${o.number}`, `${o.lines.length} rader · ${o.total} kr · hämtas ${o.pickup.time}`);
      render();
    });
    es.addEventListener('order-status', () => loadAll().catch(() => {}));
    es.addEventListener('reservation', (e) => {
      const b = JSON.parse(e.data);
      bookings.unshift(b);
      notify('Ny bordsbokning', `${b.guests} gäster · ${b.date} kl ${b.time}`);
      render();
    });
    es.addEventListener('reservation-status', () => loadAll().catch(() => {}));
  }

  // status + refund buttons
  $('list').addEventListener('click', async (e) => {
    const refundBtn = e.target.closest('button[data-refund]');
    if (refundBtn) {
      // two taps to refund — no blocking confirm() dialogs
      if (!refundBtn.dataset.armed) {
        refundBtn.dataset.armed = '1';
        refundBtn.textContent = 'Tryck igen: återbetala hela beloppet';
        refundBtn.style.color = '#fff'; refundBtn.style.background = 'var(--aka)';
        setTimeout(() => { refundBtn.dataset.armed = ''; refundBtn.textContent = '↩ Återbetala'; refundBtn.style.color = ''; refundBtn.style.background = ''; }, 4000);
        return;
      }
      refundBtn.disabled = true;
      try {
        await api(`/api/admin/orders/${refundBtn.dataset.refund}/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        await loadAll();
      } catch { refundBtn.disabled = false; }
      return;
    }
    const btn = e.target.closest('button[data-a]');
    if (!btn) return;
    const card = btn.closest('.card');
    const kind = card.dataset.kind === 'order' ? 'orders' : 'reservations';
    btn.disabled = true;
    try {
      await api(`/api/admin/${kind}/${card.dataset.id}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: btn.dataset.a }),
      });
      await loadAll();
    } catch { btn.disabled = false; }
  });

  // tabs
  $('tab-orders').addEventListener('click', () => { tab = 'orders'; $('tab-orders').classList.add('active'); $('tab-bookings').classList.remove('active'); render(); });
  $('tab-bookings').addEventListener('click', () => { tab = 'bookings'; $('tab-bookings').classList.add('active'); $('tab-orders').classList.remove('active'); render(); });

  // clock
  setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }); }, 1000);

  // ---------------- login ----------------
  function showLogin() { $('login').hidden = false; $('app').hidden = true; }
  async function showApp() {
    $('login').hidden = true; $('app').hidden = false;
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    $('soundgate').classList.add('show'); // one tap to unlock audio on mobile
    await loadAll();
    connectSSE();
  }
  $('soundgate-btn').addEventListener('click', () => {
    ensureAudio();
    $('soundgate').classList.remove('show');
    syncAlarm();
  });
  $('login-btn').addEventListener('click', doLogin);
  $('pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  async function doLogin() {
    $('login-err').textContent = '';
    const res = await fetch('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: $('pin').value }),
    });
    if (res.ok) showApp();
    else $('login-err').textContent = (await res.json()).error || 'Fel PIN-kod.';
  }

  // boot: probe an admin endpoint to see if the cookie is still valid
  fetch('/api/admin/orders').then((r) => (r.ok ? showApp() : showLogin())).catch(showLogin);
})();

// Ichiban Kök — kitchen dashboard.
// New orders arrive over SSE and ring a repeating alarm until every one is accepted.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad3 = (n) => { const s = String(n); return s.length >= 3 ? s : ('000' + s).slice(-3); }; // 3-digit ticket

  // ---------------- languages: staff pick SV / EN / 中文 (remembered on this device) ----------------
  const L = {
    sv: {
      title: 'Ichiban Kök', 'login.hint': 'Ange PIN-kod för att se beställningar', 'login.btn': 'Logga in', 'login.err': 'Fel PIN-kod.',
      'tab.orders': 'Beställningar', 'tab.bookings': 'Bokningar', 'tab.hours': 'Öppettider', conn: 'Anslutning',
      'empty.orders': 'Inga beställningar ännu idag.', 'empty.bookings': 'Inga bokningar.',
      'st.new': 'NY', 'st.accepted': 'Accepterad', 'st.ready': 'Klar', 'st.done': 'Uthämtad', 'st.cancelled': 'Avbruten', 'st.refunded': 'Återbetald',
      'bst.new': 'NY', 'bst.confirmed': 'Bekräftad', 'bst.cancelled': 'Avvisad',
      'btn.accept': '✓ Acceptera', 'btn.decline': 'Avvisa', 'btn.ready': '🍣 Maten är klar', 'btn.cancel': 'Avbryt', 'btn.done': '✓ Uthämtad', 'btn.confirm': '✓ Bekräfta',
      'btn.refund': '↩ Återbetala', 'btn.refund2': 'Tryck igen: återbetala hela beloppet',
      'card.dinein': '🍽 ÄT HÄR · {n} gäster · ankomst {t}', 'card.pickup': '📦 Hämtas {t}', 'card.table': 'Bord reserverat automatiskt — duka och servera vid ankomst',
      'card.received': 'inkom {t}', 'card.paid': '✓ BETALD ONLINE', 'card.unpaid': 'Betalas vid avhämtning',
      'bk.guests': '{n} gäster', 'bk.at': '{d} kl {t}',
      'ntf.order': 'Ny beställning #{n}', 'ntf.orderBody': '{l} rader · {sum} kr · hämtas {t}', 'ntf.booking': 'Ny bordsbokning', 'ntf.bookingBody': '{n} gäster · {d} kl {t}',
      'doc.order': '🔔 NY BESTÄLLNING — Ichiban Kök', 'doc.booking': '🔔 NY BOKNING — Ichiban Kök', 'doc.idle': 'Ichiban Kök — beställningar',
      'sound.btn': '🔔 Aktivera larmljud', 'sound.p': 'Tryck en gång så att surfplattan/telefonen får spela larm när nya beställningar kommer in. Lägg gärna till sidan på hemskärmen.',
      'h.title': 'Stäng restaurangen', 'h.desc': 'En dag eller en period. Inga beställningar eller bokningar tas emot de dagarna, och kunderna får ett meddelande på hemsidan.',
      'h.from': 'Från', 'h.to': 'Till', 'h.msg': 'Meddelande till kunderna (svenska)', 'h.msgEn': 'Message in English (optional)',
      'h.ph': 't.ex. Semesterstängt – vi ses igen den 12 augusti!', 'h.phEn': 'e.g. Closed for holidays – back on 12 August!',
      'h.add': 'Lägg till stängning', 'h.planned': 'Planerade stängningar', 'h.none': 'Inga planerade stängningar. Ordinarie öppettider gäller.',
      'h.closed': 'Stängt {r}', 'h.remove': 'Ta bort', 'h.confirm': 'Ta bort stängningen och öppna som vanligt?', 'err': 'Något gick fel.',
    },
    en: {
      title: 'Ichiban Kitchen', 'login.hint': 'Enter the PIN to see orders', 'login.btn': 'Log in', 'login.err': 'Wrong PIN.',
      'tab.orders': 'Orders', 'tab.bookings': 'Bookings', 'tab.hours': 'Opening hours', conn: 'Connection',
      'empty.orders': 'No orders yet today.', 'empty.bookings': 'No bookings.',
      'st.new': 'NEW', 'st.accepted': 'Accepted', 'st.ready': 'Ready', 'st.done': 'Picked up', 'st.cancelled': 'Cancelled', 'st.refunded': 'Refunded',
      'bst.new': 'NEW', 'bst.confirmed': 'Confirmed', 'bst.cancelled': 'Declined',
      'btn.accept': '✓ Accept', 'btn.decline': 'Decline', 'btn.ready': '🍣 Food is ready', 'btn.cancel': 'Cancel', 'btn.done': '✓ Picked up', 'btn.confirm': '✓ Confirm',
      'btn.refund': '↩ Refund', 'btn.refund2': 'Tap again: refund the full amount',
      'card.dinein': '🍽 DINE IN · {n} guests · arrives {t}', 'card.pickup': '📦 Pickup {t}', 'card.table': 'Table reserved automatically — set it and serve on arrival',
      'card.received': 'received {t}', 'card.paid': '✓ PAID ONLINE', 'card.unpaid': 'Pays at pickup',
      'bk.guests': '{n} guests', 'bk.at': '{d} at {t}',
      'ntf.order': 'New order #{n}', 'ntf.orderBody': '{l} lines · {sum} kr · pickup {t}', 'ntf.booking': 'New table booking', 'ntf.bookingBody': '{n} guests · {d} at {t}',
      'doc.order': '🔔 NEW ORDER — Ichiban Kitchen', 'doc.booking': '🔔 NEW BOOKING — Ichiban Kitchen', 'doc.idle': 'Ichiban Kitchen — orders',
      'sound.btn': '🔔 Enable alarm sound', 'sound.p': 'Tap once so this tablet/phone is allowed to play the alarm when new orders come in. Add the page to the home screen.',
      'h.title': 'Close the restaurant', 'h.desc': 'One day or a period. No orders or bookings are taken on those days, and customers see a notice on the website.',
      'h.from': 'From', 'h.to': 'To', 'h.msg': 'Message to customers (Swedish)', 'h.msgEn': 'Message in English (optional)',
      'h.ph': 'e.g. Semesterstängt – vi ses igen den 12 augusti!', 'h.phEn': 'e.g. Closed for holidays – back on 12 August!',
      'h.add': 'Add closure', 'h.planned': 'Planned closures', 'h.none': 'No planned closures. Regular hours apply.',
      'h.closed': 'Closed {r}', 'h.remove': 'Remove', 'h.confirm': 'Remove this closure and open as usual?', 'err': 'Something went wrong.',
    },
    zh: {
      title: 'Ichiban 厨房', 'login.hint': '输入 PIN 码查看订单', 'login.btn': '登录', 'login.err': 'PIN 码错误。',
      'tab.orders': '订单', 'tab.bookings': '预订', 'tab.hours': '营业时间', conn: '连接',
      'empty.orders': '今天还没有订单。', 'empty.bookings': '没有预订。',
      'st.new': '新', 'st.accepted': '已接单', 'st.ready': '已做好', 'st.done': '已取餐', 'st.cancelled': '已取消', 'st.refunded': '已退款',
      'bst.new': '新', 'bst.confirmed': '已确认', 'bst.cancelled': '已拒绝',
      'btn.accept': '✓ 接单', 'btn.decline': '拒绝', 'btn.ready': '🍣 餐已做好', 'btn.cancel': '取消', 'btn.done': '✓ 已取餐', 'btn.confirm': '✓ 确认',
      'btn.refund': '↩ 退款', 'btn.refund2': '再按一次：全额退款',
      'card.dinein': '🍽 堂食 · {n} 人 · 到店 {t}', 'card.pickup': '📦 取餐 {t}', 'card.table': '已自动预留餐桌 — 客人到店后布置并上菜',
      'card.received': '下单 {t}', 'card.paid': '✓ 已在线支付', 'card.unpaid': '取餐时付款',
      'bk.guests': '{n} 人', 'bk.at': '{d} {t}',
      'ntf.order': '新订单 #{n}', 'ntf.orderBody': '{l} 项 · {sum} kr · 取餐 {t}', 'ntf.booking': '新预订', 'ntf.bookingBody': '{n} 人 · {d} {t}',
      'doc.order': '🔔 新订单 — Ichiban 厨房', 'doc.booking': '🔔 新预订 — Ichiban 厨房', 'doc.idle': 'Ichiban 厨房 — 订单',
      'sound.btn': '🔔 开启提示音', 'sound.p': '点击一次，新订单到达时平板/手机才能播放提示音。建议把此页面添加到主屏幕。',
      'h.title': '关闭餐厅', 'h.desc': '一天或一段时间。这些日子不接受订单和预订，顾客会在网站上看到通知。',
      'h.from': '开始', 'h.to': '结束', 'h.msg': '给顾客的信息（瑞典语）', 'h.msgEn': '英文信息（可选）',
      'h.ph': '例如 Semesterstängt – vi ses igen den 12 augusti!', 'h.phEn': '例如 Closed for holidays – back on 12 August!',
      'h.add': '添加停业', 'h.planned': '计划停业', 'h.none': '没有计划停业。按正常营业时间。',
      'h.closed': '停业 {r}', 'h.remove': '删除', 'h.confirm': '删除此停业并正常营业？', 'err': '出错了。',
    },
  };
  const LOCALE = { sv: 'sv-SE', en: 'en-GB', zh: 'zh-CN' };
  let lang = 'sv';
  try { lang = L[localStorage.getItem('ichiban-admin-lang')] ? localStorage.getItem('ichiban-admin-lang') : 'sv'; } catch {}
  const t = (k, vars) => String((L[lang] && L[lang][k]) || L.sv[k] || k).replace(/\{(\w+)\}/g, (_, v) => (vars && vars[v] !== undefined ? vars[v] : ''));
  const dish = (l) => (lang !== 'sv' && l.name_en ? l.name_en : l.name); // kitchen reads dishes in English when not in Swedish
  function applyStatic() {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    const conn = $('conn'); if (conn) conn.title = t('conn');
    document.querySelectorAll('.langs').forEach((box) => {
      box.innerHTML = ['sv', 'en', 'zh'].map((l) => `<button type="button" data-lang="${l}" class="${l === lang ? 'active' : ''}">${{ sv: 'SV', en: 'EN', zh: '中文' }[l]}</button>`).join('');
    });
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.langs button[data-lang]');
    if (!b) return;
    lang = b.dataset.lang;
    try { localStorage.setItem('ichiban-admin-lang', lang); } catch {}
    applyStatic();
    if (!$('app').hidden) { render(); syncAlarm(); }
  });

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
  // orders ring a bright two-tone chime; table bookings a lower three-note "beep beep beep"
  function beepBurst() {
    if (!audioCtx || audioCtx.state !== 'running') return;
    const t0 = audioCtx.currentTime;
    const newOrders = ordersList.some((o) => o.status === 'new');
    const tones = newOrders ? [880, 1320] : [523, 659, 784];
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.45;
      tones.forEach((f, j) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + j * 0.14);
        g.gain.exponentialRampToValueAtTime(0.28, t + j * 0.14 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + j * 0.14 + 0.13);
        o.connect(g).connect(audioCtx.destination);
        o.start(t + j * 0.14); o.stop(t + j * 0.14 + 0.16);
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
    const newOrders = ordersList.some((o) => o.status === 'new');
    const newBookings = bookings.some((b) => b.status === 'new');
    document.title = newOrders ? t('doc.order') : newBookings ? t('doc.booking') : t('doc.idle');
  }
  function notify(title, body) {
    if (Notification.permission === 'granted') {
      try { new Notification(title, { body, tag: 'ichiban-order', renotify: true }); } catch {}
    }
  }

  // ---------------- rendering ----------------
  const fmtTime = (iso) => new Date(iso).toLocaleTimeString(LOCALE[lang], { hour: '2-digit', minute: '2-digit' });

  function orderCard(o) {
    const st = o.refunded ? t('st.refunded') : (L.sv['st.' + o.status] ? t('st.' + o.status) : o.status);
    // paid online orders get a refund button (tap twice to confirm)
    const refundBtn = o.canRefund ? `<button class="b-cancel b-refund" data-refund="${esc(o.id)}">${t('btn.refund')}</button>` : '';
    const actions = ({
      new: `<button class="b-accept" data-a="accepted">${t('btn.accept')}</button><button class="b-cancel" data-a="cancelled">${t('btn.decline')}</button>`,
      accepted: `<button class="b-ready" data-a="ready">${t('btn.ready')}</button><button class="b-cancel" data-a="cancelled">${t('btn.cancel')}</button>`,
      ready: `<button class="b-done" data-a="done">${t('btn.done')}</button>`,
      done: '', cancelled: '',
    }[o.status] || '') + refundBtn;
    const dinein = o.serviceType === 'dinein';
    return `<div class="card ${o.status === 'new' ? 'new' : ''}" data-id="${esc(o.id)}" data-kind="order">
      <div class="row">
        <span class="num">#${pad3(o.number)}</span>
        <span class="pickup">${esc(dinein ? t('card.dinein', { n: o.guests, t: o.pickup.time }) : t('card.pickup', { t: o.pickup.time }))}</span>
        <span class="st ${esc(o.status)}">${st}</span>
      </div>
      ${dinein ? `<p class="meta" style="color:var(--gold);font-weight:600">${t('card.table')}</p>` : ''}
      <p class="meta">${esc(o.customer.name)} · <a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a> · ${t('card.received', { t: fmtTime(o.createdAt) })}</p>
      <div class="lines">
        ${o.lines.map((l) => `<div><span><span class="q">${l.qty} ×</span> ${esc(dish(l))}${l.option ? ' · ' + esc(l.option) : ''}</span><span>${l.lineTotal} kr</span></div>`).join('')}
      </div>
      ${o.note ? `<div class="note">✎ ${esc(o.note)}</div>` : ''}
      <div class="total"><span>${o.paid ? `<span class="paid">${t('card.paid')}</span>` : `<span class="unpaid">${t('card.unpaid')}</span>`}</span><span>${o.total} kr</span></div>
      <div class="actions">${actions}</div>
    </div>`;
  }

  function bookingCard(b) {
    const st = L.sv['bst.' + b.status] ? t('bst.' + b.status) : b.status;
    const actions = b.status === 'new'
      ? `<button class="b-accept" data-a="confirmed">${t('btn.confirm')}</button><button class="b-cancel" data-a="cancelled">${t('btn.decline')}</button>`
      : '';
    return `<div class="card ${b.status === 'new' ? 'new' : ''}" data-id="${esc(b.id)}" data-kind="booking">
      <div class="row">
        <span class="num">${esc(t('bk.guests', { n: b.guests }))}</span>
        <span class="pickup">${esc(t('bk.at', { d: b.date, t: b.time }))}</span>
        <span class="st ${b.status === 'new' ? 'new' : b.status === 'confirmed' ? 'ready' : ''}">${st}</span>
      </div>
      <p class="meta">${esc(b.name)} · <a href="tel:${esc(b.phone)}">${esc(b.phone)}</a> · ${t('card.received', { t: fmtTime(b.createdAt) })}</p>
      ${b.note ? `<div class="note">✎ ${esc(b.note)}</div>` : ''}
      <div class="actions">${actions}</div>
    </div>`;
  }

  function render() {
    if (tab === 'hours') { renderHours(); return; }
    const list = $('list');
    if (tab === 'orders') {
      const active = ordersList.filter((o) => !['done', 'cancelled'].includes(o.status));
      const rest = ordersList.filter((o) => ['done', 'cancelled'].includes(o.status)).slice(0, 10);
      list.innerHTML = (active.length || rest.length)
        ? active.map(orderCard).join('') + rest.map(orderCard).join('')
        : `<p class="empty">${t('empty.orders')}</p>`;
    } else {
      list.innerHTML = bookings.length ? bookings.map(bookingCard).join('') : `<p class="empty">${t('empty.bookings')}</p>`;
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
    const [o, b, c] = await Promise.all([api('/api/admin/orders'), api('/api/admin/reservations'), api('/api/admin/closures')]);
    ordersList = o.orders; bookings = b.reservations; closures = c.closures || [];
    render();
  }

  // ---------------- opening hours: closed days ----------------
  let closures = [];
  const fmtDay = (iso) => new Date(iso + 'T12:00').toLocaleDateString(LOCALE[lang], { weekday: 'short', day: 'numeric', month: 'short' });
  function closureRange(c) { return c.from === c.to ? fmtDay(c.from) : `${fmtDay(c.from)} – ${fmtDay(c.to)}`; }
  function renderHours() {
    const today = new Date().toISOString().slice(0, 10);
    const listHtml = closures.length
      ? closures.map((c) => `<div class="card closure"><div><div class="when">${esc(t('h.closed', { r: closureRange(c) }))}</div>${c.message ? `<div class="msg">${esc(c.message)}</div>` : ''}</div><button class="del" data-del="${esc(c.id)}">${t('h.remove')}</button></div>`).join('')
      : `<p class="empty">${t('h.none')}</p>`;
    list.innerHTML = `
      <div class="card">
        <div class="num" style="font-size:1.15rem;margin-bottom:0.6rem">${t('h.title')}</div>
        <p class="meta" style="margin-bottom:0.8rem">${t('h.desc')}</p>
        <form class="hours-form" id="closure-form">
          <div class="two">
            <label>${t('h.from')}<input type="date" id="cl-from" min="${today}" required></label>
            <label>${t('h.to')}<input type="date" id="cl-to" min="${today}"></label>
          </div>
          <label>${t('h.msg')}<input id="cl-msg" maxlength="200" placeholder="${esc(t('h.ph'))}"></label>
          <label>${t('h.msgEn')}<input id="cl-msg-en" maxlength="200" placeholder="${esc(t('h.phEn'))}"></label>
          <button type="submit">${t('h.add')}</button>
          <p class="err" id="cl-err"></p>
        </form>
      </div>
      <div class="num" style="font-size:1rem;margin-top:0.4rem">${t('h.planned')}</div>
      ${listHtml}`;
    $('closure-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('cl-err').textContent = '';
      const body = { from: $('cl-from').value, to: $('cl-to').value || $('cl-from').value, message: $('cl-msg').value, message_en: $('cl-msg-en').value };
      const res = await fetch('/api/admin/closures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { $('cl-err').textContent = data.error || t('err'); return; }
      closures = (await api('/api/admin/closures')).closures;
      renderHours();
    });
    list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(t('h.confirm'))) return;
      await fetch(`/api/admin/closures/${b.dataset.del}`, { method: 'DELETE' });
      closures = (await api('/api/admin/closures')).closures;
      renderHours();
    }));
  }
  function connectSSE() {
    if (es) es.close();
    es = new EventSource('/api/admin/stream');
    es.onopen = () => $('conn').classList.add('on');
    es.onerror = () => $('conn').classList.remove('on');
    es.addEventListener('order', (e) => {
      const o = JSON.parse(e.data);
      ordersList.unshift(o);
      notify(t('ntf.order', { n: pad3(o.number) }), t('ntf.orderBody', { l: o.lines.length, sum: o.total, t: o.pickup.time }));
      render();
    });
    es.addEventListener('order-status', () => loadAll().catch(() => {}));
    es.addEventListener('reservation', (e) => {
      const b = JSON.parse(e.data);
      bookings.unshift(b);
      notify(t('ntf.booking'), t('ntf.bookingBody', { n: b.guests, d: b.date, t: b.time }));
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
        refundBtn.textContent = t('btn.refund2');
        refundBtn.style.color = '#fff'; refundBtn.style.background = 'var(--aka)';
        setTimeout(() => { refundBtn.dataset.armed = ''; refundBtn.textContent = t('btn.refund'); refundBtn.style.color = ''; refundBtn.style.background = ''; }, 4000);
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
  const TABS = ['orders', 'bookings', 'hours'];
  TABS.forEach((t) => $('tab-' + t).addEventListener('click', () => {
    tab = t;
    TABS.forEach((x) => $('tab-' + x).classList.toggle('active', x === t));
    render();
  }));

  // clock
  setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString(LOCALE[lang], { hour: '2-digit', minute: '2-digit' }); }, 1000);

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
    else $('login-err').textContent = (await res.json()).error || t('login.err');
  }

  // boot: apply the remembered language, then probe an admin endpoint to see if the cookie is still valid
  applyStatic();
  fetch('/api/admin/orders').then((r) => (r.ok ? showApp() : showLogin())).catch(showLogin);
})();

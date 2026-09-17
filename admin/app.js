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
      'hot.kitchen': 'Varmkök',
      'pause.title': 'Onlinebeställningar', 'pause.on': 'Tar emot beställningar', 'pause.off': 'Pausad — inga onlinebeställningar', 'pause.btnPause': 'Pausa beställningar', 'pause.btnResume': 'Återuppta', 'pause.msg': 'Meddelande till kunderna (valfritt)', 'pause.ph': 't.ex. Vi har mycket att göra — öppnar för beställningar igen snart!',
      'tab.history': 'Historik', 'hist.search': 'Sök nummer, namn, telefon…', 'hist.all': 'Alla', 'hist.none': 'Inga ordrar hittades.',
      'd.placed': 'Lagd', 'd.items': 'Varor', 'd.payment': 'Betalning', 'd.subtotal': 'Delsumma', 'd.vat': 'varav moms (12%)', 'd.total': 'Totalt', 'd.paidAmt': 'Betalt belopp', 'd.paidWith': 'Betalt med', 'd.ref': 'Betalnings-ID', 'd.unpaidNote': 'Betalas vid avhämtning', 'd.contact': 'Kontakt', 'd.delivery': 'Leverans', 'd.address': 'Adress', 'd.activity': 'Orderhändelser', 'd.guests': 'gäster', 'd.eathere': 'Ät här', 'd.pickup': 'Avhämtning',
      'pm.online': 'Kort · Apple Pay · Google Pay', 'pm.swish': 'Swish', 'pm.pickup': 'I restaurangen',
      'ev.created': 'Order mottagen', 'ev.awaiting_payment': 'Väntar på betalning', 'ev.paid': 'Betald', 'ev.new': 'Betald', 'ev.accepted': 'Accepterad', 'ev.ready': 'Klar för avhämtning', 'ev.done': 'Uthämtad', 'ev.cancelled': 'Avbruten', 'ev.refunded': 'Återbetald',
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
      'hot.kitchen': 'Hot kitchen',
      'pause.title': 'Online orders', 'pause.on': 'Accepting orders', 'pause.off': 'Paused — no online orders', 'pause.btnPause': 'Pause orders', 'pause.btnResume': 'Resume', 'pause.msg': 'Message to customers (optional)', 'pause.ph': 'e.g. We are very busy — back to taking orders soon!',
      'tab.history': 'History', 'hist.search': 'Search number, name, phone…', 'hist.all': 'All', 'hist.none': 'No orders found.',
      'd.placed': 'Placed', 'd.items': 'Items', 'd.payment': 'Payment', 'd.subtotal': 'Subtotal', 'd.vat': 'incl. VAT (12%)', 'd.total': 'Total', 'd.paidAmt': 'Amount paid', 'd.paidWith': 'Paid with', 'd.ref': 'Payment ID', 'd.unpaidNote': 'Pays at pickup', 'd.contact': 'Contact', 'd.delivery': 'Delivery', 'd.address': 'Address', 'd.activity': 'Order activity', 'd.guests': 'guests', 'd.eathere': 'Eat here', 'd.pickup': 'Pickup',
      'pm.online': 'Card · Apple Pay · Google Pay', 'pm.swish': 'Swish', 'pm.pickup': 'In the restaurant',
      'ev.created': 'Order received', 'ev.awaiting_payment': 'Awaiting payment', 'ev.paid': 'Paid', 'ev.new': 'Paid', 'ev.accepted': 'Accepted', 'ev.ready': 'Ready for pickup', 'ev.done': 'Picked up', 'ev.cancelled': 'Cancelled', 'ev.refunded': 'Refunded',
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
      'hot.kitchen': '热厨',
      'pause.title': '在线订单', 'pause.on': '正在接单', 'pause.off': '已暂停 — 不接在线订单', 'pause.btnPause': '暂停接单', 'pause.btnResume': '恢复接单', 'pause.msg': '给顾客的信息（可选）', 'pause.ph': '例如：我们很忙 — 稍后恢复接单！',
      'tab.history': '历史', 'hist.search': '搜索编号、姓名、电话…', 'hist.all': '全部', 'hist.none': '未找到订单。',
      'd.placed': '下单', 'd.items': '商品', 'd.payment': '付款', 'd.subtotal': '小计', 'd.vat': '含增值税 (12%)', 'd.total': '合计', 'd.paidAmt': '已付金额', 'd.paidWith': '付款方式', 'd.ref': '付款编号', 'd.unpaidNote': '取餐时付款', 'd.contact': '联系', 'd.delivery': '取餐方式', 'd.address': '地址', 'd.activity': '订单记录', 'd.guests': '人', 'd.eathere': '堂食', 'd.pickup': '取餐',
      'pm.online': '银行卡 · Apple Pay · Google Pay', 'pm.swish': 'Swish', 'pm.pickup': '在餐厅',
      'ev.created': '已收到订单', 'ev.awaiting_payment': '等待付款', 'ev.paid': '已付款', 'ev.new': '已付款', 'ev.accepted': '已接单', 'ev.ready': '可取餐', 'ev.done': '已取餐', 'ev.cancelled': '已取消', 'ev.refunded': '已退款',
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
  let imgById = {}, allOrders = [], detailOrder = null, histQ = '', histSt = '';
  let pauseState = { orderingPaused: false, pauseMessage: '', pauseMessage_en: '' };

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
      ${(() => { const h = o.lines.filter((l) => l.hot); return h.length ? `<div class="hot-banner">🔥 ${t('hot.kitchen')}: ${h.map((l) => `${l.qty}× ${esc(dish(l))}`).join(', ')}</div>` : ''; })()}
      <div class="lines">
        ${o.lines.map((l) => `<div class="${l.hot ? 'line-hot' : ''}"><span>${l.hot ? '🔥 ' : ''}<span class="q">${l.qty} ×</span> ${esc(dish(l))}${l.option ? ' · ' + esc(l.option) : ''}</span><span>${l.lineTotal} kr</span></div>`).join('')}
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
    if (tab === 'history') { if (!$('h-q')) renderHistory(); return; }
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
    const [o, b, c, s] = await Promise.all([api('/api/admin/orders'), api('/api/admin/reservations'), api('/api/admin/closures'), api('/api/admin/settings')]);
    ordersList = o.orders; bookings = b.reservations; closures = c.closures || []; pauseState = s || pauseState;
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
    const paused = pauseState.orderingPaused;
    list.innerHTML = `
      <div class="card">
        <div class="row" style="align-items:center;gap:1rem">
          <div><div class="num" style="font-size:1.1rem">${t('pause.title')}</div>
            <div class="meta" style="margin-top:0.2rem">${paused ? '⏸ ' + t('pause.off') : '🟢 ' + t('pause.on')}</div></div>
          <button id="pause-btn" style="min-width:150px;padding:0.75rem 1.1rem;border-radius:11px;font-weight:700;border:none;font:inherit;font-size:1rem;background:${paused ? 'var(--ok)' : 'var(--aka)'};color:#fff">${paused ? t('pause.btnResume') : t('pause.btnPause')}</button>
        </div>
        <label class="hours-form" id="pause-msg-wrap" style="margin-top:0.8rem;${paused ? '' : 'display:none'}">${t('pause.msg')}<input id="pause-msg" maxlength="200" placeholder="${esc(t('pause.ph'))}" value="${esc(pauseState.pauseMessage || '')}"></label>
      </div>
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
    $('pause-btn').addEventListener('click', async () => {
      const nextPaused = !pauseState.orderingPaused;
      const msg = $('pause-msg') ? $('pause-msg').value : '';
      const res = await fetch('/api/admin/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: nextPaused, message: msg }) });
      pauseState = await res.json();
      renderHours();
    });
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

  // ---------------- shared status/refund actions (live list + detail modal) ----------------
  async function onActionClick(e, after) {
    const refundBtn = e.target.closest('button[data-refund]');
    if (refundBtn) {
      if (!refundBtn.dataset.armed) { // two taps to refund — no blocking confirm()
        refundBtn.dataset.armed = '1'; refundBtn.textContent = t('btn.refund2');
        refundBtn.style.color = '#fff'; refundBtn.style.background = 'var(--aka)';
        setTimeout(() => { refundBtn.dataset.armed = ''; refundBtn.textContent = t('btn.refund'); refundBtn.style.color = ''; refundBtn.style.background = ''; }, 4000);
        return;
      }
      refundBtn.disabled = true;
      try { await api(`/api/admin/orders/${refundBtn.dataset.refund}/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await loadAll(); if (after) await after(); } catch { refundBtn.disabled = false; }
      return;
    }
    const btn = e.target.closest('button[data-a]');
    if (!btn) return;
    const host = btn.closest('.card') || btn.closest('#detail-body');
    const id = btn.dataset.id || (host && host.dataset.id);
    const kind = (btn.dataset.kind || (host && host.dataset.kind)) === 'reservation' ? 'reservations' : 'orders';
    btn.disabled = true;
    try { await api(`/api/admin/${kind}/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: btn.dataset.a }) }); await loadAll(); if (after) await after(); } catch { btn.disabled = false; }
  }
  $('list').addEventListener('click', async (e) => {
    if (e.target.closest('button')) { await onActionClick(e); return; }
    const card = e.target.closest('.card[data-kind="order"]');
    if (card) { const o = ordersList.find((x) => x.id === card.dataset.id) || allOrders.find((x) => x.id === card.dataset.id); if (o) openDetail(o); }
  });
  $('detail-body').addEventListener('click', (e) => onActionClick(e, refreshDetail));
  $('detail-close').addEventListener('click', closeDetail);
  $('detail').addEventListener('click', (e) => { if (e.target === $('detail')) closeDetail(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('detail').hidden) closeDetail(); });

  // ---------------- order detail (Wix-style) ----------------
  const dt = (iso) => new Date(iso).toLocaleString(LOCALE[lang], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  function payLabel(o) { return o.paymentMethod === 'online' ? t('pm.online') : o.paymentMethod === 'swish' ? t('pm.swish') : t('pm.pickup'); }
  function actionBtns(o) {
    const b = [];
    if (o.status === 'new') b.push(`<button class="b-accept" data-a="accepted" data-id="${o.id}" data-kind="order">${t('btn.accept')}</button>`, `<button class="b-cancel" data-a="cancelled" data-id="${o.id}" data-kind="order">${t('btn.decline')}</button>`);
    else if (o.status === 'accepted') b.push(`<button class="b-ready" data-a="ready" data-id="${o.id}" data-kind="order">${t('btn.ready')}</button>`, `<button class="b-cancel" data-a="cancelled" data-id="${o.id}" data-kind="order">${t('btn.cancel')}</button>`);
    else if (o.status === 'ready') b.push(`<button class="b-done" data-a="done" data-id="${o.id}" data-kind="order">${t('btn.done')}</button>`);
    if (o.canRefund) b.push(`<button class="b-cancel b-refund" data-refund="${o.id}">${t('btn.refund')}</button>`);
    return b.join('');
  }
  function detailHtml(o) {
    const dinein = o.serviceType === 'dinein';
    const st = o.refunded ? t('st.refunded') : (L.sv['st.' + o.status] ? t('st.' + o.status) : o.status);
    const vat = Math.round(o.total - o.total / 1.12);
    const items = o.lines.map((l) => `<div class="d-item ${l.hot ? 'hot' : ''}">${imgById[l.id] ? `<img src="/assets/img/menu/${imgById[l.id]}" alt="" loading="lazy">` : ''}<span class="di-q">${l.qty} ×</span><span class="di-name">${l.hot ? '🔥 ' : ''}${esc(dish(l))}${l.option ? ' · ' + esc(l.option) : ''}</span><span class="di-tot">${l.lineTotal} kr</span></div>`).join('');
    const timeline = (o.events || []).map((e) => `<li><span class="tl-ev">${t('ev.' + e.ev) !== 'ev.' + e.ev ? t('ev.' + e.ev) : e.ev}</span><span class="tl-t">${dt(e.t)}</span></li>`).join('');
    const payLine = o.refunded ? `<div class="pay-row total"><span class="pay-unpaid">${t('st.refunded')}</span><span>${o.total} kr</span></div>`
      : o.paid ? `<div class="pay-row total"><span class="pay-paid">✓ ${t('d.paidAmt')}</span><span>${o.total} kr</span></div>`
      : `<div class="pay-row total"><span class="pay-unpaid">${t('d.unpaidNote')}</span><span>${o.total} kr</span></div>`;
    return `
      <div class="d-head"><span class="num">#${pad3(o.number)}</span>
        <span class="st ${o.status}">${st}</span>
        ${o.paid ? `<span class="paid">${t('card.paid')}</span>` : ''}</div>
      <p class="d-placed">${t('d.placed')}: ${dt(o.createdAt)}</p>
      <div class="d-grid">
        <div>
          <div class="d-sec"><h4>${t('d.items')}</h4>${items}</div>
          <div class="d-sec"><h4>${t('d.payment')}</h4>
            <div class="pay-row"><span>${t('d.subtotal')}</span><span>${o.total} kr</span></div>
            <div class="pay-row"><span>${t('d.vat')}</span><span>${vat} kr</span></div>
            ${payLine}
            <div class="pay-row"><span>${t('d.paidWith')}</span><span>${payLabel(o)}</span></div>
            ${o.paymentRef ? `<div class="pay-ref">${t('d.ref')}: ${esc(o.paymentRef)}</div>` : ''}
          </div>
          <div class="d-sec"><h4>${t('d.activity')}</h4><ul class="timeline">${timeline}</ul></div>
        </div>
        <div>
          <div class="d-sec"><h4>${t('d.contact')}</h4>
            <div class="info-row">${esc(o.customer.name)}</div>
            <div class="info-row"><a href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a></div>
            ${o.customer.email ? `<div class="info-row"><a href="mailto:${esc(o.customer.email)}">${esc(o.customer.email)}</a></div>` : ''}
          </div>
          <div class="d-sec"><h4>${t('d.delivery')}</h4>
            <div class="info-row">${dinein ? `${t('d.eathere')} · ${o.guests} ${t('d.guests')}` : t('d.pickup')}</div>
            <div class="info-row">${esc(o.pickup.date)} · ${esc(o.pickup.time)}</div>
            ${!dinein ? `<div class="info-row"><span class="lbl">${t('d.address')}:</span> Södra Vägen 91, Göteborg</div>` : ''}
          </div>
        </div>
      </div>
      <div class="d-actions">${actionBtns(o)}</div>`;
  }
  function openDetail(o) { detailOrder = o; $('detail-body').innerHTML = detailHtml(o); $('detail').hidden = false; }
  function closeDetail() { $('detail').hidden = true; detailOrder = null; }
  async function refreshDetail() {
    if (!detailOrder) return;
    const data = await api(`/api/admin/orders/all?q=${detailOrder.number}&limit=10`).catch(() => null);
    const fresh = data && data.orders.find((x) => x.id === detailOrder.id);
    if (fresh) openDetail(fresh); else closeDetail();
  }

  // ---------------- order history (search + filter) ----------------
  function histRow(o) {
    const st = o.refunded ? t('st.refunded') : (L.sv['st.' + o.status] ? t('st.' + o.status) : o.status);
    const cls = o.status === 'new' ? 'new' : o.status === 'ready' ? 'ready' : o.status === 'accepted' ? 'accepted' : '';
    return `<div class="hrow" data-id="${o.id}"><span class="hnum">#${pad3(o.number)}</span><span class="hmeta"><span class="hname">${esc(o.customer.name)}</span><br><span class="hsub">${dt(o.createdAt)} · ${o.serviceType === 'dinein' ? t('d.eathere') : t('d.pickup')}${o.paid ? ' · ' + t('d.paidAmt').toLowerCase() : ''}</span></span><span class="htot">${o.total} kr</span><span class="st ${cls}">${st}</span></div>`;
  }
  async function loadHistory() {
    const res = $('h-results'); if (!res) return;
    let data; try { data = await api(`/api/admin/orders/all?q=${encodeURIComponent(histQ)}&status=${encodeURIComponent(histSt)}&limit=60`); } catch { return; }
    allOrders = data.orders;
    res.className = '';
    res.innerHTML = allOrders.length ? '<div class="hlist">' + allOrders.map(histRow).join('') + '</div>' : `<p class="muted-center">${t('hist.none')}</p>`;
    res.querySelectorAll('.hrow').forEach((r) => r.addEventListener('click', () => { const o = allOrders.find((x) => x.id === r.dataset.id); if (o) openDetail(o); }));
  }
  function renderHistory() {
    list.innerHTML = `<div class="search-bar">
        <input id="h-q" placeholder="${t('hist.search')}" value="${esc(histQ)}">
        <select id="h-st">
          <option value="">${t('hist.all')}</option>
          <option value="new">${t('st.new')}</option><option value="accepted">${t('st.accepted')}</option>
          <option value="ready">${t('st.ready')}</option><option value="done">${t('st.done')}</option>
          <option value="cancelled">${t('st.cancelled')}</option>
        </select>
      </div>
      <div id="h-results" class="muted-center">…</div>`;
    const q = $('h-q'), sel = $('h-st'); sel.value = histSt;
    let deb; q.addEventListener('input', () => { histQ = q.value; clearTimeout(deb); deb = setTimeout(loadHistory, 250); });
    sel.addEventListener('change', () => { histSt = sel.value; loadHistory(); });
    loadHistory();
  }

  // tabs
  const TABS = ['orders', 'bookings', 'hours', 'history'];
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

  // load menu images once for the order-detail thumbnails
  fetch('/api/menu').then((r) => r.json()).then((m) => { m.categories.forEach((c) => c.items.forEach((it) => { if (it.img) imgById[it.id] = it.img; })); }).catch(() => {});

  // boot: apply the remembered language, then probe an admin endpoint to see if the cookie is still valid
  applyStatic();
  fetch('/api/admin/orders').then((r) => (r.ok ? showApp() : showLogin())).catch(showLogin);
})();

// Ordering app for /bestall: menu with qty controls, cart (localStorage), pickup slots, checkout.
(function () {
  'use strict';

  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kr = (n) => `${n} kr`;
  const lf = (obj, name) => (window.I18N ? window.I18N.field(obj, name) : obj[name] || '');
  const tt = (sv) => (window.I18N ? window.I18N.t(sv) : sv);

  let CONFIG = { onlinePayment: false };
  let MENU = null;
  let ITEM = {};              // id -> item
  let cart = [];              // [{id, qty, option}]
  let slots = { days: [] };
  let selDay = null, selTime = null;
  let serviceType = 'pickup'; // 'pickup' | 'dinein' (order-ahead to the table)

  // ---------- cart persistence ----------
  try { cart = JSON.parse(localStorage.getItem('ichiban-cart') || '[]'); } catch { cart = []; }
  const persist = () => { try { localStorage.setItem('ichiban-cart', JSON.stringify(cart)); } catch {} };

  // Back from Stripe without paying (cancel button or browser back): say so, keep
  // the cart, offer a way out. Nothing has been charged at this point.
  if (new URLSearchParams(location.search).get('cancelled')) {
    const en = window.I18N && window.I18N.lang === 'en';
    const box = document.getElementById('pay-cancelled');
    if (box) {
      box.innerHTML = en
        ? '<b>Payment cancelled.</b> Nothing has been charged. Your dishes are still in the cart — try again whenever you like, or <a href="/">go back to the start page</a>.'
        : '<b>Betalningen avbröts.</b> Inget har dragits. Dina rätter finns kvar i varukorgen — försök igen när du vill, eller <a href="/">gå till startsidan</a>.';
      box.hidden = false;
    }
    history.replaceState(null, '', location.pathname); // a reload shouldn't repeat the notice
  }

  const keyOf = (id, option) => id + (option ? '::' + option : '');
  function addToCart(id, option) {
    const k = keyOf(id, option);
    const line = cart.find((l) => keyOf(l.id, l.option) === k);
    if (line) line.qty = Math.min(50, line.qty + 1);
    else cart.push({ id, qty: 1, option: option || null });
    persist(); renderCart(); syncQtyBadges();
  }
  function removeFromCart(id, option, all) {
    const k = keyOf(id, option);
    const i = cart.findIndex((l) => keyOf(l.id, l.option) === k);
    if (i === -1) return;
    if (all || cart[i].qty <= 1) cart.splice(i, 1);
    else cart[i].qty--;
    persist(); renderCart(); syncQtyBadges();
  }
  const cartTotal = () => cart.reduce((s, l) => s + (ITEM[l.id] ? ITEM[l.id].price * l.qty : 0), 0);
  const cartCount = () => cart.reduce((s, l) => s + l.qty, 0);
  const qtyForItem = (id) => cart.filter((l) => l.id === id).reduce((s, l) => s + l.qty, 0);

  // ---------- menu render ----------
  function itemRow(it) {
    const img = it.img
      ? `<img src="/assets/img/menu/${esc(it.img)}" alt="" loading="lazy">`
      : '<div class="noimg">一番</div>';
    const opts = it.options
      ? `<select class="opt-select" data-id="${esc(it.id)}" aria-label="${esc(lf(it.options, 'label'))}">${it.options.choices.map((c) => `<option>${esc(c)}</option>`).join('')}</select>`
      : '';
    return `<div class="order-item" data-id="${esc(it.id)}">
      ${img}
      <div>
        <h4>${it.star ? '★ ' : ''}${esc(lf(it, 'name'))}</h4>
        ${it.desc ? `<p class="desc">${esc(lf(it, 'desc'))}</p>` : ''}
        <p class="pr">${kr(it.price)}</p>
        ${opts}
      </div>
      <div class="qty-wrap">
        <button class="qty-btn minus" aria-label="Ta bort en ${esc(it.name)}" hidden>−</button>
        <span class="n" hidden>0</span>
        <button class="qty-btn plus" aria-label="Lägg till ${esc(it.name)}">+</button>
      </div>
    </div>`;
  }

  let menuClickBound = false;
  function renderMenu() {
    const root = document.getElementById('order-menu');
    root.innerHTML = MENU.categories.map((cat) => `
      <section class="menu-cat" id="${esc(cat.id)}">
        <div class="cat-title"><h2 style="font-size:1.5rem">${esc(lf(cat, 'name'))}</h2></div>
        ${cat.desc ? `<p class="cat-desc">${esc(lf(cat, 'desc'))}</p>` : ''}
        ${cat.items.map(itemRow).join('')}
      </section>`).join('');
    document.getElementById('cat-nav').innerHTML =
      MENU.categories.map((c) => `<a href="#${esc(c.id)}">${esc(lf(c, 'name'))}</a>`).join('');

    if (menuClickBound) { syncQtyBadges(); return; }
    menuClickBound = true;
    root.addEventListener('click', (e) => {
      const row = e.target.closest('.order-item');
      if (!row) return;
      const id = row.dataset.id;
      const optSel = row.querySelector('.opt-select');
      const option = optSel ? optSel.value : null;
      if (e.target.closest('.plus')) addToCart(id, option);
      if (e.target.closest('.minus')) removeFromCart(id, option, false);
    });
    syncQtyBadges();
  }

  function syncQtyBadges() {
    document.querySelectorAll('.order-item').forEach((row) => {
      const q = qtyForItem(row.dataset.id);
      row.querySelector('.n').textContent = q;
      row.querySelector('.n').hidden = q === 0;
      row.querySelector('.minus').hidden = q === 0;
    });
  }

  // ---------- cart render ----------
  function renderCart() {
    const lines = document.getElementById('cart-lines');
    const total = cartTotal();
    lines.innerHTML = cart.map((l) => {
      const it = ITEM[l.id]; if (!it) return '';
      return `<div class="cart-line">
        <span class="q">${l.qty} ×</span>
        <span>${esc(lf(it, 'name'))}${l.option ? `<span class="opt">${esc(l.option)}</span>` : ''}</span>
        <span style="white-space:nowrap">${kr(it.price * l.qty)} <button class="rm" data-id="${esc(l.id)}" data-opt="${esc(l.option || '')}" aria-label="Ta bort">✕</button></span>
      </div>`;
    }).join('');
    document.getElementById('cart-empty').style.display = cart.length ? 'none' : 'block';
    document.getElementById('cart-total-row').hidden = !cart.length;
    document.getElementById('cart-total').textContent = kr(total);
    document.getElementById('cart-count').textContent = cart.length ? `· ${cartCount()} st` : '';
    document.getElementById('checkout').hidden = !cart.length;

    const bar = document.getElementById('cartbar');
    bar.classList.toggle('has-items', cart.length > 0);
    document.getElementById('cartbar-label').textContent = `Varukorg · ${cartCount()} st`;
    document.getElementById('cartbar-total').textContent = kr(total);

    lines.querySelectorAll('.rm').forEach((b) => b.addEventListener('click', () => removeFromCart(b.dataset.id, b.dataset.opt || null, true)));
  }

  // ---------- pickup slots ----------
  function renderSlotDays() {
    const daysEl = document.getElementById('slot-days');
    daysEl.innerHTML = slots.days.map((d) => `<button type="button" data-date="${esc(d.date)}" class="${d.date === selDay ? 'active' : ''}">${esc(tt(d.label))}</button>`).join('');
    daysEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { selDay = b.dataset.date; selTime = null; renderSlotDays(); renderSlotGrid(); }));
    renderSlotGrid();
  }
  function renderSlotGrid() {
    const day = slots.days.find((d) => d.date === selDay);
    const grid = document.getElementById('slot-grid');
    if (!day) { grid.innerHTML = '<p class="muted">Inga tider tillgängliga just nu.</p>'; return; }
    if (!day.slots.length) { grid.innerHTML = `<p class="muted" style="grid-column:1/-1">${tt('Inga lediga tider den dagen — välj ett annat datum.')}</p>`; return; }
    grid.innerHTML = day.slots.map((s) => {
      const t = typeof s === 'string' ? s : s.time;
      const avail = typeof s === 'string' ? true : s.available;
      return `<button type="button" data-t="${esc(t)}" class="${t === selTime ? 'active' : ''} ${avail ? '' : 'unavail'}" ${avail ? '' : 'disabled'}>${esc(t)}</button>`;
    }).join('');
    grid.querySelectorAll('button:not(.unavail)').forEach((b) => b.addEventListener('click', () => { selTime = b.dataset.t; renderSlotGrid(); }));
  }
  async function loadSlots() {
    // pickup: plain lead-time slots. dine-in: table-capacity-aware slots per day.
    const days = (await (await fetch('/api/pickup-slots')).json()).days;
    if (serviceType === 'dinein') {
      const guests = document.getElementById('f-guests').value;
      for (const d of days) {
        try {
          const cap = await (await fetch(`/api/booking-slots?date=${d.date}&guests=${encodeURIComponent(guests)}`)).json();
          const capMap = new Map(cap.slots.map((s) => [s.time, s.available]));
          // only times that exist in both grids; carry availability from the capacity check
          d.slots = d.slots.filter((t) => capMap.has(t)).map((t) => ({ time: t, available: capMap.get(t) }));
        } catch { d.slots = d.slots.map((t) => ({ time: t, available: true })); }
      }
    }
    slots = { days };
    if (!selDay || !days.some((d) => d.date === selDay)) selDay = days.length ? days[0].date : null;
    renderSlotDays();
  }

  // service type toggle
  document.querySelectorAll('#svc-toggle button').forEach((b) => b.addEventListener('click', () => {
    serviceType = b.dataset.svc;
    document.querySelectorAll('#svc-toggle button').forEach((x) => x.classList.toggle('active', x === b));
    document.getElementById('guests-field').hidden = serviceType !== 'dinein';
    document.getElementById('dinein-note').hidden = serviceType !== 'dinein';
    document.getElementById('slot-label').textContent = serviceType === 'dinein' ? tt('Ankomsttid') : tt('Avhämtningstid');
    selTime = null;
    loadSlots();
  }));
  document.getElementById('f-guests').addEventListener('change', () => { selTime = null; loadSlots(); });

  // ---------- checkout ----------
  function showError(msg) {
    const el = document.getElementById('form-error');
    el.textContent = msg; el.classList.add('show');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  document.getElementById('checkout').addEventListener('submit', async (e) => {
    e.preventDefault();
    document.getElementById('form-error').classList.remove('show');
    if (!cart.length) return showError('Varukorgen är tom.');
    if (!selDay || !selTime) return showError('Välj en avhämtningstid.');
    const btn = document.getElementById('submit-btn');
    btn.disabled = true; btn.textContent = 'Skickar …';
    try {
      const payRadio = document.querySelector('input[name="paymethod"]:checked');
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('f-name').value,
          phone: document.getElementById('f-phone').value,
          email: document.getElementById('f-email').value,
          note: document.getElementById('f-note').value,
          pickupDate: selDay,
          pickupTime: selTime,
          items: cart,
          serviceType,
          guests: serviceType === 'dinein' ? document.getElementById('f-guests').value : undefined,
          paymentMethod: (CONFIG.onlinePayment || CONFIG.swish) && payRadio ? payRadio.value : 'pickup',
          lang: window.I18N ? window.I18N.lang : 'sv',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Något gick fel — försök igen.');
      // Keep the cart until the payment is actually done: if the customer backs out of
      // Stripe (or just wanted to look), /bestall still has their dishes. The
      // confirmation page clears it.
      if (!data.payUrl) { cart = []; persist(); }
      // online payment: hand over to Stripe's hosted checkout; otherwise straight to confirmation
      location.href = data.payUrl || `/order?id=${encodeURIComponent(data.id)}&token=${encodeURIComponent(data.token)}`;
    } catch (err) {
      showError(err.message);
      btn.disabled = false; btn.textContent = 'Skicka beställning';
      loadSlots(); // times may have expired while typing
    }
  });

  // mobile cart sheet
  const bar = document.getElementById('cartbar');
  const cartEl = document.getElementById('cart');
  function toggleSheet() {
    const open = cartEl.classList.toggle('sheet-open');
    let scrim = document.querySelector('.sheet-scrim');
    if (open && !scrim) {
      scrim = document.createElement('div');
      scrim.className = 'sheet-scrim';
      scrim.addEventListener('click', toggleSheet);
      document.body.appendChild(scrim);
    } else if (!open && scrim) scrim.remove();
  }
  bar.addEventListener('click', toggleSheet);
  bar.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') toggleSheet(); });

  // ---------- boot ----------
  fetch('/api/config').then((r) => r.json()).then((cfg) => {
    CONFIG = cfg;
    const anyOnline = cfg.onlinePayment || cfg.swish;
    document.getElementById('pay-field').hidden = !anyOnline;
    document.getElementById('pay-online').hidden = !cfg.onlinePayment;
    document.getElementById('pay-swish').hidden = !cfg.swish;
    // preselect the most local option: Swish first, then card, then in-restaurant
    const prefer = cfg.swish ? 'swish' : cfg.onlinePayment ? 'online' : 'pickup';
    const radio = document.querySelector(`input[name="paymethod"][value="${prefer}"]`);
    if (radio) radio.checked = true;
  }).catch(() => {});

  fetch('/api/menu').then((r) => r.json()).then((menu) => {
    MENU = menu;
    for (const c of menu.categories) for (const it of c.items) ITEM[it.id] = it;
    renderMenu(); renderCart();
    if (window.I18N) window.I18N.onChange(() => { renderMenu(); renderCart(); renderSlotDays(); });
    return loadSlots();
  }).catch(() => {
    document.getElementById('order-menu').innerHTML =
      '<p class="muted">Beställningen är inte tillgänglig just nu — ring oss på <a href="tel:+4631831786">031-83 17 86</a> så hjälper vi dig direkt.</p>';
  });
  setInterval(loadSlots, 5 * 60 * 1000); // keep slot list fresh
})();

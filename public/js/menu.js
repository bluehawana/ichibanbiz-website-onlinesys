// Read-only menu renderer for /meny — data from /api/menu (falls back to /data/menu.json).
(function () {
  'use strict';

  const JP = {
    forratter: '前菜', 'sushi-combo': '寿司', 'veg-sushi': '野菜寿司', poke: 'ポケ', varmratter: '温料理',
    'egen-kombo': 'コンボ', 'nigiri-combo': '握り', 'nigiri-styckvis': '握り', 'nori-maki': '海苔巻き',
    uramaki: '裏巻き', 'deluxe-roll': '特上', 'dynamite-roll': '揚げ巻き', 'rispapper-roll': '生春巻き',
    sashimi: '刺身', 'hoso-maki': '細巻き', 'barn-sushi': '子供', 'fest-meny': '宴会', dryck: '飲み物', extra: '追加',
  };
  const LIST_STYLE = new Set(['dryck', 'extra', 'nigiri-styckvis', 'egen-kombo']);

  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lf = (obj, name) => (window.I18N ? window.I18N.field(obj, name) : obj[name] || '');
  const TAG_EN = { stark: 'spicy', vegetarisk: 'vegetarian', vegansk: 'vegan', glutenfri: 'gluten-free' };
  const tagLabel = (x) => (window.I18N && window.I18N.lang === 'en' && TAG_EN[x]) || x;
  const tagsHtml = (t) => (t && t.length) ? `<div class="tags">${t.map((x) => `<span class="tag ${esc(x)}">${esc(tagLabel(x))}</span>`).join('')}</div>` : '';

  function cardHtml(it) {
    const img = it.img ? `<img class="photo" src="/assets/img/menu/${esc(it.img)}" alt="${esc(lf(it, 'name'))}" loading="lazy">` : '';
    return `<div class="dish-card">${img}<div class="body">
      <div class="row"><h3>${it.star ? '★ ' : ''}${esc(lf(it, 'name'))}</h3><span class="price">${it.price} kr</span></div>
      ${it.desc ? `<p class="desc">${esc(lf(it, 'desc'))}</p>` : ''}
      ${tagsHtml(it.tags)}
    </div></div>`;
  }
  function lineHtml(it) {
    return `<div class="menu-line"><span class="nm">${esc(lf(it, 'name'))}${it.desc ? `<span class="desc">${esc(lf(it, 'desc'))}</span>` : ''}</span><span class="dots"></span><span class="price">${it.price} kr</span></div>`;
  }

  function render(menu) {
    const root = document.getElementById('menu-root');
    const nav = document.getElementById('cat-nav');
    root.innerHTML = menu.categories.map((cat) => {
      const inner = LIST_STYLE.has(cat.id)
        ? `<div class="menu-list">${cat.items.map(lineHtml).join('')}</div>`
        : `<div class="grid-3">${cat.items.map(cardHtml).join('')}</div>`;
      return `<section class="menu-cat" id="${esc(cat.id)}">
        <div class="cat-title"><h2>${esc(lf(cat, 'name'))}</h2><span class="jp">${JP[cat.id] || ''}</span></div>
        ${cat.desc ? `<p class="cat-desc">${esc(lf(cat, 'desc'))}</p>` : ''}
        ${inner}
      </section>`;
    }).join('');
    nav.innerHTML = menu.categories.map((c) => `<a href="#${esc(c.id)}">${esc(lf(c, 'name'))}</a>`).join('');

    // active category highlight while scrolling
    const links = [...nav.querySelectorAll('a')];
    const sections = [...root.querySelectorAll('.menu-cat')];
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          links.forEach((l) => l.classList.toggle('active', l.getAttribute('href') === '#' + e.target.id));
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    sections.forEach((s) => obs.observe(s));
  }

  fetch('/api/menu').then((r) => (r.ok ? r.json() : fetch('/data/menu.json').then((r2) => r2.json())))
    .then((menu) => {
      render(menu);
      if (window.I18N) window.I18N.onChange(() => render(menu));
    })
    .catch(() => { document.getElementById('menu-root').innerHTML = '<p class="muted">Menyn kunde inte laddas just nu — ring oss gärna på <a href="tel:+46000000000">000-00 00 00</a>.</p>'; });
})();

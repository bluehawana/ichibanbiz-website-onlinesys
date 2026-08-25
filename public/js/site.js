// Shared site behaviour: mobile nav, today's opening hours highlight, footer year.
(function () {
  'use strict';

  // ---------- mobile navigation: slide-in panel ----------
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.nav');
  if (toggle && nav) {
    const en = () => window.I18N && window.I18N.lang === 'en';
    const mq = window.matchMedia('(max-width: 860px)');
    const scrim = document.createElement('div');
    scrim.className = 'nav-scrim';
    document.body.appendChild(scrim);

    // panel chrome (only visible on phones): title + close button, contact at the bottom
    const head = document.createElement('div');
    head.className = 'nav-head';
    head.innerHTML = '<span class="label">' + (en() ? 'Menu' : 'Meny') + '</span><div class="nav-tools"><button type="button" class="nav-close" aria-label="Stäng meny">&times;</button></div>';
    nav.prepend(head);
    const foot = document.createElement('div');
    foot.className = 'nav-foot';
    foot.innerHTML = 'Södra Vägen 91, Göteborg<br><a href="tel:+4631831786">031-83 17 86</a>';
    nav.append(foot);
    const closeBtn = head.querySelector('.nav-close');
    let lastFocus = null;

    // The header's backdrop-filter makes it the containing block for fixed
    // descendants, which would squash the panel to header height — so on phones
    // the <nav> lives directly in <body>, and goes back into the bar on desktop.
    const slot = document.createComment('nav');
    toggle.after(slot);
    function place() {
      const lang = document.getElementById('lang-toggle'); // created by i18n.js
      if (mq.matches) {
        document.body.appendChild(nav);
        if (lang) head.querySelector('.nav-tools').prepend(lang); // language switch lives in the panel on phones
      } else {
        slot.after(nav);
        if (lang) toggle.before(lang);
      }
    }
    place();
    document.addEventListener('DOMContentLoaded', place); // i18n.js injects the language button on this event, before us

    const focusables = () => Array.from(nav.querySelectorAll('a[href], button')).filter((el) => el.offsetParent !== null);
    function open() {
      lastFocus = document.activeElement;
      nav.classList.add('open'); scrim.classList.add('show'); document.body.classList.add('nav-open');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', en() ? 'Close menu' : 'Stäng meny');
      setTimeout(() => closeBtn.focus(), 60);
    }
    function close(restore = true) {
      if (!nav.classList.contains('open')) return;
      nav.classList.remove('open'); scrim.classList.remove('show'); document.body.classList.remove('nav-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', en() ? 'Open menu' : 'Öppna meny');
      if (restore && lastFocus && lastFocus.focus) lastFocus.focus();
    }
    toggle.addEventListener('click', () => (nav.classList.contains('open') ? close() : open()));
    closeBtn.addEventListener('click', () => close());
    scrim.addEventListener('click', () => close());
    nav.addEventListener('click', (e) => { if (e.target.closest('a[href]') && mq.matches) close(false); });
    document.addEventListener('keydown', (e) => {
      if (!nav.classList.contains('open')) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') { // keep focus inside the panel
        const f = focusables(); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    mq.addEventListener('change', () => { close(false); place(); });
  }

  // Opening hours: highlight today's row + show today's hours in the hero.
  const HOURS = { 1: '11:00–20:00', 2: '11:00–20:00', 3: '11:00–20:00', 4: '11:00–20:00', 5: '11:00–21:00', 6: '13:00–21:00', 0: '15:00–21:00' };
  const dow = new Date().getDay();
  const todayEl = document.getElementById('today-hours');
  if (todayEl) todayEl.textContent = HOURS[dow];
  document.querySelectorAll('#hours-table tr').forEach((tr) => {
    const days = (tr.dataset.days || '').split(',');
    if (days.includes(String(dow))) tr.classList.add('today');
  });

  const y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());

  // Google review section: shown only when the server has a place id configured
  const reviewSection = document.getElementById('review-section');
  if (reviewSection) {
    fetch('/api/config').then((r) => r.json()).then((cfg) => {
      if (cfg.reviewUrl) {
        document.getElementById('review-link').href = cfg.reviewUrl;
        reviewSection.hidden = false;
      }
    }).catch(() => {});
  }
})();

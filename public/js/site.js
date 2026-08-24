// Shared site behaviour: mobile nav, today's opening hours highlight, footer year.
(function () {
  'use strict';

  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!nav.contains(e.target) && !toggle.contains(e.target)) nav.classList.remove('open');
    });
  }

  // Opening hours: highlight today's row + show today's hours in the hero.
  const HOURS = { 1: '11:00–20:00', 2: '11:00–20:00', 3: '11:00–20:00', 4: '11:00–20:00', 5: '11:00–21:00', 6: '12:00–21:00', 0: '15:00–21:00' };
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

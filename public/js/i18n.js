// Lightweight SV/EN switcher.
// Swedish is the authored language. The EN dictionary maps exact Swedish strings
// (short UI strings, matched per text node) plus data-i18n keys for long prose.
(function () {
  'use strict';

  const STRINGS = {
    // navigation & chrome
    'Hem': 'Home', 'Meny': 'Menu', 'Boka bord': 'Book a table', 'Om oss': 'About us',
    'Beställ avhämtning': 'Order pickup', 'Hoppa till innehåll': 'Skip to content',
    'Göteborg · Södra Vägen 91': 'Gothenburg · Södra Vägen 91',
    'Integritetspolicy': 'Privacy policy', 'Till startsidan': 'Back to start',
    // hero & home
    'Bästa sushin nära Liseberg': 'The best sushi near Liseberg',
    'Se hela menyn': 'View full menu', 'Öppet idag': 'Open today', 'Adress': 'Address', 'Telefon': 'Phone',
    'Populärast just nu': 'Most popular right now', 'Husets favoriter': 'House favourites',
    'Lax poké': 'Salmon poké', '12 bitar sushi': '12 pieces sushi',
    'Ponzumarinerad lax, avokado, mango, edamame och sushiris toppad med chilimajonnäs.': 'Ponzu-marinated salmon, avocado, mango, edamame and sushi rice topped with chili mayo.',
    'Toppad rulle med lax, avokado, chilimajonnäs och kimchisesam. 10 bitar.': 'Topped roll with salmon, avocado, chili mayo and kimchi sesame. 10 pieces.',
    'Nigiri med lax, räka och flamberad lax samt california- och laxmaki.': 'Nigiri with salmon, shrimp and flamed salmon plus California and salmon maki.',
    'Koreansk risskål med nötkött, stekt ägg, kimchi och grönsaker.': 'Korean rice bowl with beef, fried egg, kimchi and vegetables.',
    'Bläddra i menyn och fyll varukorgen. Vegetariskt, veganskt och glutenfritt är tydligt markerat.': 'Browse the menu and fill your cart. Vegetarian, vegan and gluten-free are clearly marked.',
    'Välj en avhämtningstid som passar dig — tidigast 30 minuter efter beställning.': 'Choose a pickup time that suits you — earliest 30 minutes after ordering.',
    'Maten är nylagad när du kommer. Betala i restaurangen med kort eller Swish.': 'Your food is freshly made when you arrive. Pay in the restaurant by card or Swish.',
    'Södra Vägen 91, 412 63 Göteborg': 'Södra Vägen 91, 412 63 Gothenburg',
    'Södra Vägen 91, Göteborg': 'Södra Vägen 91, Gothenburg',
    'Hela menyn →': 'Full menu →', 'Avhämtning': 'Pickup',
    'Beställ online — hämta när det passar dig': 'Order online — pick up when it suits you',
    '1 · Välj dina rätter': '1 · Choose your dishes', '2 · Välj tid': '2 · Choose a time',
    '3 · Hämta & betala': '3 · Pick up & pay',
    'Starta en beställning': 'Start an order', 'Hitta hit': 'Find us',
    'Mitt emellan Liseberg och World of Volvo': 'Right between Liseberg and World of Volvo',
    'Kontakt': 'Contact', 'Öppettider': 'Opening hours', 'Karta': 'Map',
    'Öppna i Google Maps →': 'Open in Google Maps →',
    'Vi håller stängt den dagen — välj ett annat datum.': 'We are closed that day — please pick another date.',
    'Vi håller stängt den dagen.': 'We are closed that day.',
    'Mån–tor': 'Mon–Thu', 'Fredag': 'Friday', 'Lördag': 'Saturday', 'Söndag': 'Sunday',
    'E-post': 'Email', 'Sidor': 'Pages',
    'Spårvagn till hållplats Getebergsäng — 2 minuters promenad.': 'Tram to Getebergsäng — a 2-minute walk.',
    'Familjeägd sushirestaurang i Göteborg sedan 2017. Bland stadens fem bästa — enligt våra gäster.': 'Family-run sushi restaurant in Gothenburg since 2017. Among the city\'s top five — according to our guests.',
    'Familjeägd sushirestaurang i Göteborg sedan 2017.': 'Family-run sushi restaurant in Gothenburg since 2017.',
    'いらっしゃいませ — Välkommen!': 'いらっしゃいませ — Welcome!',
    // menu page
    'Hela vår meny': 'Our full menu', 'Laddar menyn …': 'Loading the menu …',
    // order page
    'Beställ online': 'Order online',
    'Varukorg': 'Cart', 'Din varukorg är tom — lägg till något gott från menyn.': 'Your cart is empty — add something tasty from the menu.',
    'Summa': 'Total', 'Namn': 'Name', 'Ditt namn': 'Your name', 'Mobilnummer': 'Mobile number',
    'Avhämtningstid': 'Pickup time', 'Ankomsttid': 'Arrival time', 'Skicka beställning': 'Place order',
    'Hur vill du äta?': 'How would you like to eat?',
    'Ta med': 'Takeaway', 'Ät här': 'Eat here',
    'Förbeställ till bordet: vi reserverar ett bord och börjar laga maten innan ni kommer — den serveras några minuter efter att ni satt er.': 'Order ahead to your table: we reserve a table and start preparing your food before you arrive — it is served minutes after you sit down.',
    'Betalning': 'Payment', 'Betala online (kort)': 'Pay online (card)', 'Betala vid avhämtning': 'Pay at pickup',
    'Betala i restaurangen': 'Pay in the restaurant',
    '— betalförfrågan till din mobil': '— payment request to your phone',
    'Inga kortuppgifter sparas hos oss — Swish godkänns i din app, kortbetalning sker på Stripes säkra sida.': 'No card details are stored with us — Swish is approved in your app, card payments happen on Stripe\'s secure page.',
    'E-post för digitalt kvitto': 'Email for digital receipt',
    '(valfritt)': '(optional)',
    'Meddelande till köket': 'Message to the kitchen',
    'Meddelande': 'Message',
    'namn@example.com': 'name@example.com',
    'Allergier, önskemål …': 'Allergies, requests …',
    // reviews
    'Nöjd med maten och besöket?': 'Happy with your food and visit?',
    'Ett omdöme på Google betyder mycket för en liten familjerestaurang — det tar bara en halv minut.': 'A Google review means a lot to a small family restaurant — it only takes half a minute.',
    'Lämna ett omdöme på Google': 'Leave a review on Google',
    // booking page
    'Välj en ledig tid': 'Choose an available time',
    'Välj en ledig tid.': 'Choose an available time.',
    'E-post för bekräftelse': 'Email for confirmation',
    'Inga lediga tider den dagen — välj ett annat datum.': 'No available times that day — please pick another date.',
    'Kunde inte hämta tider — försök igen.': 'Could not load times — please try again.',
    'gäster': 'guests',
    'Mottagen — vi bekräftar strax': 'Received — we will confirm shortly',
    'Den här sidan uppdateras när restaurangen bekräftat bordet. Välkommen!': 'This page updates when the restaurant confirms your table. Welcome!',
    'Fira, ät och umgås hos oss': 'Celebrate, eat and enjoy with us',
    'Antal gäster': 'Number of guests', 'Datum': 'Date', 'Tid': 'Time',
    'Skicka bokningsförfrågan': 'Send booking request', 'Tack för din bokning!': 'Thank you for your booking!',
    'Barnstol, allergi, firande …': 'High chair, allergy, celebration …',
    'Vi hör av oss om tiden inte skulle fungera. Välkommen!': 'We\'ll contact you if the time doesn\'t work. Welcome!',
    // about page
    'Om oss.': 'About us.', 'Två personer, en passion — sedan 2017': 'Two people, one passion — since 2017',
    'Noggrant utvalda råvaror': 'Carefully selected ingredients',
    'Vi väljer våra råvaror med omsorg — färsk fisk och grönsaker av hög kvalitet, varje dag.': 'We choose our ingredients with care — fresh fish and quality vegetables, every day.',
    'Något för alla': 'Something for everyone',
    'Stort utbud av vegetariska, veganska och glutenfria rätter — tydligt markerat i menyn.': 'A wide range of vegetarian, vegan and gluten-free dishes — clearly marked in the menu.',
    'Nära Liseberg': 'Close to Liseberg',
    'Södra Vägen 91, ett stenkast från Liseberg och World of Volvo. Perfekt före eller efter besöket.': 'Södra Vägen 91, a stone\'s throw from Liseberg and World of Volvo. Perfect before or after your visit.',
    // misc
    'Meddelande till köket (valfritt)': 'Message to the kitchen (optional)',
    'Meddelande (valfritt)': 'Message (optional)',
    'Idag': 'Today', 'Imorgon': 'Tomorrow',
  };

  // long prose paragraphs keyed by data-i18n
  const PROSE = {
    'hero.lead': 'Our ingredients are carefully selected quality products. Sushi, poké bowls, bibimbap and dumplings — dine with us or take away.',
    'order.lead': 'Add dishes, choose a pickup time and pay when you collect — or pay online by card. Earliest pickup is 30 minutes after ordering.',
    'order.paynote': 'Show your order number at the counter. Pay in the restaurant by card or Swish — or online if you chose card payment.',
    'menu.lead': 'Serving hours: Mon–Thu 11–20, Fri 11–21, Sat 13–21, Sun 15–21. Everything can also be ordered for pickup.',
    'boka.lead': 'Fill in your details and we\'ll find the best table for you. We\'ll call if the time needs adjusting. For groups larger than 8 — call us at 031-83 17 86.',
    'om.p1': 'Welcome to Ichiban Sushi — a restaurant run by the couple Hongzhi and Yan. Our journey began in China, where we married and shared a passion for good food. In 2016 we moved to Gothenburg, where Hongzhi took a second master\'s degree at the University of Gothenburg.',
    'om.p2': 'In 2017 we took over the charming Ichiban Sushi Bar on Södra Vägen, driven by our love of Asian cuisine and the ambition to create a truly great dining experience. Through hard work and uncompromising quality we reached Gothenburg\'s top five sushi restaurants within four years — growing 15% per year between 2017 and 2020.',
    'om.p3': 'Today we keep evolving, working with partners like Zettle, Uber Eats, Foodora and Wolt. But what matters most is unchanged: that you find your favourite dish here and enjoy your time at the table. Your happiness is our pride.',
  };

  let lang = 'sv';
  try { lang = localStorage.getItem('ichiban-lang') || (navigator.language && !navigator.language.startsWith('sv') ? 'en' : 'sv'); } catch {}
  const listeners = [];

  function walkTextNodes(fn) {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && !['SCRIPT', 'STYLE'].includes(n.parentElement.tagName) && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    nodes.forEach(fn);
  }

  function apply() {
    document.documentElement.lang = lang;
    walkTextNodes((n) => {
      if (n.__sv === undefined) n.__sv = n.nodeValue;
      const key = n.__sv.trim();
      if (lang === 'en' && STRINGS[key]) n.nodeValue = n.__sv.replace(key, STRINGS[key]);
      else if (lang === 'sv') n.nodeValue = n.__sv;
    });
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      if (el.__sv === undefined) el.__sv = el.innerHTML;
      const k = el.dataset.i18n;
      if (lang === 'en' && PROSE[k]) el.innerHTML = PROSE[k];
      else if (lang === 'sv') el.innerHTML = el.__sv;
    });
    document.querySelectorAll('[placeholder]').forEach((el) => {
      if (el.__svph === undefined) el.__svph = el.placeholder;
      el.placeholder = lang === 'en' && STRINGS[el.__svph] ? STRINGS[el.__svph] : el.__svph;
    });
    const btn = document.getElementById('lang-toggle');
    if (btn) btn.textContent = lang === 'sv' ? 'EN' : 'SV';
    listeners.forEach((cb) => { try { cb(lang); } catch {} });
  }

  function setLang(l) {
    lang = l;
    try { localStorage.setItem('ichiban-lang', l); } catch {}
    apply();
  }

  // inject the toggle into the header
  function injectToggle() {
    const bar = document.querySelector('.site-head .bar');
    if (!bar || document.getElementById('lang-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'lang-toggle';
    btn.setAttribute('aria-label', 'Byt språk / Switch language');
    btn.style.cssText = 'background:none;border:1px solid var(--line);color:var(--ink-dim);border-radius:999px;padding:0.4rem 0.8rem;font:inherit;font-size:0.82rem;font-weight:700;letter-spacing:0.08em;cursor:pointer';
    btn.addEventListener('click', () => setLang(lang === 'sv' ? 'en' : 'sv'));
    const toggle = bar.querySelector('.nav-toggle');
    bar.insertBefore(btn, toggle || null);
  }

  window.I18N = {
    get lang() { return lang; },
    t: (sv) => (lang === 'en' && STRINGS[sv]) || sv,
    field: (obj, name) => (lang === 'en' && obj[name + '_en']) || obj[name] || '',
    onChange: (cb) => listeners.push(cb),
    refresh: apply,
  };

  document.addEventListener('DOMContentLoaded', () => { injectToggle(); apply(); });
  if (document.readyState !== 'loading') { injectToggle(); apply(); }
})();

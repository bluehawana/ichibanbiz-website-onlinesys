#!/usr/bin/env node
// Adds name_en / desc_en fields to public/data/menu.json (idempotent).
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'data', 'menu.json');
const menu = JSON.parse(fs.readFileSync(FILE, 'utf8'));

const CATS = {
  forratter: ['Starters', null],
  'sushi-combo': ['Sushi combo', 'Served with pickled ginger, pickled red onion, seaweed salad, wasabi and soy sauce.'],
  'veg-sushi': ['Vegetarian sushi', 'Served with pickled ginger, pickled red onion, seaweed salad, wasabi and soy sauce.'],
  poke: ['Poké bowls', null],
  varmratter: ['Hot dishes', null],
  'egen-kombo': ['Build your own combo', 'Choose two of the following: 5 pcs sushi (1 salmon, 1 shrimp, 1 avocado, 2 rolls), chicken/vegetarian dumplings, yakitori or yakiniku. Served with rice.'],
  'nigiri-combo': ['Nigiri combo', null],
  'nigiri-styckvis': ['Nigiri by the piece', null],
  'nori-maki': ['Norimaki', '10 pcs, nori on the outside'],
  uramaki: ['Uramaki', '10 pcs, inside-out roll'],
  'deluxe-roll': ['Deluxe rolls', '10 pcs, topped rolls'],
  'dynamite-roll': ['Dynamite rolls', '10 pcs, deep-fried rolls'],
  'rispapper-roll': ['Rice paper rolls', '10 pcs, salad rolls'],
  sashimi: ['Sashimi', null],
  'hoso-maki': ['Hosomaki', '8 pcs, thin rolls'],
  'barn-sushi': ["Kids' sushi", null],
  'fest-meny': ['Party platter', null],
  dryck: ['Drinks', null],
  extra: ['Extras', null],
};

const ITEMS = {
  wakame: ['Wakame seaweed salad', null],
  kimchi: ['Kimchi', null],
  edamame: ['Edamame', null],
  'mini-varrullar': ['Mini spring rolls', '8 vegetarian spring rolls with sweet chili sauce'],
  'ebi-fry': ['Ebi fry', '4 deep-fried shrimp with sweet chili sauce'],
  gyoza: ['Crispy gyoza dumplings', '4 fried chicken dumplings with sweet chili sauce'],
  'golden-chicken': ['Golden chicken', 'Fried chicken pops with sweet chili sauce'],
  'lax-sallad': ['Salmon salad', 'Salmon, cucumber, salad, ponzu, sesame seeds'],
  'fry-mix': ['Fry mix', '2 fried shrimp, 2 fried dumplings and 4 fried spring rolls, served with sweet chili sauce and chili mayo'],
  'sushi-8': ['8 pieces sushi', 'Nigiri: 2 salmon, 1 shrimp, 1 avocado · Rolls: 4 California and salmon maki'],
  'sushi-10': ['10 pieces sushi', 'Nigiri: 2 salmon, 2 shrimp, 1 avocado · Rolls: 5 California and salmon maki'],
  'sushi-12': ['12 pieces sushi', 'Nigiri: 3 salmon, 2 shrimp, 1 flamed salmon, 1 avocado · Rolls: 5 California and salmon maki'],
  'sushi-15': ['15 pieces sushi', 'Nigiri: 3 salmon, 2 shrimp, 1 tuna, 1 tilapia, 1 flamed salmon, 1 avocado · Rolls: 6 California and salmon maki'],
  'familje-40': ['Family sushi, 40 pieces', 'Nigiri: 4 salmon, 4 flamed salmon, 2 tuna, 2 tilapia, 4 shrimp, 4 avocado · Rolls: 10 crispy ebi roll, 10 dragon roll'],
  'veg-sushi-8': ['8 pieces vegetarian sushi', 'Nigiri: 2 tofu, 1 avocado, 1 omelette · Rolls: 4 vegetarian roll'],
  'veg-sushi-10': ['10 pieces vegetarian sushi', 'Nigiri: 2 tofu, 1 avocado, 1 omelette, 1 portobello · Rolls: 5 vegetarian roll'],
  'veg-sushi-12': ['12 pieces vegetarian sushi', 'Nigiri: 3 avocado, 2 tofu, 1 omelette, 1 portobello · Rolls: 5 vegetarian roll'],
  'lax-poke': ['Salmon poké', 'Ponzu-marinated salmon, avocado, mango, cucumber, edamame beans, seaweed salad, pickled red onion, sushi rice, topped with chili mayo and sesame seeds'],
  'veg-poke': ['Vegetarian poké', 'Tofu, avocado, mango, cucumber, edamame beans, seaweed salad, pickled red onion, sushi rice, topped with your choice of sauce and sesame seeds. (The sesame dressing contains peanuts.)'],
  'prawn-poke': ['Prawn poké', '5 sushi shrimp, avocado, mango, cucumber, edamame beans, seaweed salad, pickled red onion, sushi rice, topped with chili mayo and sesame seeds'],
  'kyckling-poke': ['Chicken poké', 'Fried chicken, avocado, mango, cucumber, edamame beans, seaweed salad, pickled red onion, sushi rice, topped with chili mayo and sesame seeds'],
  'krispig-ebi-poke': ['Crispy ebi poké', 'Fried shrimp (4 pcs), avocado, mango, cucumber, edamame beans, seaweed salad, pickled red onion, sushi rice, topped with chili mayo and sesame seeds'],
  yakitori: ['Yakitori', 'Chicken skewers with teriyaki sauce, served with rice and salad'],
  yakiniku: ['Yakiniku', 'Thinly sliced beef with teriyaki sauce, served with rice and salad'],
  'kyckling-dumplings': ['Chicken dumplings', '10 fried chicken dumplings, served with rice, sweet chili sauce and salad'],
  'veg-dumplings': ['Vegetarian dumplings', '10 fried vegetarian dumplings, served with rice, sweet chili sauce and salad'],
  bibimbap: ['Bibimbap', 'Rice with sautéed beef, fried egg, kimchi, cucumber, carrot, red pepper, red cabbage and bibimbap sauce'],
  'veg-bibimbap': ['Vegetarian bibimbap', 'Rice with sautéed tofu, fried egg, kimchi, cucumber, carrot, red pepper, red cabbage and bibimbap sauce'],
  'kombo-yakiniku-yakitori': ['Yakiniku with yakitori', null],
  'kombo-yakiniku-sushi': ['Yakiniku with sushi', null],
  'kombo-yakitori-sushi': ['Yakitori with sushi', null],
  'kombo-dumplings-sushi': ['Chicken dumplings with sushi', null],
  'kombo-dumplings-yakiniku': ['Chicken dumplings with yakiniku', null],
  'kombo-dumplings-yakitori': ['Chicken dumplings with yakitori', null],
  'kombo-veg-dumplings-sushi': ['Vegetarian dumplings with sushi', null],
  'nigiri-10-lax-avokado': ['10 pieces salmon & avocado', '5 salmon and 5 avocado'],
  'nigiri-12-lax-avokado': ['12 pieces salmon & avocado', '6 salmon and 6 avocado'],
  'flamberad-8': ['8 pieces flamed salmon', 'Flamed salmon with yaki sauce, chili mayo and kimchi sesame'],
  'flamberad-10': ['10 pieces flamed salmon', 'Flamed salmon with yaki sauce, chili mayo and kimchi sesame'],
  'nigiri-lax': ['Salmon', 'Salmon nigiri'],
  'nigiri-raka': ['Shrimp', 'Shrimp nigiri'],
  'nigiri-tilapia': ['Tilapia', 'Tilapia nigiri (white fish)'],
  'nigiri-tonfisk': ['Tuna', 'Tuna nigiri'],
  'nigiri-blackfisk': ['Octopus', 'Octopus nigiri'],
  'nigiri-flamed-lax': ['Flamed salmon', 'Flamed salmon nigiri'],
  'nigiri-tofu': ['Tofu', 'Tofu nigiri'],
  'nigiri-avokado': ['Avocado', 'Avocado nigiri'],
  'nigiri-omelett': ['Omelette', 'Omelette nigiri'],
  'nigiri-portobello': ['Portobello', 'Portobello nigiri'],
  laxmaki: ['Salmon maki', '10 rolls with salmon and cucumber'],
  'classic-laxmaki': ['Classic salmon maki', '10 rolls with salmon, cucumber and avocado'],
  'spicy-laxmaki': ['Spicy salmon maki', '10 rolls with salmon, cucumber, avocado and chili mayo'],
  'california-roll': ['California roll', 'Crab fish, avocado, cucumber, Japanese mayo, wrapped in sesame seeds'],
  'boston-roll': ['Boston roll', 'Shrimp, avocado, cucumber, chili mayo, wrapped in sesame seeds'],
  'new-york-roll': ['New York roll', 'Salmon, avocado, cucumber, chili mayo, wrapped in sesame seeds'],
  'vegetarisk-roll': ['Vegetarian roll', 'Tofu, avocado, cucumber, Japanese teriyaki sauce, wrapped in sesame seeds'],
  'spicy-lax-roll': ['Spicy salmon roll', 'Salmon, avocado, cucumber, Japanese chili powder, topped with chili mayo and kimchi sesame seeds'],
  'krispig-ebi-roll': ['Crispy ebi', 'Fried shrimp, avocado, Japanese teriyaki sauce, topped with chili mayo and kimchi sesame'],
  'krispig-kyckling-roll': ['Crispy chicken', 'Fried chicken, cucumber, salad, Japanese teriyaki sauce, topped with chili mayo and kimchi sesame seeds'],
  'dragon-roll': ['Dragon roll', 'Avocado, crab fish, cucumber, topped with salmon and avocado, chili mayo and kimchi sesame'],
  'rainbow-roll': ['Rainbow roll', 'Avocado, crab fish, cucumber, topped with salmon, tuna, white fish, avocado, teriyaki sauce, chili mayo and kimchi sesame'],
  'veggie-roll': ['Veggie roll', 'Avocado, cucumber, tofu, teriyaki sauce, topped with avocado, vegan chili mayo and kimchi sesame seeds'],
  'nemo-roll': ['Nemo roll', 'Fried shrimp, avocado, cucumber, teriyaki sauce, topped with chili mayo, kimchi sesame seeds and seaweed caviar'],
  'alaska-roll': ['Alaska roll', 'Salmon, avocado, cucumber, Philadelphia cheese, topped with tobiko'],
  'super-krispig-kyckling': ['Super crispy chicken', 'Fried chicken, cucumber, salad, teriyaki sauce, topped with avocado and kimchi sesame seeds'],
  'orange-krispig-ebi': ['Orange crispy ebi', 'Fried shrimp, avocado, teriyaki sauce, topped with salmon and kimchi sesame seeds'],
  'green-krispig-ebi': ['Green crispy ebi', 'Fried shrimp, avocado, teriyaki sauce, topped with avocado and kimchi sesame seeds'],
  'sunshine-roll': ['Sunshine roll', 'Salmon, avocado, cucumber, chili mayo, topped with avocado and tobiko'],
  'super-lax-roll': ['Super salmon roll', 'Salmon, avocado, cucumber, chili mayo, topped with flamed salmon, teriyaki sauce, chili mayo and kimchi sesame seeds'],
  'tiger-roll': ['Tiger roll', 'Fried shrimp, avocado, topped with flamed salmon, teriyaki sauce, chili mayo and kimchi sesame seeds'],
  'dynamite-lax': ['Dynamite salmon roll', 'Fried rolls with salmon, cucumber, chili mayo, teriyaki sauce and kimchi sesame'],
  'dynamite-kyckling': ['Dynamite chicken roll', 'Fried rolls with crispy chicken, cheddar, cucumber, topped with chili mayo, teriyaki sauce and kimchi sesame'],
  'dynamite-biff': ['Dynamite beef roll', 'Fried rolls with beef, cheddar, cucumber, topped with chili mayo, teriyaki sauce and kimchi sesame'],
  'rispapper-lax': ['Rice paper salmon roll', 'Salad, rice paper, salmon, cucumber, avocado, chili mayo, teriyaki sauce, kimchi sesame'],
  'rispapper-kyckling': ['Rice paper chicken roll', 'Salad, rice paper, fried chicken, avocado, cucumber, teriyaki sauce, kimchi sesame'],
  'rispapper-rakor': ['Rice paper shrimp roll', 'Salad, rice paper, fried shrimp, avocado, cucumber, teriyaki sauce, kimchi sesame'],
  'lax-sashimi': ['Salmon sashimi', '5 pieces of salmon, served with salad, ponzu sauce and roe'],
  'sashimi-mix': ['Sashimi mix', '5 salmon, 2 tuna and 2 white fish, served with salad, ponzu sauce and roe'],
  'hoso-lax': ['Hoso salmon', '8 hosomaki with salmon'],
  'hoso-avokado': ['Hoso avocado', '8 hosomaki with avocado'],
  'hoso-gurka': ['Hoso cucumber', '8 hosomaki with cucumber'],
  'hoso-crabfisk': ['Hoso crab fish', '8 hosomaki with crab fish and mayo'],
  'hoso-tofu': ['Hoso tofu', '8 hosomaki with tofu'],
  'hoso-krispig-ebi': ['Hoso crispy ebi', '8 hosomaki with fried shrimp'],
  'barn-meny-1': ["Kids' menu 1", '8 hoso salmon, 2 salmon nigiri'],
  'barn-meny-2': ["Kids' menu 2", '8 hoso avocado, 2 shrimp nigiri'],
  'fest-meny-85': ['Party platter (85 pieces)', 'Order at least 2 hours in advance. 85 pcs: 5 salmon, 2 tuna, 2 white fish, 4 shrimp, 4 flamed salmon, 4 avocado, 4 tofu, tiger roll (10), orange crispy ebi (10), classic salmon maki (10), veggie roll (10), spicy salmon roll (10), dragon roll (10)'],
  lattol: ['Light beer', '33 cl Grängesberg (2.1%)'],
  soja: ['Soy sauce', null],
  'glutenfri-soja': ['Gluten-free soy sauce', null],
  soppa: ['Miso soup', null],
  chilimajonnas: ['Chili mayo', null],
  'vegansk-chilimajonnas': ['Vegan chili mayo', null],
  teriyakisas: ['Japanese teriyaki sauce', null],
  sesamdressing: ['Japanese sesame dressing', 'Contains peanuts'],
};

let nCat = 0, nItem = 0;
for (const cat of menu.categories) {
  const c = CATS[cat.id];
  if (c) { cat.name_en = c[0]; if (c[1]) cat.desc_en = c[1]; nCat++; }
  for (const it of cat.items) {
    const t = ITEMS[it.id];
    if (t) {
      if (t[0] && t[0] !== it.name) it.name_en = t[0];
      if (t[1]) it.desc_en = t[1];
      nItem++;
    } else if (it.desc && it.desc.includes('cl')) {
      // drinks: "33 cl" works in both languages
      nItem++;
    }
    if (it.options) it.options.label_en = 'Choose sauce';
  }
}
menu.note_en = 'Serving hours: Mon–Thu 11:00–20:00, Fri 11:00–21:00, Sat 13:00–21:00, Sun 15:00–21:00';
fs.writeFileSync(FILE, JSON.stringify(menu, null, 2) + '\n');
console.log(`OK: ${nCat} categories, ${nItem} items annotated with English.`);

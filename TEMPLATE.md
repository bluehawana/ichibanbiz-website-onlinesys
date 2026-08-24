# Restaurang-mall (white label)

Denna branch (`template`) är en **återanvändbar mall**: en komplett restaurang-/
butikswebbplats med onlinebeställning (Stripe), bordsbokning, tvåspråkighet
(SV/EN) och köksskärm med larm — utan någon specifik restaurangs varumärke.

Starta ett nytt kundprojekt så här:

```bash
git clone -b template <repo-url> nya-restaurangen
cd nya-restaurangen
node server/server.js   # http://localhost:3000 — fungerar direkt med exempelmenyn
```

## Anpassningschecklista per kund

| # | Vad | Var |
|---|---|---|
| 1 | Namn, adress, telefon, e-post | Sök/ersätt `Restaurang Demo`, `Exempelgatan 1`, `000-00 00 00`, `info@example.com` i `public/*.html`, `admin/*` |
| 2 | Logotyp/sigill | `.seal`-elementet i sidhuvudet (tecknet `店`) + favicon-SVG i varje `<head>` |
| 3 | Färger & typsnitt | Tokens i `:root` i `public/css/style.css` + Google Fonts-länken i varje sida |
| 4 | Meny | `public/data/menu.json` (struktur beskriven i filens `note`) |
| 5 | Maträttsbilder | Lägg jpg-filer i `public/assets/img/menu/`, referera via `img`-fältet |
| 6 | Hjältebild | Lägg bild i `public/assets/img/site/`, återställ `background-image` i `public/index.html` |
| 7 | Öppettider | `HOURS` i `server/server.js`, `public/js/site.js`, `public/boka.html` + texterna i sidfötterna |
| 8 | Berättelse/Om oss | `public/om.html` + `om.p1–p3` i `public/js/i18n.js` |
| 9 | Domän | `deploy/Caddyfile` eller nginx-konfig; `BASE_URL` i `.env` |
| 10 | Stripe | Kundens egna nycklar i `.env` (se README) |
| 11 | Kvitton/SMS | `RESEND_API_KEY`/`ELKS_API_*` i `.env` (valfritt) |
| 12 | Admin-PIN | `ADMIN_PIN` + `SECRET` i `.env` |

Övrig dokumentation (drift, Stripe, VPS, backup): se `README.md`.

## Hålla mallen uppdaterad

Förbättringar som inte är kundspecifika görs på `main` (Ichiban) eller direkt här
och plockas mellan grenarna med `git cherry-pick`.

# Ichiban Sushi — självhostad webbplats + beställningssystem

Komplett ersättning för Wix: webbplats, onlinebeställning för avhämtning (med
Stripe-betalning), bordsbokning och en köksskärm med larm — allt i en enda
Node.js-server **utan npm-beroenden**.

```
public/    Webbplatsen (Hem, Meny, Beställ, Boka bord, Om oss, Integritetspolicy)
admin/     Köksskärmen: /admin — PIN-skyddad, larmar vid nya beställningar
server/    server.js — statiska filer + API + Stripe + SSE
data/      orders.json / reservations.json (skapas automatiskt)
deploy/    Caddyfile + systemd-tjänst för VPS-drift
scripts/   Hjälpskript (bildnedladdning, engelska menyfält)
```

## Kör lokalt

```bash
node server/server.js
# http://localhost:3000       — webbplatsen
# http://localhost:3000/admin — köksskärmen (PIN: 1234 tills du sätter ADMIN_PIN)
```

Kräver Node.js 18+. Ingen `npm install`.

## Miljövariabler

| Variabel | Standard | Beskrivning |
|---|---|---|
| `PORT` | `3000` | Lyssningsport |
| `ADMIN_PIN` | `1234` | PIN till köksskärmen — **byt i produktion!** |
| `SECRET` | härledd | Hemlighet för inloggningskakan — sätt en egen slumpsträng |
| `BASE_URL` | `http://localhost:3000` | Publik URL, används i Stripe-retursidor |
| `STRIPE_SECRET_KEY` | *(tom)* | `sk_live_…` — utan denna visas bara "betala vid avhämtning" |
| `STRIPE_WEBHOOK_SECRET` | *(tom)* | `whsec_…` från Stripe-webhooken |
| `DATA_DIR` | `./data` | Var beställningar sparas |

## Stripe (kortbetalning online)

1. Skapa konto på stripe.com → hämta **Secret key** (`sk_live_…`).
2. Lägg till en webhook-endpoint i Stripe Dashboard:
   `https://ichiban.biz/api/stripe/webhook` med händelserna
   `checkout.session.completed` och `checkout.session.expired`.
   Kopiera **Signing secret** (`whsec_…`).
3. Sätt `STRIPE_SECRET_KEY` och `STRIPE_WEBHOOK_SECRET` i miljön och starta om.

Flödet: kunden väljer "Betala online" → skickas till Stripes betalsida →
webhooken markerar ordern som betald → **först då** larmar köksskärmen.
Obetalda/avbrutna checkouts når aldrig köket. Om Stripe är nere faller
beställningen automatiskt tillbaka till "betala vid avhämtning".

Avgift: ca 1,5 % + 1,80 kr per kort­betalning inom EU. Ingen månadsavgift.
Apple Pay / Google Pay / Klarna / PayPal aktiveras i Stripe Dashboard →
Payment methods — inga kodändringar behövs.

## Swish (lokala kunder — inga kortuppgifter)

Kunden väljer Swish i kassan → en betalförfrågan skickas till kundens
mobilnummer → kunden godkänner i Swish-appen → köksskärmen larmar när
betalningen gått igenom. Avvisad/utebliven betalning avbryter ordern
(och släpper bordet vid "ät här").

1. Beställ **Swish Handel** via restaurangens bank (obs: inte samma som
   Swish Företag).
2. Hämta API-certifikatet på portal.swish.nu och lägg det på servern.
3. Sätt i `.env`: `SWISH_PAYEE_ALIAS` (ert Swish-nummer), `SWISH_CERT`
   och `SWISH_KEY` (PEM-filerna). Starta om — Swish-alternativet dyker
   upp i kassan automatiskt.

Avgift: enligt bankens Swish Handel-avtal (typiskt 1–2 kr per betalning).

## Köksskärmen (`/admin`)

- Öppna på en surfplatta/telefon i köket, logga in med PIN, tryck
  **"Aktivera larmljud"** (krävs en gång per session av webbläsaren).
- Lägg till på hemskärmen (PWA) så beter den sig som en app.
- Nya beställningar och bokningar **ringer och pulserar tills de accepteras**.
- Flöde per order: NY → Acceptera → Maten är klar → Uthämtad.
  Kundens bekräftelsesida uppdateras automatiskt i varje steg.

## Drift 24/7 på VPS

Testat recept för en liten VPS (Hetzner/Contabo/DigitalOcean, ~50 kr/mån):

```bash
# på servern (Ubuntu 24.04):
sudo apt update && sudo apt install -y nodejs caddy git
sudo git clone https://github.com/bluehawana/ichibanbiz-website-onlinesys.git /opt/ichiban

sudo cp /opt/ichiban/deploy/ichiban.service /etc/systemd/system/
sudo systemctl edit ichiban        # lägg in ADMIN_PIN, SECRET, STRIPE-nycklar
sudo systemctl enable --now ichiban

sudo cp /opt/ichiban/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

- **systemd** startar om servern automatiskt vid krasch och vid omstart av VPS:en.
- **Caddy** ger automatiskt HTTPS (Let's Encrypt) för ichiban.biz.
- Peka domänens A-post mot VPS:ens IP när ni är redo att lämna Wix.

### Backup

Allt tillstånd ligger i `data/` (två JSON-filer). En cron-rad räcker:

```
0 3 * * * tar czf /root/backup/ichiban-$(date +\%F).tgz /opt/ichiban/data
```

## Ändra menyn

Redigera `public/data/menu.json` (svenska + `*_en`-fält för engelska).
Servern läser om filen automatiskt inom 5 sekunder — ingen omstart behövs.
Bilder ligger i `public/assets/img/menu/`.

## Språk

Webbplatsen är tvåspråkig: svenska (standard) och engelska. Växlas med
EN/SV-knappen i sidhuvudet; valet sparas i besökarens webbläsare och
webbläsare med annat språk än svenska får engelska automatiskt.

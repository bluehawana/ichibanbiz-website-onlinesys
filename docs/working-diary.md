# Working diary — ichibanbiz

## 2026-08-23 → 2026-08-24 — From Wix to our own stack, in one long push

**Where we started.** The restaurant's site lived on Wix (~$500/yr): a template
with mismatched mountain backgrounds, a duplicated menu across three pages, and
a "dine in" flow that abused the delivery form. Goal: a professional site we
own, running on our own VPS, with everything Wix gave us — and then more.

**What got built.**

- *The site itself* — zero-npm-dependency Node server (`server/server.js`)
  serving a bilingual (SV/EN) site: Hem, Meny (107 rätter with photos pulled
  from the old Wix CDN), Beställ, Boka bord, Om oss, Integritetspolicy.
  Design went through three passes: first a generic dark look, then a warm
  "lacquer" identity, and finally — after the owner shared the printed menu
  and brand palette — the real thing: near-black `#010801`, burgundy
  `#8A0018` (with `#C3302E` as the readable red for text on black, cream
  `#E5C4AC` secondary ink), chalk display type (Fredericka the Great) matching
  the menu's hand lettering, and the actual circular badge logo (cut to a
  transparent circle with a hand-rolled BMP→PNG masker since the source had a
  white background).
- *Ordering* — cart → pickup slots (30 min lead, opening-hours aware) →
  checkout. Payment three ways: Swish payment-request-to-phone (Swish Handel
  API, zero-dep client-cert TLS; activates when the bank grants the
  agreement), Kort · Apple Pay · Google Pay via Stripe hosted checkout, or pay
  in the restaurant. Payment confirmation is belt-and-braces: webhook/callback
  verified server-side + reconciliation sweep, so a paid order can never get
  stuck invisible. Refunds from the kitchen dashboard for both providers.
- *Dine-in order-ahead* — the "better than Wix" feature: choose Ät här,
  give party size + arrival time, pay ahead; a table is auto-reserved (linked
  to the order, released on cancel/decline/refund) and the kitchen preps for
  arrival. Table capacity is a real model: 40 concurrent guests, 90-minute
  windows, overbooking rejected server-side.
- *Bookings* — Wix-parity slot grid with crossed-out full times, live
  status page for the guest (Mottagen → Bekräftad), SMS/email confirmations
  wired (46elks/Resend, awaiting accounts).
- *Kitchen dashboard* (`/admin`) — PIN-protected PWA; new orders ring a
  two-tone chime, bookings a three-note beep, both repeat until accepted.
- *Google reviews* — official `g.page/r/CZ4TIKtdGXx9EAE/review` link as a
  button (homepage + after pickup) plus print QR. Place ID derived from the
  Maps FID and verified.
- *Receipts* — digital kvitto with 12 % moms breakdown, printable page,
  branded email template (Resend-ready).

**What broke and got fixed.** The classic one: pickup slots showed times that
had already passed — the VPS clock runs US Eastern, six hours behind Göteborg.
Fixed by pinning `process.env.TZ` to Europe/Stockholm at boot, with a CI test
that boots the server pretending to be in New York and fails if any offered
slot is in the past by the Göteborg clock. Also: a `.gitignore` line (`data/`)
that silently excluded `public/data/menu.json` from the repo, and `[hidden]`
attributes defeated by CSS display rules.

**Menu truth.** Compared the site against `2026 ichiban meny new.pdf`: all
prices matched; added the new free-choice nigiri combos (6/8/10/12/15 bitar,
99–210 kr). The PDF's "Lör 12–21" turned out to be outdated — owner confirmed
Saturday is 13–21, Sunday 15–21; the site says so, and the PDF should be
corrected before the next print run.

**Infrastructure.** AlphaVPS (`/opt/ichiban`, systemd + nginx, port 8088 for
testing, cutover-ready `ichiban.biz` server block; DNS on Cloudflare, still
pointing at Wix). CI/CD on GitHub Actions: 15 smoke tests booting the real
server (orders, bookings, capacity, auth, Stripe signatures, Swish against a
mock, timezone), build artifact, auto-deploy via a forced-command `deploy`
user with health check. Pressure-tested: 1.3–1.5k req/s on-server, zero
failures; kill -9 recovery in ~4 s. Tagged and released `v1.0.0`. Nightly
data backups (03:17, 30 days) under `/root/backups/ichiban/`; rollback
procedures documented in README.

**Also.** A white-label `template` branch: the whole system minus all Ichiban
branding, with a per-customer checklist (`TEMPLATE.md`) — for the next
restaurant that wants off Wix.

**Next steps.**
1. Owner: order Swish Handel from the bank; Resend + 46elks accounts when
   email/SMS receipts should go live.
2. A real 10 kr card payment end-to-end on the test URL, then refund it from
   the dashboard.
3. Cutover: point the Cloudflare A record at 94.72.141.71, switch nginx to
   443/TLS, set `BASE_URL=https://ichiban.biz`, update the Google Business
   Profile reservation link to `/boka` — then cancel Wix.

## 2026-08-24 (evening) — Brand lettering like the printed menu, and the phone padding bug

**What was wrong.** The owner sent the logo and a crop of the printed menu and
asked for the name on the site to match: chalk-pen hand lettering, not the
engraved Fredericka face we had. Same message carried two real defects: on
phones the whole hero sat flush against the left edge with no padding
("amateur level"), and on mid-width desktops the intro paragraph ran straight
through the vertical kanji on the hero's right edge.

**Font forensics.** Rendered the samples against every candidate on this Mac:
the logo's "ICHIBAN" is Apple's **Chalkduster**, the menu body is
**Chalkboard SE Bold**, "SUSHI" is a heavy Arial/Helvetica in red. Both Apple
faces ship with macOS/iOS but their licence forbids embedding them on a
website — which is the real reason the site never matched the menu.

**What got built.**
- *Wordmark as an image.* `public/assets/img/site/wordmark.png` — "ICHIBAN /
  SUSHI" rendered with the real Chalkduster at 3× (21 KB, transparent),
  laid out like the logo. Rasterising is allowed (it's how the printed menu
  exists); embedding the font file is not. Replaces the text name in the
  header and footer on all seven pages; the "Göteborg · Södra Vägen 91"
  sub-line under the name went away with it — the address is in the hero
  meta and footer already.
- *Local-first font stack.* `--font-display: "Chalkduster", "Cabin Sketch"`
  and a new `--font-hand: "Chalkboard SE", "Chalkboard", "Gochi Hand"`.
  iPhones, iPads and Macs render the genuine faces; Android/Windows get the
  closest Google Fonts (Cabin Sketch 700 for the rough caps, Gochi Hand for
  the marker handwriting — picked from a side-by-side render sheet).
  `--font-hand` is applied to `.lead` taglines and the dish/menu-line
  descriptions, mirroring how the printed menu uses Chalkboard for item text.
  Fredericka the Great dropped from the Google Fonts link.
- *The padding bug.* `.hero .inner { padding: 7rem 0 6rem }` out-ranked
  `.wrap`'s `0 22px` and zeroed the side padding — invisible on desktop
  because the centred max-width hides it. Now `padding-block` only. Also:
  `padding-right: clamp(4.5rem, 9vw, 8rem)` above 700px keeps the copy clear
  of the tategaki; shorter hero padding and tighter `»DEN BÄSTA«` tracking on
  phones.

**Verified (actually).** Headless-Chrome screenshots at 390px (via a 390px
iframe host page — headless clamps narrow windows wider, which produced a
misleading first shot) and 1280px, for the home, menu and order pages, in
both the real-font and fallback-font modes. `node --test`: 15 pass, 0 fail.
Not checked on a physical phone.

**Lesson recorded.** Earlier in the day the owner was told things "passed
every test" when the phone layout had never been looked at. Rule now: never
claim tests passed or mobile verified unless the run/screenshot happened in
that session, and say what wasn't checked.

**Swish, corrected.** An earlier grep with a quoting bug claimed Swish wasn't
in the codebase. It is (Swish Handel, `server/server.js`, covered by tests),
just disabled: needs `SWISH_PAYEE_ALIAS` + `SWISH_CERT`/`SWISH_KEY` from the
bank's Swish Handel agreement in `.env` on the VPS. Number alone does nothing.

**Next steps.**
1. Owner checks the deployed site on their own phone and against the printed
   menu; adjust wordmark size/red if needed.
2. Screenshot-sweep boka/om/integritet at phone width (not done this pass).
3. Unchanged from before: Swish Handel from the bank, the 10 kr Stripe test,
   DNS cutover, cancel Wix.

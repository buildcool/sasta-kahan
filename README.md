# SastaKahan 🛒

Search a product once (or tap **Share → SastaKahan** in the Amazon/Flipkart app). The app checks the price on every shopping site and shows where it's cheapest, including the price **after your own bank card offers**.

**Running cost: ₹0.** There's no server. Sites are checked straight from your phone. Site settings and card offers come from this GitHub repo through the free jsDelivr CDN, and the APK is built by free GitHub Actions.

## What it does

| | |
|---|---|
| **Sites (live price)** | Amazon, Flipkart, Nykaa, Myntra, Meesho, Ajio, Tata CLiQ, Reliance Digital, Croma |
| **Sites (Check manually link)** | JioMart, Vijay Sales, Purplle, Smytten (these load results with JavaScript; you get a ready-made search link) |
| **Smart site choice** | Only asks sites that sell that kind of thing (sunscreen → beauty sites, earbuds → electronics sites) |
| **Same-product matching** | Brand, model number and size must match. Results are labelled *Same product*, *Similar*, or *Different size* |
| **Per-unit price** | ₹/100 ml, ₹/100 g, ₹/piece, so a 50 ml pack and a 100 ml pack can be compared fairly |
| **Bank offers** | Read from product pages (Flipkart bank offers, UPI offers…) plus standing card benefits in `config/offers.json` |
| **My Cards** | Pick the cards you own (no card numbers). Every price is then shown after your best offer |
| **Watchlist** | Saves price history and sends a notification when the price drops (re-checked whenever you open the app) |
| **Share** | Send the comparison to WhatsApp |

## Project layout

```
config/sites.json     How to read each site (URLs, JSON field names, CSS selectors)
config/offers.json    Standing card rewards (Amazon Pay ICICI 5%, Flipkart Axis 5%, …)
src/core/             All the logic: fetch → parse → match → offers → effective price
src/ui/, src/App.tsx  Screens (React)
android/              Capacitor Android app (+ ShareInPlugin.java for the Share sheet)
tests/                Saved real pages from each site + unit tests
scripts/live-check.ts Live check of every site from your phone
```

## Develop on the phone (Termux)

```sh
pkg install nodejs-lts git gh
npm install
npm test                      # 68 tests, saved real pages
npm run live -- "boat airdopes 141"   # real check of all sites, prints a table
npm run dev                   # open http://localhost:5173 in Chrome on the same phone
```

## Get the APK (no laptop needed)

Every push to `main` builds the APK on GitHub Actions and publishes it under **Releases**. On your phone, open the repo → Releases → download `SastaKahan.apk` → install.

To make updates install over the old app, every build has to be signed with the same key. A key was generated in `~/.sastakahan/` (it's never put in git). Add it to the repo once:

```sh
gh secret set SIGNING_KEYSTORE_BASE64 < <(base64 -w0 ~/.sastakahan/release.p12)
gh secret set SIGNING_PASSWORD < ~/.sastakahan/password.txt
```

Back up `~/.sastakahan/`. If you lose it, the next APK won't install as an update (you'd have to uninstall first).

## When a site breaks

Sites change their pages sometimes. A broken site doesn't break the app; it just shows **Check manually**.

1. Run `npm run live -- "<a product>"` and find the site showing `empty` or `error`.
2. Run `npm run live -- "<product>" --save` to save the new page into `tests/fixtures/`.
3. Fix that site's entry in `config/sites.json` (field names / selectors) until `npm test` passes.
4. Push. Config changes reach every installed app within ~6 hours through jsDelivr, with no new APK needed. (The build also skips pushes that only change `config/`.)

Card offers change too. Edit `config/offers.json` the same way.

## Notes

- Prices are what each site shows at that moment. Bank offers can change at checkout, and card cashback is credited later.
- The app sends one request per site per search (plus one product page for offers) and caches for 10 minutes. It's for personal price comparison only.

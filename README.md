# SastaKahan 🛒

Search a product once (or tap **Share → SastaKahan** in the Amazon/Flipkart app). The app checks the price on every shopping site and shows where it's cheapest, including the price **after your own bank card offers**.

**Running cost: ₹0.** There's no server. Sites are checked straight from your phone. Site settings and card offers come from this GitHub repo through the free jsDelivr CDN, and the APK is built by free GitHub Actions.

## What it does

| | |
|---|---|
| **Sites (live price)** | Amazon, Flipkart, Nykaa, Myntra, Meesho, Ajio, Tata CLiQ, Reliance Digital, Croma |
| **Quick delivery (live, needs your location)** | Blinkit, Zepto, Swiggy Instamart, BigBasket (BB Now), Flipkart Minutes, plus JioMart and DMart Ready. Prices and stock are for the store that delivers to you, with the delivery time (⚡ 10 min) |
| **Sites (Check manually link)** | Vijay Sales, Purplle, Smytten, Amazon Now (it lives inside the Amazon app): you get a ready-made search link |
| **Smart site choice** | Only asks sites that sell that kind of thing (sunscreen → beauty sites, earbuds → electronics, cooker → home) |
| **Same-product matching** | Brand, model number, size and variant must match. Accessories ("case for iPhone 15"), other versions ("15 Plus", "Salt Lite") and listings that don't show their size are never called *Same product*. Tap **Why this match?** to see what matched |
| **Honest results** | A price far below every other site is flagged, out-of-stock items never win, and "found products but not this one" is shown separately from "not sold here" and "site blocked the check" |
| **Coupons** | Public coupon prices the sites already show (Myntra "Best price with coupon", Ajio coupon price, Amazon "Buy for ₹X with coupon") are counted |
| **Bank & UPI offers** | Read from product pages plus standing card benefits in `config/offers.json` (checked against bank terms, dated). New-user offers, offers for one UPI app, "up to ₹X" amounts and coins/points are not counted unless they really apply to you |
| **My Cards** | Pick your cards, UPI apps and memberships (Prime, Flipkart VIP, Myntra Insider, Nykaa Privé). No card numbers. Prices show what *you* pay, and how much is cashback that comes later |
| **Delivery location** | Set once: use your current location (permission asked only then) or type a pincode / area. Pincode → place uses the phone's own geocoder, else India Post + Open-Meteo. Stored on the phone; sent only to the quick-delivery sites |
| **Fees** | Approximate delivery fees where they're known (Amazon below ₹499, Nykaa below ₹299). Quick-delivery apps get a note: they add delivery / handling / small-cart fees |
| **Per-unit price** | ₹/100 ml, ₹/100 g, ₹/piece, so a 50 ml pack and a 100 ml pack can be compared fairly |
| **Watchlist** | Checked every ~4 hours in the background (and when you open the app). Alerts for a price drop, a target price, or back in stock. History chart with low / average / high and a "good price?" badge. Alerts use the site's own price, so adding a card never causes a fake drop |
| **Share, scan, paste** | Share a product from any shopping app, scan a barcode in a shop, or copy a link and open the app. Amazon search suggestions while typing |
| **Open in app** | Opens the product in the shop's own app, where you're logged in and see your personal coupons |
| **Site logins (beta)** | Optionally log in to a shop inside the app so checks see your member prices. Off by default; your login stays on the phone |
| **Languages** | English, Hinglish, हिंदी |
| **Backup** | Export your cards and watchlist as text, restore on a new phone |
| **Updates** | The app tells you when a new APK is out on GitHub Releases |
| **Privacy** | No account, no ads, no trackers, no affiliate links, no server. Everything stays on your phone |

## Project layout

```
config/sites.json       How to read each site (URLs, JSON field names, CSS selectors, fees, app ids)
config/offers.json      Standing card rewards (Amazon Pay ICICI, Flipkart Axis, SBI Cashback, …) and memberships
src/core/               All the logic: fetch → parse → match → offers → effective price → watchlist rules
src/runner/             Background price checker (Capacitor Background Runner, no WebView)
src/geo.ts              Pincode / area / GPS → delivery location
src/ui/, src/App.tsx    Screens (React); text in src/strings.ts (English / Hinglish / Hindi)
android/                Capacitor Android app (+ ShareInPlugin, ToolsPlugin, LoginActivity, PageReader)
tests/                  Saved real pages from each site + unit tests
scripts/live-check.ts   Live check of every site from your phone
scripts/health-check.ts Daily check on GitHub Actions; opens an issue when a site's page can't be read
```

## Develop on the phone (Termux)

```sh
pkg install nodejs-lts git gh
npm install
npm test                      # 200 tests, saved real pages
npm run test:runner           # background checker in QuickJS (pkg install quickjs-ng)
npm run live -- "boat airdopes 141"   # real check of all sites, prints a table
npm run live -- "amul taaza toned milk 500 ml" --pin=560034 --lat=12.9352 --lng=77.6245   # + quick-delivery sites
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
4. Push. The **Publish config** workflow clears the jsDelivr cache, and every installed app picks up the change within ~6 hours, with no new APK. (The APK build skips pushes that only change `config/`.)
   Bump the file's `version` too: an app only takes a downloaded file whose `version` is higher than the one it shipped with. (Apps before 1.2 don't understand the quick-delivery entries, so `sites.json` stayed at version 2 for the 1.2 release; bumping it also sends the new entries to anyone still on 1.1.)

The **Daily site check** workflow does steps 1–2 automatically every morning from GitHub's servers and opens an issue when a site's page loads but no products can be read. (Captchas from GitHub's servers abroad are expected and not counted.)

Card offers change too. Edit `config/offers.json` the same way, and update each offer's `verified` date after checking the bank's terms.

## How the quick-delivery sites are read

Their prices depend on the nearest dark store, so each one gets the user's location the way its own website does:

| Site | How |
|---|---|
| Blinkit | Search API with `lat`/`lon` headers. When Cloudflare asks for a browser check, the app opens blinkit.com in the hidden browser and runs the same search inside the page |
| BigBasket (BB Now) | Setup: serviceability check → "set delivery address" (with the site's CSRF cookie) → listing API |
| Flipkart Minutes | Setup: serviceability → location update (`marketplace=HYPERLOCAL`) → page API; follows Flipkart's "DC Change" answer to the right data centre |
| JioMart | Product API with the pincode in the `x-location-detail` header |
| DMart Ready | Pincode → store id, then the store's search API |
| Zepto, Instamart | They answer only real browsers. `PageReader` (Android) opens their search page in a hidden WebView with the location cookie set, and copies the page's own search response back. One page at a time, no images, destroyed afterwards. Can be turned off in More |

All of it is in `config/sites.json` (`location`, `setup`, `browser`, `json`), so most fixes need no new APK. The daily GitHub check skips these sites (they need an Indian location); check them from the phone with `npm run live -- "<product>" --pin=… --lat=… --lng=…`.

## Notes

- Prices are what each site shows at that moment. Bank offers can change at checkout, and card cashback is credited later.
- The app sends one request per site per search (plus up to 6 product pages for offers and pack sizes) and caches for 10 minutes. A site that blocks it gets a rest (5 → 20 → 60 minutes). It's for personal price comparison only.
- Background checks use Android's WorkManager. Some phones (Xiaomi, Oppo, Vivo, Realme…) stop background work unless you allow SastaKahan in battery settings.
- Background checks include Blinkit, JioMart and DMart (with a saved location). Zepto, Instamart, BigBasket and Flipkart Minutes need the app (hidden browser / cookie store), so they're checked when you open it.
- Big Bazaar's stores are now Reliance Smart Bazaar; their online shop is JioMart.

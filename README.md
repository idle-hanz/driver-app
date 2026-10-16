# AGR Driver (PWA)
Plain HTML/JS app for a Piccadilly line train driver. Install from Chrome on Android with Add to Home screen.
Contains **no duty data**. You import your own notice CSVs and duty book PDFs in Settings; they stay in IndexedDB on your phone only.
pdf.js is vendored under `vendor/` (Apache-2.0, see `vendor/PDFJS-LICENSE`).

## Traffic-aware drive time (optional TomTom key)
1. Sign up free at https://developer.tomtom.com (Register / Sign up).
2. In your dashboard, create or copy an API key.
3. Paste it in Settings → TomTom API key. It is stored on this device only, never in this repo.
4. Tap "Use my current location as home" (or type lat,lon), and "Find depot from address" (or type lat,lon).

The free tier covers Routing and Search (roughly a few thousand requests per day; check TomTom's current terms). Results are cached per weekday and hour for offline use. Without a key, the app uses your usual journey time and marks it "estimate, no traffic data".

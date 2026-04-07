# Backstage — Architectural TODOs & Known Issues

Living document. As we ship features and discover problems, add them here so nothing falls through the cracks.

Last updated: 2026-04-07 (post-GitGuardian alert)

---

## 🔴 Security (highest priority)

### Hide the Supabase anon key
**Problem.** The Supabase anon key is currently embedded client-side in every Backstage HTML file (`comps-db.html`, `import.html`, `mls-deals.html`, etc.). Anyone who views the page source can grab it. While the key is "anon" and gated by RLS policies, it's still a meaningful exposure: anyone with the key can hit your Supabase project from anywhere, scrape data subject to RLS, and burn quota.

**Plan.** Build a Supabase Edge Function (Deno) that acts as a thin proxy between the browser and Supabase. The browser calls the Edge Function with a session token; the Edge Function holds the real anon (or service) key and forwards the query. Then strip the anon key from all client HTML.

**Blockers / open questions.**
- Auth model — currently Backstage uses a hardcoded password hash in client JS. Not great. Edge Function migration is a good time to introduce a real auth flow (Supabase Auth with a single user, or a JWT-based approach).
- RLS policies need a full audit. Right now we may be relying on "anon key + obscurity" rather than proper row-level security.
- Performance — Edge Function adds latency. For 17k-row scans (Map View), this could be painful unless we batch carefully.

### Google Maps API key restriction
**Status: ✅ DONE 2026-04-07.** Key is restricted in Google Cloud Console:
- **Application restrictions:** HTTP referrers — `https://backstage.dottyhomes.com/*` and `https://pattyhsu.github.io/*`
- **API restrictions:** Geocoding API, Maps JavaScript API, Maps Embed API, Maps Static API, Places API

The key is still public in the GitHub repo (GitGuardian flagged it on 2026-04-07 when `import.html` got the same key as `comps-db.html` and `mls-deals.html`), but it's now functionally harmless — Google rejects requests from non-allowed referrers.

**Still TODO:** Move the key out of client HTML entirely via the Edge Function project below. Until then, GitGuardian will keep flagging it on every commit that touches a file containing the key.

### Supabase anon key — also exposed
**Same situation as Google Maps key.** The Supabase anon key is hardcoded in every Backstage HTML file. Unlike the Google Maps key, **there's no equivalent of "HTTP referrer restrictions" for Supabase** — RLS policies are the only line of defense. Audit those before treating this as low-risk.

---

## 🟡 Geocoding pipeline

### Switch back to Census once Edge Function exists
**Status.** Pass 1 (Census) is currently broken because the Census Geocoder API doesn't send CORS headers, so browser-direct calls fail with "Failed to fetch." We're falling through to Pass 2 (Google) for everything, which costs ~$5/1000 requests.

**Current cost.** ~$3-7/month at current MLS import volumes. Tolerable but not free.

**Plan.** Once the Edge Function proxy from the security item above exists, route Census calls through it. CORS won't apply (server-to-server), and Census will work for ~95% of addresses, dropping Google usage to ~5% of imports.

**Why we're not doing this now.** Building the Edge Function is a security project, not a cost-savings project. Don't half-build it just for geocoding. Wait until we tackle it deliberately as part of the security work.

**Code state today.** `import.html` `startGeocoding()` still has the full Census-then-Google flow wired up. When the proxy exists, the only change needed is updating the URL inside `geocodeCensus()` from the Census endpoint to the Edge Function URL.

### Better outlier detection
**Status.** Map View in `comps-db.html` uses 1.5×IQR per-city for outlier detection. This generates lots of false positives in tightly-clustered cities — any property even one block off the cluster centroid gets flagged.

**Quick fix landed.** Per-row "✓ dismiss" button + bulk "Dismiss all" button + `outlier_reviewed` column in Supabase. Lets us wave away false positives so the signal-to-noise ratio improves over time.

**Better long-term fix.** Replace IQR with k-nearest-neighbors distance: a point is suspicious if its distance to the 3 nearest neighbors in the same city is > N times the median nearest-neighbor distance for that city. This is the standard approach for spatial outlier detection and would eliminate ~95% of the IQR false positives.

**Even better.** Use APN-based parcel centroid lookups from LA County and OC assessor open data. Skip geocoding entirely for properties where we have an APN. Zero ambiguity, zero ongoing cost, more accurate than any geocoder. Big engineering project (parcel data ingestion pipeline) but the right long-term answer.

### Re-geocoding workflow improvements
- The Map View "Clear coords" button drops bad lat/lon, then you have to manually switch tabs to import.html → Geocode tab → Start. Could be one-click if Map View lived in import.html.
- Currently no logging of *which* geocoder produced each coord. Would be useful for debugging which source is creating bad data. Add `geocode_source` column (`census`, `google_rooftop`, `google_interpolated`, `manual`).

---

## 🟢 UX & code organization

### Map View location
**Decision deferred.** Currently in `comps-db.html` because it's also a browsing tool, not just a data quality tool. Long-term, may want to:
- Extract Map View into its own file (`map-view.html`), or
- Duplicate it across both `comps-db.html` (for browsing) and `import.html` (for QA), or
- Build a shared `backstage-shared.js` that both files import.

Revisit after one full geocoding cycle (clear → re-geocode → verify) to see what the actual workflow feels like.

### Shared infrastructure
Several functions are duplicated across files:
- `editComp` / `saveEdit` / `closeEditModal` — exists in `comps-db.html` and `import.html`
- `editFields` schema — exists in both
- Photo lightbox (`openLightbox`, `viewCompPhotos`, `fetchPhotoCount`) — exists in `mls-deals.html`, `comps-db.html`, `import.html`
- Supabase client init + auth gate — every file
- `SOCAL_BOUNDS` / `inSoCal` / `fmtAddr` — only in `import.html` so far, but Map View uses inline equivalents

When the schema changes or behavior needs updating, we have to remember to touch every file. Consider extracting to `/js/backstage-shared.js` and including it in each HTML file as a `<script src>` tag. Low effort, high payoff for maintainability.

### Dead code in comps-db.html
The following functions still exist but reference DOM that no longer exists in the file (they were leftovers from an earlier panel structure):
- `updateGeoStats()` — references `geo-total`, `geo-done`, `geoBar` etc.
- `startGeocoding()`, `stopGeocoding()` — references `geoStartBtn`, `geoLog` etc.
- `loadMissingSchools()` — there's no Missing Schools tab in comps-db anymore

These are silently failing but not causing visible bugs. Should be cleaned up next time we touch the file.

### Find Duplicates UX
**Done.** Auto-runs on tab click; redundant manual button removed.

### Find Duplicates rendering
- For very large dupe sets, the page can render slowly. Consider lazy/paginated rendering if it gets unwieldy.
- "True duplicates" auto-removal is destructive. Add an undo? Or at least a "preview before deleting" checkpoint?

---

## 🔵 Data quality

### City name normalization
**Symptom.** Map View shows `(18,693)` records but stats card shows `17,747` total comps. The discrepancy comes from including `change_type='listing'` rows alongside sold comps. **Not a bug per se** — Map View intentionally shows everything geocoded — but worth flagging that "comp count" depends on which lens you're looking through.

**Real bug to investigate.** City names are stored inconsistently. Spot-checked examples: "TEMPLE CITY" vs "Temple City" vs "temple city" — all probably exist in different rows. Same for "BUENA PARK" vs "Buena Park". Search/filter in Browse All and Map View dropdown both depend on exact-match (with `.toUpperCase().trim()`), so case is normalized at query time, but this is fragile.

**Fix.** One-time UPDATE: `UPDATE properties SET city = UPPER(TRIM(city))`. Then add a CHECK constraint or trigger to enforce uppercase on insert. Will reduce dropdown bloat and edge-case bugs.

### MLS number missing on some comps
**Symptom.** In `mls-deals.html`, the comp list shows clickable photo links only when the comp row has an `mls` value. Some comps (e.g., 6433 Livia, Temple City) don't have an MLS number in the database, so no photo link renders. The photos exist on `photos.dottyhomes.com` under *some* MLS number — just not the one we have stored.

**Fix.** Need to backfill missing MLS numbers. Possible sources: (a) check old CSV imports for MLS columns, (b) re-scrape from MLS daily where we still have the address, (c) query `photos.dottyhomes.com` for folder names matching the address pattern.

**Detection.** Add a "Missing MLS" tab to the Import Hub like the existing "Missing Schools" tab.

### Reviewed-outlier auditing
The new `outlier_reviewed` column lets users dismiss false positives, but there's no audit trail. If we ever change the detection algorithm, we won't know which rows were dismissed under the old algorithm vs deliberately marked as fine. Consider adding `outlier_reviewed_at` (timestamp) and `outlier_reviewed_method` (which algorithm flagged it when dismissed) for forensics.

---

## 🟣 Nice-to-haves (non-urgent)

- **Map clustering** — at the LA/OC zoom level, 18k pins overlap into a red mess. Use Google Maps marker clustering library to collapse nearby pins until zoom-in.
- **Browse All map view** — let the Browse All tab toggle to show its currently-filtered results on a map.
- **Export to Google Sheets** — for sharing comp packs with partners.
- **Comp pack PDF export** — formatted output for buyer/seller presentations.
- **Bulk edit** — select N rows in Browse All, edit a single field across all of them (e.g., set comp_type for a batch).

---

## How to use this doc

When you (or a future LLM helper) sit down to work on Backstage:
1. Skim this file first.
2. Anything in 🔴 Security should be addressed before any other "improvements" land.
3. Update items as you complete them — move done things to a "Done" section at the bottom or just delete them.
4. Add new TODOs as you discover them, with enough context that future-you understands the *why*, not just the *what*.

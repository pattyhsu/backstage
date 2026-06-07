# Backstage — Architecture

Internal real-estate operations app for **Dotty Homes**: sourcing listings, underwriting deals, tracking projects through escrow/construction/sale, and watching the money. This document is the whole-stack map — frontend, data model, the backend pipeline that feeds it, cadences, infra, and the things that bite you.

> Scope note: the **backend** (data pipeline, ML scoring, QBO sync) lives in a separate repo (`~/dotty-agents`) and is already documented in depth there. This doc covers the **frontend in full** and **summarizes + links** the backend rather than duplicating it.

---

## 1. The mental model

Everything is **property-centric**. A scraper pulls MLS listings into one big `properties` table; a pipeline enriches each row (geocode → schools → ARV → deal score → condition tier); the frontend reads it all back. State lives entirely in **Supabase Postgres** — the frontend is static HTML with no server of its own, and the backend is a set of scheduled Python jobs on a Mac mini.

```
  THE MLS (hotsheet/saved search)
        │  Playwright scraper (6x/day)
        ▼
  CSV + photos ──────────► Cloudflare R2 (photos.dottyhomes.com)
        │
        ▼
  daily_pipeline (Python, Mac mini)
   import → geocode → schools → ARV → deal-score → condition-tier → push
        │
        ▼
  ┌─────────────────────────┐        ┌──────────────────────────┐
  │   Supabase Postgres      │◄──────►│  QuickBooks Online (QBO) │
  │   (~29 tables, 7 views)  │  sync  │  one-way mirror, nightly │
  └─────────────────────────┘        └──────────────────────────┘
        ▲
        │  supabase-js (anon key + user JWT, RLS-gated)
        │
  Backstage frontend (static HTML on Cloudflare Pages)
  backstage.dottyhomes.com
```

Two repos, two machines:

| Repo | Path | Role | Deploys to |
|------|------|------|-----------|
| **backstage** (this repo) | `~/backstage` | Frontend — static HTML pages | Cloudflare Pages → `backstage.dottyhomes.com` |
| **dotty-agents** | `~/dotty-agents` | Backend — scraper, pipeline, ML, QBO sync, migrations | launchd cron on a Mac mini |

---

## 2. Frontend

### Stack
- **Static HTML, one file per page.** No framework, no build step. Each page is self-contained HTML with a large inline `<script>` and inline styles, plus three shared files.
- **`supabase-js` v2** talks directly to Supabase from the browser using the **anon key** (public, RLS-gated). The service-role key is **never** in frontend code.
- **No bundler / no npm at runtime.** Deploy = push the HTML; Cloudflare Pages serves it.

### Shared files (loaded by every page)
| File | Purpose |
|------|---------|
| `auth.js` | Auth gate. `window.authGate()` runs on load; redirects to `login.html` if unauthenticated or role-less. Exposes the signed-in user/role. |
| `sidebar.js` | Renders the left nav. `window.renderSidebar('<activeKey>')`. Single source of truth for the nav structure. |
| `backstage.css` | Shared design tokens (CSS vars: `--accent`, `--text`, `--bg`, `--border`, `--green/red/amber/blue`…) and common component styles. |

The Supabase client is initialized identically per page:
```js
const SUPABASE_URL='https://pwrnywsojomrygsiezzi.supabase.co';
const SUPABASE_KEY='<anon key>';
const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
window.sb=sb;  // exposed for auth.js
```

### Auth & roles
- Login via **Supabase Auth** — Google OAuth or email magic-link (`login.html`).
- **Roles are only `owner` or `worker`** (stored in `user_roles`). `authGate()` blocks users with no role.
- Adding a user = admin-create the auth user + insert a `user_roles` row (see `~/.claude/.../backstage-add-user.md`).

### Navigation (from `sidebar.js`)
```
PIPELINE      Pipeline · Calendar
ACQUISITIONS  MLS Deals · Comp Check
PROJECTS      Construction · Listings        (planned — pages not built yet)
DATA          Condition · Import Hub          (one tab strip, two pages)
INSIGHTS      Money
ADMIN         Users & Settings · Chat
```

### Page reference
| Page | File | Purpose | Primary tables | Notable behavior |
|------|------|---------|----------------|------------------|
| **Pipeline** | `pipeline.html` | Kanban of active deals by phase (pursuing → in_escrow → under_construction → selling) | `deals`, `deals_phase_history`, `properties`, `v_deal_cost_breakdown` | Load-once. Cards link to `project-detail.html?deal=ID`. |
| **Calendar** | `calendar.html` | Milestone timeline bucketed by urgency (overdue/today/week/later) | `deal_milestones`, `deals`, `properties` | Inline task edit + quick-add. Tasks deep-link to project detail. |
| **MLS Deals** | `mls-deals.html` | The acquisitions list — new/active listings with comps, ARV, deal grade | `properties`, `deal_scores`, `arv_estimates`, `deal_milestones`, `deals` | Address search uses an **in-memory index** (see §5). Bulk archive. Smart-comp panel per row. |
| **Comp Check** | `comps-db.html` | Comp search (radius/sqft/date + in-browser haversine) + Browse All | `properties` (`change_type='sold'`) | Google Places autocomplete → geocode → bbox query → distance filter. Tier retag. |
| **Project Detail** | `project-detail.html` | Deep single-deal view — phases, escrow timeline, P&L, comps, financing | `deals`, `properties`, `deal_milestones`, `deal_expenses`, `v_deal_cost_breakdown` | Phase changes write `deals`. Inline editable ARV/dates. PDF spec-sheet gen. |
| **Condition** | `condition-review.html` | QA of AI-scored condition tiers (T1–T6, T5 sub-tiers) | `properties` (condition_*) | Paginated cards + photo grids. Overrides patch a single card. Part of the Data hub tab strip. |
| **Import Hub** | `import.html` | CSV import + batch geocoding + missing-schools fill | `properties`, `import_history` | Manual counterpart to the automated pipeline. Multi-event MLS dedup + sold-lock rules. Part of the Data hub tab strip. |
| **Money** | `money.html` | Financial dashboard — per-deal P&L, capital position, 90-day cash runway | `deal_pnl_v1`, `deals`, `capital_sources`, `deal_loans`, `qbo_*`, runway/overhead views | Manual Refresh button. Paginated `deal_expenses` (1000-row batches). |
| **Chat** | `chat.html` | Natural-language SQL over the live DB (Claude via Edge Function) | all (read-only), `chat_history`, `chat_quota` | Calls the `chat-sql` Supabase Edge Function, which runs the generated SQL through the sandboxed read-only `execute_select` RPC. |
| **Login** | `login.html` | OAuth + magic-link auth gateway | — | Role gate; rejected users see a banner. |
| **Index** | `index.html` | Redirect splash → `pipeline.html` | — | — |

> Scratch/working files, not real pages: `mockup-*.html`, `*-preview.html`, `*-typography.html`, and `_pd-local.html` (a local project-detail harness).

### Shared UI patterns (worth knowing before editing)
- **Custom dropdowns, not native `<select>`** — the office uses a Tesla browser that doesn't render native selects. Dropdowns are a button + absolutely-positioned div.
- **Functions are called from `onclick="…"` strings inside template literals.** A function can look unused but be invoked from a generated HTML string — always grep the whole file before deleting anything (see §7).
- **Photo lightbox** — images come from R2 at `https://photos.dottyhomes.com/{mls}/{mls}_NN.jpg` (NN zero-padded); the grid tolerates missing slots via `onerror`.
- **Modals** — `.modal-bg` + `.modal`, close on outside-click / Escape.

---

## 3. Data model

**29 tables, 7 views.** Approximate row counts shown to convey scale. Grouped by domain:

### Listings & scoring (the property-centric core)
| Table | ~Rows | What |
|-------|-------|------|
| `properties` | 22,654 | The atomic unit — every listing/comp. Wide (listing fields, geo, schools, condition tier, photo_count, agent contacts, remarks). MLS# is the key. |
| `arv_estimates` | 3,984 | Per-listing After-Repaired-Value estimates (keyed by mls; newest `computed_at` wins). |
| `deal_scores` | 6,139 | Per-listing underwriting score: rehab budget, spread %, letter grade. |
| `t5_relabel` | 3,747 | Condition T5 sub-tier relabel staging. |
| `import_history` | 386 | Audit log — one row per CSV import run. |
| `properties_audit_log` | — | Row-level change audit. |
| `seller_offers`, `deal_documents` | — | Listing-side offers / documents. |

### Deals & pipeline
| Table | ~Rows | What |
|-------|-------|------|
| `deals` | 43 | An in-flight acquisition. Links `buy_side_mls` / `relist_mls` → `properties`. Has `phase`, dates, prices, `qbo_project_id`. |
| `deals_phase_history` | — | Phase transition log. |
| `deal_milestones` | 28 | Tasks/milestones (deal-scoped or global with `deal_id=NULL`). |
| `deal_phase_checklist_items`, `phase_checklist_templates`, `escrow_milestone_templates` | — | Phase checklist + escrow milestone seeding. |
| `deal_budgets` | 37 | Rehab budget snapshots. |

### Money & QBO
| Table | ~Rows | What |
|-------|-------|------|
| `qbo_transactions` | 25,081 | One-way mirror of QuickBooks Online transactions. |
| `deal_expenses` | 8,200 | QBO expense lines routed to deals via `qbo_project_id`. |
| `qbo_account_categories` | 121 | QBO account → bucket mapping. |
| `capital_sources` | 10 | Funding sources (cash/HML/etc.). |
| `deal_loans`, `qbo_sync_state`, `qbo_reconciliation_baseline`, `qbo_token_backup` | — | Loans, sync cursor, reconciliation baseline, QBO refresh-token warm backup. |

**Finance views** (read by Money): `deal_pnl_v1`, `capital_source_balances_v1`, `cash_by_class_v1`, `cash_runway_v1`, `open_payables_v1`, `portfolio_overhead_v1`, `v_deal_cost_breakdown`.

### Config / auth / misc
`config` (pipeline config, e.g. rehab categories) · `user_roles` (owner/worker) · `agents` · `device_tokens` (APNs push) · `chat_history`, `chat_quota` (Chat page).

### App-relevant RPCs (functions)
| Function | Used by |
|----------|---------|
| `current_user_role` | auth gate / RLS |
| `get_distinct_cities` | Comp Check city dropdown (sold cities) |
| `get_distinct_scored_cities` | Condition city dropdown (scored cities) |
| `get_user_display_names` | user display |
| `execute_select` | Chat — sandboxed read-only SELECT |
| `seed_deal_milestones[_v2]`, `seed_deal_phase_checklist_items`, `snapshot_deal_budget`, `sync_deal_phase_to_properties_stage`, `trigger_seed_deal_milestones_on_phase_change` | deal/phase automation triggers |

> The DB also exposes many `gtrgm_*` / `*_similarity` functions — those come from the `pg_trgm` extension (used by the address search index), not app code.

---

## 4. Backend pipeline (summary — full docs in `~/dotty-agents`)

The backend is **Python on a Mac mini**, scheduled by **launchd**. It scrapes The MLS, ingests CSVs, enriches each property, and syncs QuickBooks. Detailed docs live in the dotty-agents repo (`SETUP.md`, `STATUS.md`, `daily_pipeline/HANDOFF.md`, `arv_estimator/HANDOFF.md`, `money/HANDOFF.md`, `themls_scraper/HANDOFF.md`).

### Jobs → tables → cadence
| Job | Schedule (PT) | Writes | Notes |
|-----|---------------|--------|-------|
| **Hotsheet scrape + pipeline** | 08:00, 11:00, 14:00, 17:00, 20:00 (5×) | `properties`, `import_history`, `arv_estimates`, `deal_scores`, photos→R2 | THEMLS Playwright scrape → CSV → import → geocode → schools → ARV → deal-score → condition tier → push notify → Slack summary. |
| **Saved-search scrape + pipeline** | 22:00 (1×) | same as above | Catches 24h-new / coming-soon listings. |
| **Condition sweep** | 02:00 nightly | `properties` (condition_*, photo_count, notified_at) | Self-heal: re-score untiered `unread` listings whose photos arrived late. |
| **QBO sync** | 04:00 nightly | `qbo_transactions`, `qbo_sync_state`, `deal_expenses`, `deals`, `deal_loans` | One-way QBO → Supabase mirror; routes expenses to deals. |
| **QBO reconciliation** | 04:30 nightly | — (Slack alert) | Diffs mirror vs QBO TrialBalance; alerts on >$1 drift. |
| **ARV monthly retrain** | day 16, 04:00 | `arv_estimates` | Re-fit per-city models with corrected condition labels. |
| **DB health check** | day 1, 05:00 | — (Slack) | Index/bloat/IO snapshot via Management API. |

**Enrichment chain** (each pipeline run, per new/changed listing): geocode (Google → Census fallback) → schools (GreatSchools) → ARV (per-city regressions, Cerritos has a smart-comps model) → deal score (rehab + financing + closing → spread% → grade) → condition tier (headless `claude -p` on the photo gallery) → photo-count reconcile to R2 → push notify (T1/T2 listings → APNs).

Feedback channel is **Slack** (one summary per run; crashes and QBO drift alert).

---

## 5. Cadences & freshness ⚠️ (read this — it's the easy thing to confuse)

There are **two unrelated "every few hours" numbers**. They are not the same thing:

| What | Cadence | Where |
|------|---------|-------|
| **MLS data is pulled** into `properties` | **6× per day** (5 hotsheet + 1 saved-search, see §4) | Backend scraper on the Mac mini |
| **The MLS Deals address-search index refreshes** | **every 3h while the tab is open** + on tab re-focus | `mls-deals.html`, client-side |

Other client-side freshness behavior:
- **Most pages load once** on navigation and re-fetch on reload. No realtime subscriptions.
- **Money** refreshes only on its manual Refresh button.
- **MLS Deals address search** preloads a compact in-memory index of all listings on first focus (~one-time burst), then filters in-memory per keystroke (instant). It polls a tiny `max(updated_at)` watermark every 3h / on refocus and only rebuilds when the data actually changed. So search results can be up to one data-pull stale until that poll fires — acceptable given the 6×/day pull cadence.

If search ever seems to be "missing" a brand-new listing, it's this index being slightly stale — reload, or wait for the watermark poll.

---

## 6. Infrastructure & ops

### Deploy (frontend)
- **Auto-deploy from git push.** Cloudflare Pages is wired to this repo; pushing to `main` publishes to `backstage.dottyhomes.com` within ~1–2 min. (Verified: live site serves the latest commits with no manual step.)
- **Shared assets are cached ~4h.** After a push, `auth.js` / `sidebar.js` / `backstage.css` and page HTML can be served stale from cache. **Hard-refresh (Cmd+Shift+R)** to see a change immediately; don't re-edit thinking the change didn't land.

### Photos
- Stored in **Cloudflare R2** (`dotty-photos` bucket), served at `https://photos.dottyhomes.com/{mls}/{mls}_NN.jpg`.
- The zone is on Cloudflare but **image Transformations are not enabled** — grids currently load full-res JPEGs. Enabling `/cdn-cgi/image/…` resizing is the lever for faster photo grids (deferred).

### Database & migrations
- **Supabase project** `pwrnywsojomrygsiezzi`. Anon key (browser, RLS-gated) vs service-role key (backend only).
- **Migrations** are SQL files in `~/dotty-agents/supabase/migrations/`, applied via `python scripts/apply_migration.py <file>` (uses the Supabase **Management API** + `SUPABASE_PAT`; avoids the IPv6-only pooler). Naming moved from `0NN_name.sql` to timestamped `YYYYMMDDhhmmss_name.sql`.
- **Direct admin queries** (read-only debugging) can go through the service-role key via the REST API, or arbitrary SQL via `apply_migration.py` with a `SELECT`.

### Secrets
- Backend secrets live in `~/dotty-agents/.env` (gitignored): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_PAT`, `SUPABASE_DB_PASSWORD`, `GOOGLE_GEO_KEY`, `THEMLS_*`, `R2_*`, `QBO_*`, `DOTTY_SLACK_WEBHOOK_URL`, `SEND_PUSH_SECRET`. (Names only — see `.env.example` there.)
- The frontend ships only the **anon key**.

---

## 7. Performance characteristics

The hot paths were tuned (2026-06); the patterns below are deliberate:

- **MLS Deals address search** — in-memory index + watermark refresh (§5), not a per-keystroke DB query.
- **Comp Check** — search/browse use an explicit **19-column projection** (not `select('*')`); Browse runs `count:'exact'` only when the filter changes, not on every page turn; city dropdown is server-side `DISTINCT` via RPC.
- **Condition** — the 4 stat counts are **debounced** so clicking through cards doesn't fire ~200 full-table counts; city dropdown via `get_distinct_scored_cities` RPC.
- **MLS Deals bulk loaders** (`bulkLoadDealScores`, `loadArvEstimates`, off-market relist) run **chunked + parallel** (`Promise.all`), not serially.
- **`pg_trgm` GIN index on `properties.address`** backs all `ILIKE '%…%'` searches app-wide.

**Known remaining levers (deferred):**
- MLS Deals re-renders its full (~up to 2000-row) list as one `innerHTML` on every sort/filter — list virtualization would be the next big win.
- Photo grids load full-res images — enable Cloudflare image Transformations and point grids at resized URLs.

---

## 8. Gotchas — things that bite you

1. **Two repos.** Frontend changes → `~/backstage`. Backend/pipeline/migrations → `~/dotty-agents`. A "stack" change can touch both (e.g. a new RPC: migration in dotty-agents, client call in backstage).
2. **Deploy cache.** After pushing, hard-refresh; assets cache ~4h. The change is live even if your browser shows the old one.
3. **Don't delete "unused" JS by eye.** Functions are invoked from `onclick="…"` inside template literals — grep the whole file for the name first. Dead-code removal here has bitten before.
4. **Cadence confusion.** Data pulls = 6×/day (backend). The 3h number is only the MLS Deals search-index poll. Don't conflate.
5. **Sold/terminal listings lock.** The importer never updates rows with a terminal `change_type` (sold/cancelled/expired/withdrawn). See `~/dotty-agents/daily_pipeline/SOLD_LOCK_FIX.md`.
6. **Anon key is RLS-gated.** Browser queries only see what RLS allows for the signed-in user; "missing" data in the frontend is often a policy, not a bug.
7. **Roles are only `owner`/`worker`.** No other role values exist.
8. **Relocated features leave stubs.** Geocoding + missing-schools moved to the Import Hub; some pages had dead leftovers (since removed). When in doubt about whether a UI exists, check the page body for the actual entry point, not just the JS.

---

*Last updated 2026-06-07. Frontend = this repo; backend detail = `~/dotty-agents` (`SETUP.md`, `STATUS.md`, per-module `HANDOFF.md`).*

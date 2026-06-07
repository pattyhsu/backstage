# Backstage (frontend)

The **Backstage** UI for Dotty Homes — internal real-estate ops: sourcing listings, underwriting deals, tracking projects, and watching the money.

This repo is **static HTML** (one file per page, inline JS, `supabase-js` with the anon key). It's a **display layer** over data owned by the backend. There's no build step — pushing to `main` auto-deploys to `backstage.dottyhomes.com` via Cloudflare Pages.

## Architecture

The whole-stack architecture (this frontend **and** the `dotty-agents` backend that feeds it — pipeline, data model, cadences, infra, gotchas) lives in the backend repo, the system of record:

**→ `~/dotty-agents/ARCHITECTURE.md`**

## Heads-up

- **Deploy cache:** after a push, hard-refresh (Cmd+Shift+R) — shared assets cache ~4h.
- **Don't delete "unused" JS by eye:** functions are called from `onclick="…"` strings inside template literals — grep the whole file for the name first.

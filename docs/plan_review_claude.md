# Review of Modernization and Full-Stack Transition Plan

**Overall verdict: Solid and well-reasoned, with a few areas worth scrutinizing.**

---

## What's Good

**Next.js + Turbopack** is the right call. Given the codebase is 481 lines of React across 3 files, the overhead of a custom Webpack 2 setup is unjustifiable. The migration to Next.js App Router kills two birds at once (bundler upgrade + API routes). No objections here.

**MapLibre over Mapbox** is a smart choice. The existing `config/mapbox_token.js` is already a liability — a hardcoded token sitting in the repo. Switching to MapLibre eliminates that dependency entirely.

**DuckDB for TLC data processing** is the right modern answer. The original BigQuery approach made sense in 2017 but DuckDB can process Parquet files from the TLC data portal locally before seeding NeonDB. This is practical and pragmatic.

**NeonDB + Drizzle** is a reasonable stack for Vercel deployment. The serverless PostgreSQL fits the hosting model well.

---

## Concerns & Gaps

### 1. The phasing has a risky gap

Phase 1 says "refactor to functional components + upgrade deps, running on local static data." The problem: deck.gl v6 → v9 is a **breaking API change** (layers renamed, props changed, coordinate systems shifted). Doing this simultaneously with a React 16 → 18 + Next.js migration means two large surfaces of breakage at once. If something doesn't render, debugging is painful.

**Suggestion:** Either upgrade deps first while keeping Webpack (validate rendering works), *then* migrate to Next.js — or accept the risk and budget time for it explicitly.

### 2. No mention of the existing `data/mapbox_token.js` exposure

This file likely has a real token in it (or did at some point). Before any work begins, that token should be rotated/revoked and moved to environment variables (`.env.local`). This should be a prerequisite step, not an afterthought.

### 3. Vector tile hosting decision is deferred when it matters early

The plan says "host `.mbtiles` files or serve dynamically via Martin or pg_tileserv." These are meaningfully different infrastructure decisions. `Martin` requires a running sidecar service; static file hosting on Vercel's CDN is simpler but less flexible. This should be decided before Phase 3 since it affects whether PostGIS hosting on NeonDB is even needed for buildings.

### 4. shadcn/ui adds non-trivial setup

shadcn/ui is component code that gets copied into your repo (it's not a traditional npm package). That's fine, but it means Tailwind configuration has to be done correctly upfront. If the UI design is already specified via screenshots (mentioned in the plan), this is low-risk. Just worth noting it's more setup than a typical library install.

### 5. Socrata caching strategy needs specifics

The plan says "Next.js API routes will cache downstream requests." Next.js fetch caching behavior is non-trivial in App Router — the default can be aggressive or non-existent depending on whether you're in a Server Component, Route Handler, or using `revalidate`. This should be made explicit (e.g., `revalidate: 3600`) rather than assumed.

### 6. User authentication in Phase 3 is scope creep

"User authentication to save favorite map views" is mentioned almost casually at the end of Phase 3. This is a significant feature (auth provider choice, session management, user data storage). Unless this is a known product requirement, it should be removed from scope to keep focus.

---

## Minor Observations

- The clarification in Section 3 that **both MapLibre and deck.gl are needed** is helpful and worth keeping in the final docs.
- ObservableHQ + Arquero for EDA is a nice suggestion, though optional. Jupyter (already in this repo as `mv_collision_bigQuery.ipynb`) would work too and avoids learning a new tool.
- The plan doesn't mention TypeScript, but Drizzle ORM and shadcn/ui are both TypeScript-first. If TypeScript isn't adopted, expect friction. Worth deciding explicitly.

---

## Summary

| Area | Assessment |
|---|---|
| Bundler/Framework migration | Correct |
| Map library choice | Correct |
| DB stack (NeonDB + PostGIS + Drizzle) | Solid |
| Data processing (DuckDB) | Good pragmatic choice |
| Deployment (Vercel) | Appropriate for this scale |
| Phase 1 simultaneous breaking changes | Risk not acknowledged |
| Token security | Missing as prerequisite |
| Vector tile infra decision | Deferred when it shouldn't be |
| Auth in Phase 3 | Likely scope creep |
| TypeScript stance | Not addressed |

The plan is a legitimate, modern architecture — not over-engineered and appropriate for the project's scale. The main thing to push back on is the phasing: the dep upgrade + framework migration happening simultaneously deserves a clearer risk acknowledgment or an explicit split.

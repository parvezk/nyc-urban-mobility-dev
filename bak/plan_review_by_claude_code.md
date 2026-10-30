# Implementation Plan Review

Review of `implementation_plan.md.resolved` — Modernization and Full-Stack Transition Plan.

---

## What's Well Done

**Tech stack choices are pragmatic:**
- Next.js + Turbopack is the right call to replace Webpack 2 — zero-config, full-stack, and production-ready out of the box
- MapLibre over Mapbox GL is smart — avoids the 2021 Mapbox licensing change that broke open-source projects
- DuckDB for local TLC data processing is clever given the SQL familiarity, and avoids cloud costs during the ETL phase
- NeonDB + Vercel is a natural pairing with first-class integration and zero infra overhead
- Drizzle ORM is lightweight and TypeScript-native, ideal for this scale

**The phased roadmap is logical** — running Phase 1 purely on static local data before introducing the DB layer keeps scope manageable and lets you validate the UI independently.

---

## Gaps & Concerns Worth Addressing

**1. TypeScript not mentioned**
The plan recommends Drizzle ORM (which is TypeScript-native) and Next.js App Router (where TypeScript is the default) but never explicitly commits to TypeScript. For a migration of this scale, TS should be a stated requirement, not assumed.

**2. The custom TripsLayer GLSL shaders are unaddressed**
The `trips-layer/` directory contains a fully custom WebGL layer with hand-written vertex/fragment shaders. Deck.gl v9 ships a built-in `TripsLayer` that likely replaces this. The plan should explicitly state: *migrate to the native `TripsLayer` or port the custom shaders to the v9 `CustomLayer` API.* This is non-trivial and shouldn't be buried inside "refactor DeckglOverlay.js."

**3. Deck.gl v6 → v9 is a major breaking change**
The plan mentions upgrading Deck.gl as if it's a dependency bump. Going from v6.4 to v9 involves several API renames, prop changes, and lifecycle method changes. Phase 1 should explicitly call out a Deck.gl migration spike before the full refactor.

**4. State management not addressed**
The current app manages animation state (time loop), layer toggles, and viewport in a single class component. The plan says "refactor to functional components with hooks" but doesn't address where shared state lives. For this app's complexity, a lightweight store (Zustand or Jotai) would be worth naming explicitly.

**5. Vector tile serving on Vercel is unclear**
The plan suggests Martin or `pg_tileserv` for serving `.mbtiles` vector tiles, but both are persistent Rust/Go servers — they don't run on Vercel's serverless functions. You'd need a separate hosting decision (Railway, Fly.io, or a static CDN like Cloudflare R2 + a tile proxy). This is a real architectural gap.

**6. Map dark style replacement not mentioned**
The project uses a custom `map-style-dark-v9-no-labels.json` — a modified Mapbox proprietary style. Switching to MapLibre means this style won't work as-is. You'll need a MapLibre-compatible open-source alternative (e.g., a MapTiler or Protomaps dark style). Phase 1 should include this.

**7. No testing strategy**
No mention of unit tests, component tests, or E2E coverage. Given the complexity of animated WebGL layers, at minimum a smoke test suite (Playwright or Cypress for visual regression) would be worth including in Phase 3.

---

## Minor Notes

- Phase 3 mentions "user authentication" somewhat casually — this is a significant feature that deserves its own scoping if it's a real requirement
- The Socrata App Token should be flagged as a secret that goes into `.env.local` / Vercel environment variables (not hardcoded)
- Cost model for NeonDB + Vercel at scale (many concurrent users hitting the API routes) isn't discussed

---

## Summary

| Area | Assessment |
|---|---|
| Frontend stack | Excellent |
| Database/backend | Solid |
| Data pipeline (DuckDB) | Smart, practical |
| Deployment | Good fit |
| Custom shader migration | Not addressed |
| Deck.gl upgrade path | Underestimated |
| Vector tile serving | Architectural gap |
| TypeScript | Assumed, not stated |
| Testing | Missing |

The plan is production-quality thinking overall. The biggest risk is the custom TripsLayer/WebGL migration and the vector tile hosting decision — those are the two items I'd resolve before committing to the roadmap as written.

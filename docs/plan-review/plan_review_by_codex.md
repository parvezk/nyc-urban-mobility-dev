# Plan Review by Codex

## Overall Assessment

The plan is directionally strong: it correctly identifies the need to modernize the frontend, move heavy data work off the browser, and introduce a spatial database + API layer. The biggest issues are sequencing, production assumptions (especially tiles + hosting), and missing operational constraints. As written, it is likely to create rework during implementation.

## Findings (Highest Priority First)

### 1. Vector tile serving strategy is not deployment-compatible as written

- `docs/implementation_plan.md.resolved:43` proposes hosting `.mbtiles` files or serving with `Martin` / `pg_tileserv`.
- `docs/implementation_plan.md.resolved:49` proposes Vercel as the deployment target for the full stack.

Why this is a problem:

- `Martin` / `pg_tileserv` are long-running services and are not a natural fit for Vercel serverless functions.
- `.mbtiles` is a SQLite container; “hosting static `.mbtiles`” is not the same as serving vector tiles efficiently to browsers.
- This is the highest-risk architecture gap because buildings/tiles are central to Manhattan-scale performance.

Recommendation:

- Choose one explicit tile strategy now:
- `PMTiles + object storage/CDN` (best fit for Vercel-hosted frontend/API).
- Dedicated tile service (`Martin`, `Tegola`, `pg_tileserv`) deployed outside Vercel.
- Pre-rendered tiles served from a CDN if update frequency is low.

### 2. Phase ordering will cause avoidable rework

- `docs/implementation_plan.md.resolved:64` starts with a frontend port, while API/data contracts are defined later in Phase 2.

Why this is a problem:

- A map-heavy app’s frontend shape is driven by data contracts (query params, aggregation levels, tile schema, filters, latency budget).
- Porting UI/components before defining backend payloads will likely lead to refactors in state management and layer wiring.

Recommendation:

- Add a `Phase 0` for architecture validation:
- define data contracts for 2-3 core interactions,
- pick tile strategy,
- stand up one backend vertical slice,
- measure latency and payload sizes.

### 3. Turbopack is treated as a primary architectural decision instead of an implementation detail

- `docs/implementation_plan.md.resolved:11` frames Next.js + Turbopack as the migration choice.

Why this is a problem:

- The critical decision is `Next.js (or not)` and app boundaries, not the dev bundler.
- Deck.gl / map tooling upgrades can be sensitive to bundler/runtime differences; locking into Turbopack early increases migration risk for limited architectural gain.

Recommendation:

- Reframe this as: “Adopt Next.js App Router; use the default supported bundler path first, enable Turbopack opportunistically after compatibility is validated.”

### 4. MapLibre migration is underspecified and likely to break current map styles

- `docs/implementation_plan.md.resolved:17` recommends switching to MapLibre.
- Current code uses Mapbox token + Mapbox style references (`app.js`, e.g. `MAPBOX_STYLE1`, `MAPBOX_TOKEN`).

Why this is a problem:

- MapLibre is not a drop-in replacement for Mapbox-hosted style URLs and assets.
- The plan does not address basemap style source, sprites/glyphs, attribution, or token removal.

Recommendation:

- Add a migration sub-plan:
- choose a MapLibre-compatible style source,
- validate label/sprite/glyph hosting,
- define attribution/legal requirements,
- update map initialization/config in a thin adapter first.

### 5. Live Socrata request-time integration is risky as a production data path

- `docs/implementation_plan.md.resolved:39` plans to proxy Socrata requests via Next.js API and cache them.

Why this is a problem:

- Throttling limits and upstream schema/availability make request-time dependency fragile.
- “1,000 requests/hour” is not a production capacity model and may be shared across all users.
- Cache policy is not defined (TTL, stale-while-revalidate, refresh triggers, error fallback).

Recommendation:

- Treat Socrata as an ingestion source, not a runtime dependency, unless the specific feature truly requires near-real-time freshness.
- If runtime proxying is required, define cache behavior and degradation modes explicitly.

### 6. The plan lacks acceptance criteria and performance budgets

- The plan describes technologies but not success metrics (`docs/implementation_plan.md.resolved`, overall).

Why this is a problem:

- “Support all Manhattan without crashing the browser” (`docs/implementation_plan.md.resolved:27`) is not testable as written.
- Without target budgets, implementation choices cannot be evaluated objectively.

Recommendation:

- Add concrete targets, e.g.:
- p95 API latency for pan/zoom queries,
- max payload size per interaction,
- first render time on a reference laptop,
- browser memory ceiling,
- frame rate under representative layer load.

### 7. UI redesign scope is mixed into platform migration

- `docs/implementation_plan.md.resolved:21` introduces Tailwind + `shadcn/ui` as part of core modernization.

Why this is a problem:

- Visual redesign/system migration is independent from data/backend modernization.
- Combining both increases scope and makes it harder to isolate regressions.

Recommendation:

- Split “platform migration” from “UI system refresh.”
- Keep initial port visually close to the current app, then redesign after functional parity.

### 8. Data pipeline guidance is good, but reproducibility is missing

- `docs/implementation_plan.md.resolved:45` proposes DuckDB local processing and seeding NeonDB.

Why this is a problem:

- “Local processing” becomes tribal knowledge without versioned scripts, schemas, and dataset provenance.
- Rebuilds and onboarding will be fragile.

Recommendation:

- Add a reproducible pipeline spec:
- source dataset versions,
- transformation scripts,
- validation checks,
- output schemas,
- seed/import commands,
- refresh cadence.

## Additional Gaps to Add to the Plan

### Testing and Regression Safety

- Add a migration test strategy:
- visual smoke checks for layers,
- API contract tests,
- seed-data fixtures,
- performance regression checks for key interactions.

### Observability and Ops

- Add logging/metrics/error tracking for API routes and tile requests.
- Define rate limiting and caching observability before exposing public endpoints.

### Security and Secrets

- The current repo contains a hardcoded Mapbox token in `app.js`; the modernization plan should explicitly move tokens/secrets to env vars and rotate exposed credentials.

### Cost and Quota Controls

- Add guardrails for Neon compute, Vercel function execution, and third-party API usage.
- Define expected traffic and peak query patterns before committing to serverless economics.

## Recommended Revised Roadmap

### Phase 0: Architecture Validation (new)

- Define 2-3 critical user interactions and their required data contracts.
- Choose tile strategy (PMTiles/CDN vs dedicated tile server).
- Build one vertical slice: frontend map -> API route -> PostGIS query (or tile source).
- Establish performance budgets and baseline measurements.

### Phase 1: Functional Frontend Port (parity first)

- Port to Next.js App Router with minimal UI redesign.
- Upgrade React + deck.gl/react-map-gl/MapLibre (or keep Mapbox temporarily behind an adapter if needed).
- Preserve feature parity on static/local data.

### Phase 2: Backend and Data Pipeline

- Stand up Postgres/PostGIS locally.
- Implement reproducible DuckDB preprocessing and seed scripts.
- Replace local file reads with API-backed queries for one layer at a time.

### Phase 3: Scale and Polish

- Introduce production tile pipeline and caching strategy.
- Optimize query/indexing/materialized views.
- Add UI redesign/design system upgrades, auth, and advanced features (only after core performance is proven).

## Concrete Edits I Recommend Making to the Plan Document

- Replace the Turbopack-centric wording in `docs/implementation_plan.md.resolved:11` with a Next.js-first statement.
- Expand `docs/implementation_plan.md.resolved:17` with a MapLibre migration checklist (style/glyph/sprite/attribution).
- Rewrite `docs/implementation_plan.md.resolved:43` / `docs/implementation_plan.md.resolved:49` to use a single, deployment-compatible tile architecture.
- Add explicit performance SLOs near `docs/implementation_plan.md.resolved:27`.
- Insert a new `Phase 0` before `docs/implementation_plan.md.resolved:64`.
- Move Tailwind/`shadcn/ui` (`docs/implementation_plan.md.resolved:21`) to a later phase unless there is a strong product reason to redesign now.

## Bottom Line

Keep the strategic direction (Next.js + backend + PostGIS + data preprocessing), but tighten the plan around:

- deployment-compatible tile serving,
- data contracts before UI refactor,
- measurable performance goals,
- reproducible pipelines,
- reduced scope coupling (platform migration vs redesign).

That will materially reduce rework and make the modernization effort executable in phases with clear validation gates.

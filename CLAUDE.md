# CLAUDE.md — NYC Urban Mobility

> Project guide for AI-assisted development. Read this file before making any changes.

---

## What This App Does

Interactive 3D geospatial visualization of NYC taxi trip patterns, building footprints, and urban mobility data — rendered via WebGL-powered maps with a minimalist, editorial-style interface.

---

## Architecture

### Core Stack

| Layer | Technology |
|:---|:---|
| **Framework** | Next.js (App Router) + Turbopack |
| **Language** | TypeScript (strict) |
| **Map renderer** | MapLibre GL JS (basemap: Carto Dark Matter) |
| **Data visualization** | Deck.gl v9 (`@deck.gl/react`, `@deck.gl/geo-layers` TripsLayer) |
| **State management** | Zustand (UI state) + Deck.gl internal animation clock |
| **Styling** | Tailwind CSS + shadcn/ui |
| **Database** | Supabase (PostgreSQL + PostGIS) via Drizzle ORM |
| **Data pipeline** | DuckDB (local preprocessing) → Supabase seeding |
| **Vector tiles** | PMTiles (built with tippecanoe, served from static CDN via HTTP Range requests) |
| **Deployment** | Vercel (serverless) |
| **Observability** | Sentry (errors/perf) + PostHog (product analytics) |
| **Testing** | Playwright (visual smoke tests, E2E) |

### Rendering Model (Hybrid SSR/CSR)

- **Server Components (default):** App shell, layouts, metadata, standard data fetching.
- **Client Components (`"use client"`):** MapLibre canvas, Deck.gl overlays, animation-driven UI. Mark explicitly — only when the component needs browser APIs, event handlers, or hooks.

### Library Roles

- **MapLibre GL JS** — Basemap renderer (streets, water, labels).
- **Deck.gl** — Data visualization engine layered on top of basemap (3D arcs, hexagons, scatterplots).
- **PostGIS** — Spatial SQL extension for PostgreSQL (`ST_DWithin`, bounding-box queries).
- **Drizzle ORM** — Type-safe TypeScript SQL query builder/schema manager.
- **Zustand** — Lightweight hook-based state (no Context re-render overhead).
- **PMTiles** — Serverless vector tile archive (HTTP Range requests from CDN).
- **DuckDB** — Local OLAP engine for preprocessing massive TLC datasets.

---

## UX Design Principles

Follow the editorial, data-journalism aesthetic defined in `docs/ux_design_spec.md`. This is **not** a dark-mode developer tool.

### Visual Rules
- **Light theme default** — off-white / soft cream (`#F9F9F8` or `#FAFAFA`)
- **Monochromatic UI** — buttons, typography, sidebars in neutral grays/charcoal only. **Data is the only source of color.**
- **Invisible chrome** — subtle shadows and generous whitespace, no harsh borders
- **Typography** — neo-grotesque sans-serif: `Inter`, `Geist`, `Satoshi`, or `Helvetica Now`
- **Floating panels** — translucent glassmorphism controls overlaying the map, not traditional sidebars
- **Progressive disclosure** — advanced controls hidden by default in collapsible accordions
- **Muted basemap** — light, desaturated style: soft grey roads, pale slate-blue water
- **Vibrant data layers** — yellow-orange-red for congestion, indigo-to-cyan for trip velocity

---

## Coding Conventions

### TypeScript
- All code in `.ts` / `.tsx`. Strict mode.
- Prefer explicit types over `any`.
- `interface` for object shapes, `type` for unions/aliases.

### React
- Functional components only.
- Use hooks (`useState`, `useEffect`, `useMemo`, `useCallback`).
- Never drive animation via React state (`setState` inside `requestAnimationFrame`). Use Deck.gl's animation clock or Zustand for decoupled state.

### Next.js (App Router)
- File-based routing under `app/`.
- `layout.tsx` for shared layouts, `page.tsx` for route entries.
- API endpoints in `app/api/` as Route Handlers.
- `loading.tsx` and `error.tsx` for suspense/error boundaries.
- Metadata via the `metadata` export or `generateMetadata()`.

### Styling
- Tailwind CSS utility-first. Design tokens in `tailwind.config.ts`.
- shadcn/ui components customized to remove heavy borders and match the minimalist spec.
- No raw SCSS.

### State Management
- **Zustand** for global UI state (active layers, filters, panel visibility).
- **Deck.gl internal clock** for animation time.
- Avoid React Context for frequently-changing state.

---

## Performance SLOs

| Metric | Target |
|:---|:---|
| First render | < 1.5s (mid-range laptop) |
| Max payload per interaction | 2 MB compressed JSON/protobuf |
| API latency (p95) | < 200ms for spatial bounding-box queries |
| Frame rate | 60 FPS (Deck.gl internal clock) |

---

## Data & Security

### Environment Variables (`.env.local` — gitignored)
```
SOCRATA_APP_TOKEN=        # NYC Open Data API (raises rate limit to 1k req/hr)
DATABASE_URL=             # Supabase connection string
```

### Data Pipeline
- **DuckDB** — process raw TLC CSV/Parquet into aggregated tables locally
- **tippecanoe** — convert NYC 3D Buildings → `.pmtiles` (one-time local build)
- **PMTiles** — serve tiles from static CDN (Cloudflare R2 / S3) via HTTP Range requests
- **GitHub Actions** — nightly ETL runner for Socrata ingestion (preferred over Vercel Cron for long-running jobs)

### Static Data Assets (`data/`)
- `trips.json` — animated taxi trip paths
- `buildings.json` — 3D building footprints
- `taxi.js` — pickup/dropoff coordinate pairs
- `congestion.json` — congestion zone boundaries

---

## Critical Guardrails

1. **Do not use `requestAnimationFrame` to drive React state.** React 18 concurrent mode breaks this pattern. Use Deck.gl's animation APIs.
2. **Do not use Martin or pg_tileserv** for tile serving. Vercel serverless can't host persistent servers. Use PMTiles on a static CDN.
3. **Do not use the dark hacker aesthetic** (neon accents on black). Follow the editorial light-theme spec.
4. **Do not mix UI redesign into Phase 1.** Phase 1 is graphics parity only — neutral UI.
5. **Do not commit `.env.local`** or hardcode secrets in source files.
6. **Do not use React Context** for high-frequency state (animation time, map viewport). Use Zustand.

---

## Key Documentation

| Document | Purpose |
|:---|:---|
| `docs/implementation_plan.md` | Full architecture & migration strategy |
| `docs/implementation_plan.md.resolved` | Consolidated version with review feedback |
| `docs/ux_design_spec.md` | Brand identity, layout spec, Figma workflow |

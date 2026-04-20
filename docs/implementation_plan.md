# Modernization and Full-Stack Transition Plan

This document outlines the strategy for upgrading the 8-year-old NYC Urban Mobility data visualization project into a modern, production-ready full-stack application.

## 0. Glossary of New Data Tooling & Formats

To help recall the modern geospatial data stack introduced in this plan, here is a quick reference table:

| Term / Tool              | Purpose                                                       | Role in our Stack                                                                     |
| :----------------------- | :------------------------------------------------------------ | :------------------------------------------------------------------------------------ |
| **Socrata (SODA)**       | Open Data API provider used by NYC Open Data.                 | Replaced by daily cron jobs to fetch fresh data sets.                                 |
| **DuckDB**               | Lightning-fast in-process SQL OLAP database.                  | Local preprocessing tool to aggregate massive raw TLC CSV/Parquet files.              |
| **tippecanoe**           | Mapbox CLI tool to build vector tilesets from large datasets. | Used to locally compress the giant NYC 3D Buildings data into `.pmtiles`.             |
| **PMTiles**              | Serverless single-file archive format for vector tiles.       | Allows us to host massive NYC 3D building maps on a static CDN (no backend required). |
| **Martin / pg_tileserv** | Persistent Go/Rust servers that dynamically stream tiles.     | _Rejected_ for our use case, as Vercel serverless architecture doesn't support them.  |

## 1. Glossary of Full-Stack Architecture Tooling

| Term / Tool                | Purpose                                              | Role in our Stack                                                                        |
| :------------------------- | :--------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| **Next.js (App Router)**   | Full-stack React framework.                          | Handles both the frontend UI shell (Server Components) and spatial API endpoints.        |
| **Supabase (recommended)** | Managed PostgreSQL provider.                         | Stores all spatial datasets, scales robustly, and provides built-in Auth.                |
| **PostGIS**                | Spatial extension for PostgreSQL.                    | Drives geospatial queries (e.g., `ST_DWithin` to find trips inside a radius).            |
| **Drizzle ORM**            | Type-safe TypeScript ORM.                            | Manages database schemas and executes SQL queries from Next.js APIs.                     |
| **MapLibre GL JS**         | Open-source vector tile 2D basemap renderer.         | Renders basemaps (Carto Dark Matter), streets, and labels below the data canvas.         |
| **Deck.gl**                | High-performance WebGL Data Visualization framework. | Sits on top of the basemap drawing all 3D trip arcs, hexagons, and scatterplots.         |
| **Zustand**                | Lightweight, hook-based state manager.               | Handles UI configuration and animation loop state without slow React Context re-renders. |

---

## 2. Prerequisite: Security & Token Management

Before any work begins, we must address the exposed API token risk.

- **Revoke Existing Tokens**: The existing codebase contains a hardcoded Mapbox token in `app.js`. This token must be immediately rolled/revoked via the Mapbox Dashboard.
- **Environment Variables**: We will establish a `.env.local` file for local development to securely handle any replacement API keys.

---

## 2. Architecture & Performance Goals

The primary architectural shift is defining clear boundaries between the server (Next.js / NeonDB) and the WebGL client.

### Core Stack

- **Framework**: Adopt Next.js (App Router).
- **Rendering Approach (Hybrid)**: The shell of the app, layouts, standard API data fetching, and HTML metadata will use **Server Components (SSR)**. The MapLibre and Deck.gl components must be isolated as **Client Components** (`"use client"`).
- **Map Provider**: Switch from proprietary Mapbox GL JS to **MapLibre GL JS**.
  - _Basemap Fix_: We will use **Carto Dark Matter** (a free, MapLibre-compatible style) to replace the broken `mapbox://styles/mapbox/dark-v9`.
- **Database Layer**: **Supabase** (Managed PostgreSQL) with **PostGIS** for advanced spatial queries, interfaced via **Drizzle ORM**.

### Performance SLOs & Budgets

- **First Render**: Under 1.5s on a mid-range laptop.
- **Payload Limits**: Max 2MB of compressed JSON/protobuf payload per interaction.
- **API Latency**: p95 API latency < 200ms for bounding-box pan/zoom spatial queries.
- **Frame Rate**: Maintain 60FPS using Deck.gl's internal clock rather than expensive React state.

---

## 3. Data Integration Pipeline

To ensure the architecture is reproducible, the data pipeline will be codified.

### Reference Data Sources
*Because we are abandoning static `trips.json` loading, we must pull directly from the canonical NYC open portals. For our ETL pipeline, we will source data strictly from the following:*

| Dataset | URL / Portal | Description & Scope |
| :--- | :--- | :--- |
| **NYC TLC Trip Records** | [NYC.gov Parquet Portal](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page) | Primary data source. We will download the Parquet files for **Yellow Taxi** and **High Volume For-Hire Vehicles (HVFHV) (Uber/Lyft)** to map comprehensive mobility. |
| **NYC 3D Buildings** | [NYC Open Data Portal](https://data.cityofnewyork.us/Housing-Development/Building-Footprints/nqwf-w8eh) | Shapefiles of 1m+ building footprints. Used by `tippecanoe` to generate our `.pmtiles` vector tileset. |
| **Taxi Zones Map** | [NYC Open Data Portal](https://data.cityofnewyork.us/Transportation/NYC-Taxi-Zones/d3c5-ddgc) | GeoJSON mapping TLC "Location IDs" to actual physical polygon boundaries across the boroughs. |

- **Reproducible Data Scripts (DuckDB)**: We will use **DuckDB** locally via Node.js to aggregate the massive raw CSV/Parquet files of TLC trips, outputting schemas directly to Supabase.
- **Automated Ingestion (GitHub Actions vs Vercel Cron)**: Instead of treating the NYC Socrata API as a fragile runtime dependency, we will automate ingestion. **GitHub Actions** is highly scoped here to act as a robust, decoupled ETL runner (ideal because Action runner limits vastly exceed Vercel's tight serverless function timeouts). The GitHub Action can run nightly, pull down massive datasets, process them via DuckDB, and seed them into Supabase or Push them to static storage, complementing basic Vercel Cron triggers.
- **Vector Tile Pipeline (3D Buildings)**: We will convert the massive NYC 3D Building model locally using `tippecanoe` into the **PMTiles** format. PMTiles allows MapLibre to read tiles directly via HTTP Range requests from a static CDN (Cloudflare R2, AWS S3), achieving true Serverless map hosting without needing `Martin` or `pg_tileserv`.

---

## 4. Development Infrastructure & Tooling

- **Rip & Replace (Greenfield)**: Instead of refactoring the 8-year-old React 16 + Webpack codebase line-by-line, we are treating this as a Greenfield port. We will bootstrap `create-next-app` and selectively copy over _only_ the raw data.
- **Delete Custom WebGL Layers**: The custom, hand-written GLSL shaders in `trips-layer/` will not be ported. We will replace them entirely with the official, modern `@deck.gl/geo-layers` built-in `TripsLayer`.
- **React 18 Concurrency**: We will abandon the legacy `requestAnimationFrame` loop that drives React state (`this.setState({ time })`). React 18 will choke on this. Instead, we will use Deck.gl's internal animation loop APIs to drive time parameters independently of React's render cycle.
- **TypeScript**: We will rewrite all newly ported components natively in TypeScript.
- **Testing & Safety**: Visual smoke checks using **Playwright**.

---

## 5. Observability, Cost & Quota Controls

- **Logging & Metrics**: We will implement **Sentry** for comprehensive error tracking and performance monitoring. For product analytics, we will use **PostHog**.
- **Rate Limiting**: Implement upstream rate limiting and edge caching observability.
- **Compute Guardrails**: Define explicit Supabase compute size ceilings and Vercel serverless function execution timeouts to prevent runaway spend.

---

## 6. Revised Roadmap (5 Phases)

### Phase 0: Architecture Validation - R&D/Spike Sandbox

- Delete Mapbox keys and map data schemas.
- Validate Carto Dark Matter style compatibility in a MapLibre test script.
- Convert 3D Buildings into `.pmtiles` and test local HTTP Range fetching.
- **[Ingestion Research]** Research 2025-2026 TLC Yellow Taxi data via direct Parquet downloads from the NYC CDN (bypass Socrata API limits).

### Phase 1: Greenfield Rip & Replace (Parity First)

- Bootstrap a fresh Next.js App Router (TypeScript) project. Do not port Webpack.
- Install `@deck.gl/react` and `maplibre-gl`.
- Delete the legacy `trips-layer/` directory and use the standard Deck.gl `TripsLayer`.
- Re-implement the map components from scratch, achieving parity with the old project using the static local data.
- _Keep the UI strictly neutral/original to isolate graphics migration risk._

### Phase 2: Backend and Data Pipeline (Parallelizable)

- Stand up Postgres/PostGIS (local + Supabase).
- Implement the reproducible DuckDB preprocessing scripts.
- Replace local file reads on the frontend with API-backed queries for one layer at a time.

### Phase 3: Scale and Polish

- Introduce the production PMTiles pipeline and live edge caching strategy.
- Implement the Vercel Cron scheduled ingestion script for live Socrata data.

### Phase 4: UI Redesign & UX Refresh (Parallelizable)

- Introduce Tailwind CSS and `shadcn/ui`.
- Execute the Figma Hand-off and implement the minimalist "Anti-DevTool" editorial aesthetic scoped in the `ux_design_spec.md` document.

---

## 7. Task Tracker

Progress checklist across all phases. Ticket IDs map to the project backlog.

### Phase 0: Architecture Validation & Security
- [x] **[PK-165]** Revoke Mapbox keys from legacy codebase & establish `.env.local`
- [x] **[PK-166]** Create simple HTML MapLibre script to validate Carto Dark Matter style
- [ ] **[PK-167]** Convert 3D Buildings into `.pmtiles` (setup tippecanoe)
- [ ] **[PK-200]** Ingest 2025-2026 TLC Yellow Taxi data via direct Parquet downloads

### Phase 1: Greenfield Rip & Replace
- [x] Initialize `create-next-app` (TypeScript, App Router)
- [x] Setup Tailwind CSS
- [x] Install Deck.gl and MapLibre dependencies
- [x] Copy raw Data folders to the new project
- [x] Rebuild basic Map Component with Carto Dark Matter basemap
- [x] Implement trips using the native `@deck.gl/geo-layers` TripsLayer

### Phase 2: Backend and Data Pipeline
- [x] **[PK-172]** Stand up Postgres/PostGIS (local + Supabase)
- [x] **[PK-173]** Implement DuckDB preprocessing scripts (includes downloading APIs, DuckDB spatial mapping, and OSRM artificial street routing)
- [x] **[PK-174]** Replace local file reads with API-backed queries (Write Next.js API Routes & Supabase seeder)

### Phase 3: Scale and Polish
- [ ] **[PK-175]** Introduce production PMTiles pipeline (CDN strategy for 3D buildings)
- [ ] **[PK-176]** Live edge caching strategy
- [ ] **[PK-177]** Implement GitHub Actions scheduled ingestion script
- [ ] Add Playwright Smoke checks

### Phase 4: UI Redesign
- [ ] Implement minimalist UI aesthetic based on UX Spec
- [ ] Setup shadcn/ui components for layer controls

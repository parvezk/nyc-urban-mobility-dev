# Geospatial App Modernization & Full-Stack Transformation Strategy

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Modernization Strategy](#2-modernization-strategy)
3. [Full-Stack Transformation Plan](#3-full-stack-transformation-plan)
4. [Implementation Phases](#4-implementation-phases)
5. [Architecture Diagrams](#5-architecture-diagrams)
6. [Migration Risk Register](#6-migration-risk-register)

---

## 1. Current State Assessment

### 1.1 Technology Inventory

| Component | Current | Latest Stable | Gap Severity |
|---|---|---|---|
| React | 16.2.0 | 19.x | **Critical** — 3 major versions behind; missing hooks, concurrent mode, server components |
| deck.gl | 6.4.0 | 9.x | **Critical** — 3 major versions; missing WebGPU support, new layer types, perf improvements |
| react-map-gl | 3.2.0 | 7.x | **Critical** — incompatible with Mapbox GL JS v2/v3; new API surface |
| luma.gl | ~5.2.0 | 9.x | **Critical** — tightly coupled to deck.gl; must upgrade together |
| Webpack | 2.2.0 | 5.x | **High** — missing tree-shaking, module federation, asset modules |
| node-sass | 4.8.3 | (deprecated) | **High** — replaced by `sass` (Dart Sass) |
| buble-loader | 0.4.0 | (unmaintained) | **High** — project abandoned; should use Babel or SWC |
| Mapbox GL JS | 0.44.x (implicit) | 3.x | **High** — major perf/feature gaps |
| d3-ease | (missing from package.json) | 3.x | **Low** — works but unlisted |

### 1.2 Architecture Issues

**Structural problems:**
- **Monolithic component** — The `Root` class in `app.js` owns viewport state, data loading, animation loops, settings management, and rendering in a single 245-line file
- **No separation of concerns** — Data fetching, transformation, and presentation are interleaved in component lifecycle methods
- **Class components throughout** — No hooks, no functional components for stateful logic
- **Custom TripsLayer uses deprecated luma.gl API** — Direct `Model`/`Geometry` construction against a now-obsolete WebGL abstraction
- **Duplicate imports** — `DeckglOverlay.js` line 2-3 double-imports `DeckGL`

**Data problems:**
- **10,000+ row CSV embedded in a JS file** (`data/taxi.js` is ~1.2 MB of inline string data parsed at runtime)
- **Static JSON fetched from GitHub raw URLs** — Buildings data pulled from `uber-common/deck.gl-data` on every page load
- **No data pipeline** — All datasets are frozen snapshots with no mechanism for update
- **No server** — Pure client-side SPA; cannot query, filter, or aggregate data dynamically

**Security & operations:**
- **Mapbox token hardcoded** in source code (line 22 of `app.js`)
- **No environment variable management** — `.env` support exists in webpack config but is unused
- **No production build** — Only `webpack-dev-server`; no minification, code splitting, or asset optimization
- **No CI/CD, no linting, no tests, no TypeScript**

**UX/UI issues:**
- **Fixed layout** — 300px sidebar, no responsive design
- **No loading indicators** — Data fetched silently; user sees blank map until ready
- **No error handling** — Fetch failures silently ignored
- **Typo in CSS** — `display: inine-block` (should be `inline-block`)
- **Empty method** — `_switchLabels()` is a no-op

### 1.3 What Works Well (Preserve These)

- The core visualization concept: animated trip trails + 3D buildings + hexagon heatmaps is compelling
- Congestion corridor fly-to navigation is a good UX pattern
- Layer toggle/control panel design is functional
- Custom shader approach for trip animation (though implementation needs updating)
- The overall color palette and dark map aesthetic

---

## 2. Modernization Strategy

### 2.1 Guiding Principles

1. **Incremental migration** — Each phase produces a working application; no big-bang rewrite
2. **TypeScript-first** — All new code in TypeScript; migrate existing files progressively
3. **Modern React patterns** — Functional components, hooks, context; no class components
4. **Vite over Webpack** — 10-100x faster dev server, native ESM, simpler config
5. **Replace deprecated with standard** — Use deck.gl built-in `TripsLayer` (available since v7) instead of the custom one

### 2.2 Frontend Modernization

#### 2.2.1 Build Tooling: Webpack 2 → Vite

**Why Vite:**
- Native ESM dev server (no bundling during development)
- Built on Rollup for production (tree-shaking, code splitting)
- First-class TypeScript and CSS Modules support
- SCSS via `sass` package (drop-in replacement for node-sass)
- Plugin ecosystem for deck.gl GLSL imports if custom shaders are retained

**Migration steps:**
1. Create `vite.config.ts` with React plugin, SCSS support, and env variable handling
2. Move `index.html` to project root (Vite convention) and add `<script type="module" src="/src/main.tsx">`
3. Remove `webpack.config.js`, `buble-loader`, and all webpack-related devDependencies
4. Configure `import.meta.env.VITE_MAPBOX_TOKEN` for secrets

#### 2.2.2 React 16 → React 19

**Key migrations:**
- Replace class components with functional components + hooks
- Replace `componentDidMount` with `useEffect`
- Replace `requestAnimationFrame` loop with a custom `useAnimationFrame` hook
- Replace `window.addEventListener('resize')` with a `useWindowSize` hook or CSS-based responsive layout
- Replace component state with `useState`/`useReducer` for settings and viewport
- Use React Context for shared state (viewport, map instance)
- Adopt `Suspense` + error boundaries for data loading states

**Component refactoring plan:**

```
src/
├── main.tsx                    # Entry point
├── App.tsx                     # Root layout + providers
├── components/
│   ├── Map/
│   │   ├── MapContainer.tsx    # react-map-gl + DeckGL wrapper
│   │   └── layers/
│   │       ├── TripsLayer.ts   # Trips layer config (uses deck.gl built-in)
│   │       ├── BuildingsLayer.ts
│   │       └── HexagonLayer.ts
│   ├── Controls/
│   │   ├── LayerPanel.tsx      # Layer toggles + settings
│   │   ├── CongestionNav.tsx   # Fly-to corridor navigation
│   │   └── SettingControls.tsx # Reusable slider/checkbox components
│   └── UI/
│       ├── Header.tsx
│       └── LoadingOverlay.tsx
├── hooks/
│   ├── useAnimationFrame.ts    # Animation loop hook
│   ├── useMapViewport.ts       # Viewport state + fly-to
│   ├── useLayerSettings.ts     # Layer configuration state
│   └── useDataLoader.ts        # Async data fetching with loading/error states
├── config/
│   ├── layers.ts               # Layer defaults, colors, light settings
│   ├── congestionSpots.ts      # Corridor locations
│   └── mapStyles.ts            # Mapbox style references
├── types/
│   ├── taxi.ts                 # TaxiTrip, Point interfaces
│   ├── layers.ts               # LayerSettings, ViewportState
│   └── geo.ts                  # GeoJSON-related types
└── styles/
    ├── global.scss
    └── components/             # Component-level SCSS modules
```

#### 2.2.3 deck.gl 6 → deck.gl 9

**Breaking changes to handle:**
- `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/aggregation-layers` replace monolithic `deck.gl` import
- `luma.gl` is no longer directly used; deck.gl manages its own WebGL/WebGPU context
- `fp64` prop removed (double precision handled differently)
- `lightSettings` prop replaced by `_lighting` effect or deck.gl `LightingEffect`
- The custom `TripsLayer` can be **deleted entirely** — deck.gl v7+ includes a built-in `TripsLayer` in `@deck.gl/geo-layers` with the same animated trail functionality

**The built-in TripsLayer:**
```typescript
import { TripsLayer } from '@deck.gl/geo-layers';

new TripsLayer({
  id: 'trips',
  data: tripsData,
  getPath: (d) => d.segments,
  getTimestamps: (d) => d.segments.map((s) => s[2]),
  getColor: (d) => vendorColor(d.vendor),
  widthMinPixels: 2,
  trailLength: 180,
  currentTime: animationTime,
});
```

This is a direct replacement that eliminates 150+ lines of custom shader code.

#### 2.2.4 react-map-gl 3 → react-map-gl 7 + mapbox-gl v3

**API changes:**
- `onViewportChange` callback replaced by `onMove` event
- Viewport props replaced by `initialViewState` + controlled/uncontrolled patterns
- `mapboxApiAccessToken` renamed to `mapboxAccessToken`
- Map instance accessed via `useMap()` hook instead of refs
- Native Mapbox GL JS terrain, fog, and globe projection available

#### 2.2.5 Styling: node-sass → sass + CSS Modules

- Replace `node-sass` with `sass` (Dart Sass)
- Adopt CSS Modules (`*.module.scss`) for component-scoped styles
- Fix the `display: inine-block` typo
- Consider Tailwind CSS for utility-first responsive design

### 2.3 Developer Experience

| Area | Current | Target |
|---|---|---|
| Language | JavaScript | TypeScript (strict mode) |
| Linting | None | ESLint + @typescript-eslint + eslint-plugin-react |
| Formatting | None | Prettier |
| Testing | None | Vitest + React Testing Library + Playwright (E2E) |
| Git hooks | None | Husky + lint-staged (pre-commit) |
| CI/CD | None | GitHub Actions (lint → test → build → deploy) |
| Environment | Hardcoded tokens | `.env` files + Vite env variable injection |

---

## 3. Full-Stack Transformation Plan

### 3.1 Motivation

The current app serves **frozen, static datasets**:
- `data/taxi.js` — A hardcoded CSV snapshot embedded in JavaScript
- `data/trips.json` — A local JSON file of trip segments
- Buildings data fetched from a GitHub raw URL

To support dynamic data, the app needs:
1. **A backend API** to query, filter, and aggregate geospatial data on demand
2. **A spatial database** to store and index trip records efficiently
3. **A data ingestion pipeline** to load and update datasets
4. **Real-time capabilities** for live data streaming (WebSockets/SSE)

### 3.2 Proposed Backend Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Client (Browser)                    │
│  React 19 + deck.gl 9 + react-map-gl 7 + Mapbox v3  │
└──────────────────┬───────────────────────────────────┘
                   │ REST / WebSocket
┌──────────────────▼───────────────────────────────────┐
│                  API Server (Node.js)                  │
│            Fastify + TypeScript + tRPC                 │
│                                                        │
│  ┌─────────────┐ ┌──────────────┐ ┌───────────────┐  │
│  │  Trip API    │ │ Building API │ │ Analytics API │  │
│  │  /trips      │ │ /buildings   │ │ /aggregate    │  │
│  │  /trips/ws   │ │              │ │ /heatmap      │  │
│  └──────┬──────┘ └──────┬───────┘ └───────┬───────┘  │
│         │               │                 │            │
│  ┌──────▼───────────────▼─────────────────▼────────┐  │
│  │            Data Access Layer (Drizzle ORM)       │  │
│  └──────────────────────┬──────────────────────────┘  │
└─────────────────────────┬────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────┐
│                  PostgreSQL + PostGIS                  │
│                                                        │
│  Tables:                                               │
│  ├── trips (id, vendor, pickup_at, dropoff_at,        │
│  │         pickup_geom GEOGRAPHY, dropoff_geom, ...)  │
│  ├── trip_segments (trip_id, geom GEOGRAPHY,          │
│  │                  timestamp, sequence)               │
│  ├── buildings (id, geom GEOGRAPHY, height, ...)      │
│  └── congestion_corridors (id, name, geom, metadata)  │
│                                                        │
│  Spatial indexes: GIST on all geography columns        │
└──────────────────────────────────────────────────────┘
```

### 3.3 Technology Choices

#### Backend Runtime: Node.js + Fastify

**Why Fastify over Express:**
- 2-3x faster request handling
- Built-in JSON schema validation
- First-class TypeScript support
- Plugin architecture for WebSocket, CORS, rate limiting
- Shares TypeScript types with frontend (monorepo benefit)

#### API Layer: tRPC

**Why tRPC:**
- End-to-end type safety between frontend and backend (no codegen)
- Automatic type inference — change a query's return type and the frontend immediately knows
- Subscriptions for real-time data (WebSocket transport)
- Works seamlessly with React Query for caching and refetching
- Eliminates the need for OpenAPI/Swagger schemas for internal APIs

#### Database: PostgreSQL + PostGIS

**Why PostGIS:**
- Industry-standard spatial database extension
- Native geography types for lat/lng storage
- Spatial indexing (GIST) for fast bounding-box and radius queries
- Built-in functions: `ST_DWithin`, `ST_MakeEnvelope`, `ST_ClusterDBSCAN`, `ST_HexagonGrid`
- Can compute hexagonal aggregations server-side (offloading from deck.gl client)
- Tile generation with `ST_AsMVT` for vector tiles

#### ORM: Drizzle

**Why Drizzle:**
- TypeScript-first with zero runtime overhead
- SQL-like query builder (transparent — no magic)
- Native PostGIS extension support via `drizzle-postgis`
- Schema-as-code with migration generation
- Excellent performance (no entity tracking overhead)

#### Monorepo: Turborepo

**Why monorepo:**
- Shared TypeScript types between frontend and backend
- Shared configuration (ESLint, Prettier, tsconfig)
- tRPC router types are imported directly by the frontend
- Single CI/CD pipeline
- Turborepo for incremental builds and caching

### 3.4 Database Schema Design

```sql
-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE trips (
  id            BIGSERIAL PRIMARY KEY,
  vendor_id     SMALLINT NOT NULL,
  pickup_at     TIMESTAMPTZ NOT NULL,
  dropoff_at    TIMESTAMPTZ NOT NULL,
  pickup_geom   GEOGRAPHY(POINT, 4326) NOT NULL,
  dropoff_geom  GEOGRAPHY(POINT, 4326) NOT NULL,
  passenger_count SMALLINT,
  trip_distance   NUMERIC(8,2),
  fare_amount     NUMERIC(8,2),
  tip_amount      NUMERIC(8,2),
  total_amount    NUMERIC(8,2),
  payment_type    SMALLINT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE trip_segments (
  id        BIGSERIAL PRIMARY KEY,
  trip_id   BIGINT REFERENCES trips(id) ON DELETE CASCADE,
  geom      GEOGRAPHY(POINT, 4326) NOT NULL,
  timestamp REAL NOT NULL,       -- animation timestamp
  seq       INTEGER NOT NULL     -- order within trip
);

CREATE TABLE buildings (
  id      SERIAL PRIMARY KEY,
  geom    GEOGRAPHY(POLYGON, 4326) NOT NULL,
  height  REAL NOT NULL DEFAULT 0,
  name    TEXT,
  type    TEXT
);

CREATE TABLE congestion_corridors (
  id       SERIAL PRIMARY KEY,
  name     TEXT NOT NULL,
  geom     GEOGRAPHY(POINT, 4326) NOT NULL,
  bearing  REAL DEFAULT 0,
  zoom     REAL DEFAULT 15,
  pitch    REAL DEFAULT 20,
  metadata JSONB DEFAULT '{}'
);

-- Spatial indexes
CREATE INDEX idx_trips_pickup_geom ON trips USING GIST (pickup_geom);
CREATE INDEX idx_trips_dropoff_geom ON trips USING GIST (dropoff_geom);
CREATE INDEX idx_trips_pickup_at ON trips (pickup_at);
CREATE INDEX idx_trip_segments_trip_id ON trip_segments (trip_id);
CREATE INDEX idx_trip_segments_geom ON trip_segments USING GIST (geom);
CREATE INDEX idx_buildings_geom ON buildings USING GIST (geom);
CREATE INDEX idx_corridors_geom ON congestion_corridors USING GIST (geom);
```

### 3.5 API Design

#### Core Endpoints (tRPC Routers)

```typescript
// trips.router.ts
trips.query.getByBounds({
  input: { bbox: [west, south, east, north], timeRange?: [start, end] },
  // Returns trip segments within map viewport for animation
});

trips.query.getHeatmapData({
  input: { bbox, timeRange?, aggregation: 'hexbin' | 'raw', resolution?: number },
  // Returns pre-aggregated hexagon data or raw points
});

trips.subscription.liveTrips({
  input: { bbox },
  // WebSocket stream of new trip data as it arrives
});

// buildings.router.ts
buildings.query.getByBounds({
  input: { bbox: [west, south, east, north] },
  // Returns buildings within viewport
});

// analytics.router.ts
analytics.query.corridorStats({
  input: { corridorId, timeRange },
  // Returns congestion metrics for a specific corridor
});

analytics.query.summary({
  input: { timeRange },
  // Returns dashboard-level aggregations
});
```

#### Key API Patterns

**Viewport-driven loading:**
The frontend sends its current map bounding box with every data request. The backend uses PostGIS `ST_MakeEnvelope` + `ST_Intersects` to return only data visible in the viewport. This replaces loading entire datasets upfront.

**Server-side aggregation:**
Instead of sending 10,000+ raw points to the client for hexagon aggregation, the backend can pre-compute hex bins:

```sql
SELECT
  ST_AsGeoJSON(hex.geom) as geometry,
  COUNT(*) as trip_count,
  AVG(t.fare_amount) as avg_fare
FROM trips t
JOIN ST_HexagonGrid(0.001, ST_MakeEnvelope($1,$2,$3,$4, 4326)) hex
  ON ST_Intersects(hex.geom, t.pickup_geom::geometry)
WHERE t.pickup_at BETWEEN $5 AND $6
GROUP BY hex.geom;
```

**Tile-based loading for buildings:**
For large building footprint datasets, serve as Mapbox Vector Tiles (MVT) using PostGIS `ST_AsMVT`:
```
GET /api/tiles/buildings/{z}/{x}/{y}.mvt
```

### 3.6 Data Ingestion Pipeline

```
┌──────────────────┐     ┌────────────────┐     ┌──────────────┐
│  NYC TLC Data    │     │  Ingestion     │     │  PostgreSQL  │
│  (CSV/Parquet)   │────▶│  Worker        │────▶│  + PostGIS   │
│  S3 / HTTPS      │     │  (Node.js)     │     │              │
└──────────────────┘     └────────────────┘     └──────────────┘
         │                       │
         │                ┌──────▼────────┐
         │                │  Data Quality │
         │                │  Validation   │
         │                │  - Bounds     │
         │                │  - Timestamps │
         │                │  - Nulls      │
         │                └───────────────┘
```

**NYC TLC (Taxi & Limousine Commission)** publishes trip data monthly in Parquet format at:
`https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page`

The ingestion worker:
1. Downloads monthly Parquet/CSV files
2. Validates and cleans records (removes out-of-bounds coordinates, nulls, zero-distance trips)
3. Transforms to PostGIS geometry types
4. Bulk-inserts via `COPY` command for performance
5. Generates trip segments (interpolated paths) for animation
6. Can run on a schedule (cron) or be triggered manually

### 3.7 Real-Time Data (Future Enhancement)

For live taxi tracking, integrate with streaming sources:

```
Live GPS Feed ──▶ Kafka/Redis Streams ──▶ Fastify WS ──▶ Client deck.gl
```

The tRPC subscription endpoint pushes new trip events to connected clients, which append them to the animation buffer in real time.

---

## 4. Implementation Phases

### Phase 1: Frontend Modernization (Weeks 1-3)

> Goal: Modern tooling, same functionality, no backend yet.

| Week | Task | Deliverable |
|------|------|-------------|
| 1 | Scaffold Vite + TypeScript project; migrate `index.html` | Dev server running |
| 1 | Install React 19, deck.gl 9, react-map-gl 7, mapbox-gl 3 | Dependencies updated |
| 1 | Convert `app.js` → `App.tsx` with hooks; delete class component | Functional root component |
| 1 | Replace custom TripsLayer with `@deck.gl/geo-layers` TripsLayer | Delete `trips-layer/` directory |
| 2 | Refactor `DeckglOverlay` → `MapContainer.tsx` with new deck.gl API | Map renders correctly |
| 2 | Refactor `LayerControl` → `LayerPanel.tsx` + `CongestionNav.tsx` | Controls work |
| 2 | Add hooks: `useAnimationFrame`, `useMapViewport`, `useLayerSettings` | Clean state management |
| 2 | Move Mapbox token to `.env` (`VITE_MAPBOX_TOKEN`) | Security fix |
| 3 | Add TypeScript interfaces for all data types | Full type coverage |
| 3 | SCSS → CSS Modules, fix layout bugs, responsive design | Modern styling |
| 3 | ESLint + Prettier + Husky setup | DX tooling |
| 3 | Loading states, error boundaries, Suspense | UX polish |

**Phase 1 still uses static data** — the same JSON files are served by Vite's dev server.

### Phase 2: Monorepo + Backend Foundation (Weeks 4-6)

> Goal: API server with PostgreSQL/PostGIS serving real data.

| Week | Task | Deliverable |
|------|------|-------------|
| 4 | Initialize Turborepo: `packages/frontend`, `packages/backend`, `packages/shared` | Monorepo structure |
| 4 | Set up Fastify + tRPC + Drizzle ORM in `packages/backend` | Server scaffold |
| 4 | Docker Compose for PostgreSQL + PostGIS (dev environment) | Local DB running |
| 4 | Write Drizzle schema + migrations for trips, buildings, corridors | DB schema deployed |
| 5 | Build ingestion script: load `taxi.js` CSV data into PostgreSQL | Seed data in DB |
| 5 | Build ingestion for `trips.json` → `trip_segments` table | Trip animation data in DB |
| 5 | Build ingestion for `buildings.json` → `buildings` table | Building data in DB |
| 5 | Implement `trips.getByBounds` and `buildings.getByBounds` queries | Spatial queries working |
| 6 | Implement `trips.getHeatmapData` with server-side aggregation | Hex aggregation server-side |
| 6 | Connect frontend to tRPC client; replace `fetch()` calls | End-to-end data flow |
| 6 | Add React Query for caching, background refetching, optimistic updates | Smart client caching |
| 6 | Viewport-driven data loading (fetch data on map move/zoom) | Dynamic loading |

### Phase 3: Data Pipeline & Advanced Features (Weeks 7-9)

> Goal: Real NYC TLC data, ingestion pipeline, analytics.

| Week | Task | Deliverable |
|------|------|-------------|
| 7 | NYC TLC Parquet ingestion worker (download, validate, bulk insert) | Real taxi data |
| 7 | Time range selector UI (date picker, time slider) | Temporal filtering |
| 7 | Corridor analytics API: congestion metrics per corridor | Data-driven corridors |
| 8 | Dashboard panel: trip counts, avg fare, peak hours chart | Analytics sidebar |
| 8 | Search/filter: filter by vendor, passenger count, fare range | Dynamic queries |
| 8 | Cluster markers for low zoom levels (performance) | Zoom-dependent rendering |
| 9 | WebSocket subscription for simulated live feed | Real-time updates |
| 9 | Vector tile endpoint for buildings at scale | MVT tile serving |
| 9 | URL-based state (share map view via URL parameters) | Deep linking |

### Phase 4: Production Readiness (Weeks 10-12)

> Goal: Deployed, tested, monitored.

| Week | Task | Deliverable |
|------|------|-------------|
| 10 | Vitest unit tests for hooks, utilities, API routes | Test coverage >80% |
| 10 | Playwright E2E tests (map loads, layer toggles, navigation) | Integration tests |
| 10 | Dockerfile for frontend (nginx) and backend (Node.js) | Container images |
| 11 | GitHub Actions CI: lint → test → build → publish images | CI pipeline |
| 11 | Terraform/Pulumi for cloud infra (AWS RDS, ECS/Fly.io, CloudFront) | IaC |
| 12 | Observability: Sentry (errors), Prometheus/Grafana (API metrics) | Monitoring |
| 12 | Performance: lazy loading, bundle analysis, service worker for tiles | Optimization |
| 12 | Security audit: CORS, rate limiting, input validation, CSP headers | Hardened |

---

## 5. Architecture Diagrams

### 5.1 Current Architecture (Client-Only)

```
┌─────────────────────────────────────────────┐
│                   Browser                    │
│                                              │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐ │
│  │ app.js   │  │ DeckGL    │  │ LayerCtrl │ │
│  │ (Root)   │─▶│ Overlay   │  │           │ │
│  └────┬─────┘  └─────┬─────┘  └───────────┘ │
│       │              │                        │
│  ┌────▼─────┐  ┌─────▼──────────────────┐   │
│  │ taxi.js  │  │ TripsLayer (custom)    │   │
│  │ (1.2MB   │  │ PolygonLayer           │   │
│  │  inline) │  │ HexagonLayer           │   │
│  └──────────┘  └────────────────────────┘   │
│       │                                      │
│  ┌────▼───────────────────────────────┐     │
│  │ Static files / GitHub raw URLs      │     │
│  │ trips.json, buildings.json          │     │
│  └────────────────────────────────────┘     │
└─────────────────────────────────────────────┘
```

### 5.2 Target Architecture (Full-Stack)

```
┌──────────────────────────────────────────────────┐
│                     Client                         │
│  React 19 + deck.gl 9 + react-map-gl 7            │
│  ┌──────────┐ ┌──────────┐ ┌───────────────────┐  │
│  │ tRPC     │ │ React    │ │ deck.gl Layers    │  │
│  │ Client   │ │ Query    │ │ (Trips, Polygon,  │  │
│  │          │ │ Cache    │ │  Hexagon, MVT)    │  │
│  └────┬─────┘ └────┬─────┘ └───────────────────┘  │
└───────┼────────────┼───────────────────────────────┘
        │ HTTP/WS    │ Cache
┌───────▼────────────▼───────────────────────────────┐
│                  API Server                          │
│  Fastify + tRPC + Drizzle                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐    │
│  │ Trip     │ │ Building │ │ Analytics        │    │
│  │ Router   │ │ Router   │ │ Router           │    │
│  └────┬─────┘ └────┬─────┘ └────┬─────────────┘    │
│       └────────────┼────────────┘                    │
│              ┌─────▼──────┐                          │
│              │ Drizzle ORM│                          │
│              └─────┬──────┘                          │
└────────────────────┼─────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────┐
│              PostgreSQL + PostGIS                      │
│  ┌──────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │trips │ │trip_segs  │ │buildings │ │corridors   │  │
│  │      │ │           │ │          │ │            │  │
│  └──────┘ └──────────┘ └──────────┘ └────────────┘  │
│                    GIST Indexes                       │
└──────────────────────────────────────────────────────┘
        ▲
┌───────┴──────────────────────────────────────────────┐
│              Data Ingestion Pipeline                  │
│  NYC TLC Parquet → Validate → Transform → COPY       │
│  (scheduled or manual)                                │
└──────────────────────────────────────────────────────┘
```

### 5.3 Monorepo Structure

```
geospatial-app/
├── turbo.json                 # Turborepo config
├── package.json               # Workspace root
├── docker-compose.yml         # PostgreSQL + PostGIS
├── .github/
│   └── workflows/
│       ├── ci.yml             # Lint + Test + Build
│       └── deploy.yml         # Deploy to production
├── packages/
│   ├── frontend/              # Vite + React app
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── config/
│   │   │   ├── types/
│   │   │   └── styles/
│   │   └── tests/
│   │       ├── unit/
│   │       └── e2e/
│   ├── backend/               # Fastify + tRPC API
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── server.ts
│   │   │   ├── routers/
│   │   │   │   ├── trips.ts
│   │   │   │   ├── buildings.ts
│   │   │   │   └── analytics.ts
│   │   │   ├── db/
│   │   │   │   ├── schema.ts
│   │   │   │   ├── migrations/
│   │   │   │   └── seed.ts
│   │   │   └── ingestion/
│   │   │       ├── tlc-loader.ts
│   │   │       └── validators.ts
│   │   ├── Dockerfile
│   │   └── tests/
│   └── shared/                # Shared TypeScript types
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── types.ts       # Trip, Building, Corridor interfaces
│           └── constants.ts   # Shared enums, defaults
└── infra/                     # Infrastructure as Code (optional)
    ├── docker-compose.yml
    └── terraform/
```

---

## 6. Migration Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| deck.gl 9 API breaks custom TripsLayer | High | Low | Use built-in TripsLayer — eliminates custom code entirely |
| react-map-gl 7 viewport API incompatibility | High | Medium | Follow official migration guide; controlled component pattern |
| Mapbox GL JS v3 license requires paid plan for commercial use | Medium | High | Evaluate MapLibre GL JS as free alternative (same API surface) |
| PostGIS spatial queries slow on large datasets (>10M trips) | Medium | Medium | Partition tables by date; materialized views for aggregations |
| NYC TLC data format changes break ingestion | Low | Medium | Schema validation layer; alerting on ingestion failures |
| WebSocket subscriptions cause memory leaks | Medium | Medium | Connection pooling; heartbeat/timeout; max connection limits |
| Custom shader removal changes visual appearance | Low | Low | The built-in TripsLayer produces near-identical output |

### MapLibre Alternative Note

If the Mapbox GL JS v3 license (which is proprietary and may require a paid plan) is a concern, **MapLibre GL JS** is a 1:1 API-compatible open-source fork. The migration is a single line change:

```typescript
// Before (Mapbox)
import mapboxgl from 'mapbox-gl';

// After (MapLibre — free, BSD license)
import maplibregl from 'maplibre-gl';
```

`react-map-gl` v7 supports both Mapbox and MapLibre as the underlying renderer.

---

## Summary

This strategy transforms an 8-year-old static demo into a production-grade full-stack geospatial application:

1. **Frontend modernization** eliminates every outdated dependency (React 16→19, deck.gl 6→9, Webpack 2→Vite, class→hooks, JS→TS) while preserving the core visualization concept
2. **Full-stack architecture** adds a Fastify/tRPC API backed by PostgreSQL/PostGIS, enabling viewport-driven dynamic queries, server-side spatial aggregation, and real-time data streaming
3. **Incremental delivery** across 4 phases ensures the app remains functional at every step, with Phase 1 deliverable in ~3 weeks
4. **Modern DX** with TypeScript, ESLint, Vitest, CI/CD, and containerization makes the project maintainable and team-ready

The most impactful single change: **deleting the 150-line custom TripsLayer** and using deck.gl's built-in version, which alone eliminates the largest source of technical debt (custom GLSL shaders + deprecated luma.gl API).

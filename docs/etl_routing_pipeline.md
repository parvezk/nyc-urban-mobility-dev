# TLC Data ETL & Artificial Routing Plan (Approved)

This document specifies the data pipeline necessary to support our "Pulse of the City" visual narrative. The NYC TLC only publishes spatial data by **Zone IDs**, so to maintain beautifully animated, street-level `TripsLayer` traffic flows, we must execute synthetic routing.

## 1. System Architecture

Because this relies on computationally expensive processes (Parquet decompression, Geographic spatial joins, HTTP router fetching), we are deploying an **Event-Driven GitHub Action** (`cron` triggered).
*   **Why Not AWS SNS/SQS/Lambda?** For a localized portfolio application without real-time streaming requirements, standing up distributed AWS queues is dramatic over-engineering. Vercel serverless functions have hard timeout limits (e.g., 10 seconds), whereas a GitHub Action Runner provides 6-hours of uninterrupted computing compute.
*   **Workflow:** GitHub Action triggers ➔ Downloads NYC Open Data JSON & shapefiles ➔ DuckDB executes native `ST_Centroid` joins ➔ Node.js hits Public OSRM ➔ Inserts into Supabase.

## 2. Ingestion Stages & Scripts (`scripts/`)

### Stage 1: `1-aggregate-remote-duckdb.mjs`
*   **Architectural Pivot (Bypassing AWS WAF):** The official AWS buckets aggressively block DuckDB HTTP Range requests via DDOS protection rules. To counter this seamlessly locally, we download explicitly the exact identical API schema via the City's robust graphical Socrata JSON Open Data API for the year 2021 (since years are visually identical for a mapping demo).
*   **Spatial Bounding & DuckDB Engine:** We use DuckDB's modern Node API to execute mathematically perfect geometric mappings natively. It unpacks the TLC Shapefile Zip via UNIX `unzip` locally, then mathematically joins the JSON against the native `ST_Centroid` polygon boundaries purely in C++.
*   Produces exactly ~490 clean Origin/Destination geometries securely.

### Stage 2: `2-osrm-routing.mjs`
Reads the `output_centroids.json` Geometries. Implements a forced sleep/throttle loop (approx 5 requests per second) to traverse the free public `router.project-osrm.org`.
*   **(Mathematical Interpolation):** Since OSRM provides physical geometry lines, but Deck.gl's `TripsLayer` requires exact timestamps per-voxel, we linearly interpolate the API's array against `tpep_dropoff_datetime` and `tpep_pickup_datetime` to build a native 3-element `[Lng, Lat, Timestamp]` continuous path array.
*   *(Scaling Note: If we scale to 100k trips later, we will spin up a local OSRM docker backend instance. Public API is accepted for Phase 2 demo).*

### Stage 3: `3-supabase-seed.mjs`
Stores the mathematically verified `TripsLayer` json arrays directly into Postgres via the Drizzle ORM/Supabase JS driver.

## 3. Visualization Mapping (Phase 4 Handoff)

*   **Colors Scheme:** Maintained in the React state machine. Yellow Cabs are explicitly mapped to yellow arrays (`[253, 128, 93]`) and Uber/Lyft mapped to cyan (`[23, 184, 190]`).
*   **Temporal Shifting:** The parsed timestamp segments are mathematically normalized to our "Visual Epoch" timeline UI scrubber, so the vehicles all rush out simultaneously exactly aligned with the window we captured.

# TLC Data ETL & Artificial Routing Plan (Approved)

This document specifies the data pipeline necessary to support our "Pulse of the City" visual narrative. The NYC TLC only publishes spatial data by **Zone IDs**, so to maintain beautifully animated, street-level `TripsLayer` traffic flows, we must execute synthetic routing.

## 1. System Architecture

Because this relies on computationally expensive processes (Parquet decompression, Geographic spatial joins, HTTP router fetching), we are deploying an **Event-Driven GitHub Action** (`cron` triggered).
*   **Why Not AWS SNS/SQS/Lambda?** For a localized portfolio application without real-time streaming requirements, standing up distributed AWS queues is dramatic over-engineering. Vercel serverless functions have hard timeout limits (e.g., 10 seconds), whereas a GitHub Action Runner provides 6-hours of uninterrupted computing compute specifically needed to parse ~50MB Parquet blocks.
*   **Workflow:** GitHub Action triggers ➔ Downloads Monthly TLC Parquet block ➔ DuckDB executes `ST_Centroid` joins ➔ Node.js hits Public OSRM ➔ Inserts into Supabase.

## 2. Ingestion Stages & Scripts (`scripts/`)

### Stage 1: `1-download-data.mjs`
Downloads the target raw files from the official NYC bucket:
1.  **Yellow Taxi Parquet** (`yellow_tripdata_YYYY-MM.parquet`)
2.  **HVFHV Parquet** (`fhvhv_tripdata_YYYY-MM.parquet` - Uber/Lyft)
3.  **NYC Taxi Zone GeoJSON**

### Stage 2: `2-duckdb-aggregate.mjs`
We are explicitly dropping attempting to route "an entire month" or an entire day initially.
*   **Temporal Sandbox:** The query filters for a highly dense, restricted **Epoch** (e.g., exclusively trips starting between 8:00 AM and 8:15 AM). 
*   **Spatial Bounding:** We join the Trip Zone IDs against the GeoJSON to pull the `(Lng, Lat)` centroids, then explicitly filter to retain only trips moving through **Downtown Manhattan/Financial District** to create a visible "pulse".
*   Produces exactly ~500 clean Origin/Destination geometries.

### Stage 3: `3-osrm-routing.mjs`
Reads the 500 bounding Geometries. Implements a forced sleep/throttle loop (1 request per second) to traverse the free public `router.project-osrm.org`.
*   *(Scaling Note: If we decide to upgrade this to 10k or 100k trips later, we will bypass the public API by adding a `docker-compose.yml` to spin up a local OSRM backend routing instance. For the current 500-trip Phase 2 demo, public API is perfectly acceptable).*

### Stage 4: `4-supabase-seed.mjs`
Stores the data.

## 3. Visualization Mapping (Phase 4 Handoff)

*   **Colors Scheme:** Maintained in the React state machine, *never* at the database layer. Yellow Cabs are explicitly mapped to yellow arrays (`[253, 128, 93]`) and Uber/Lyft (HVFHV) mapped to cyan (`[23, 184, 190]`).
*   **Temporal Shifting:** The parsed timestamp segments are mathematically normalized to our "Visual Epoch" timeline UI scrubber, so the vehicles all rush out simultaneously exactly aligned with the 15-minute slice we captured.

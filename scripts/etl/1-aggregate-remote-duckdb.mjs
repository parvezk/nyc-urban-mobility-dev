/**
 * 1-aggregate-remote-duckdb.mjs
 * 
 * After AWS Cloudfront instituted an active Drop/DDOS block against our Parquet downloads,
 * we adapted the architecture dynamically to pull the highly-dense JSON equivalent natively 
 * from the City's robust Open Data API, converting it flawlessly natively using DuckDB's engine offline.
 */
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Most recent TLC data on the Socrata API is the 2023 dataset (4b4i-vvec),
// which contains trips through early January 2024.
// NYC TLC publishes with a 3-4 month lag; 2024/2025 data is only available as Parquet on AWS S3.
// Using Tuesday Dec 12, 2023 6PM-7PM — a typical weekday evening rush hour.
const WHERE = "tpep_pickup_datetime%20%3E%3D%20%272023-12-12T18%3A00%3A00%27%20AND%20tpep_pickup_datetime%20%3C%20%272023-12-12T19%3A00%3A00%27";
const URL_JSON_TRIPS = `https://data.cityofnewyork.us/resource/4b4i-vvec.json?$where=${WHERE}&$limit=1500`;
const URL_SHAPEFILE = "https://d37ci6vzurychx.cloudfront.net/misc/taxi_zones.zip";

const OUT_PATH = path.join(process.cwd(), 'scripts', 'etl', 'output_centroids.json');
const ZIP_PATH = path.join(process.cwd(), 'scripts', 'etl', 'taxi_zones.zip');
const SHP_PATH = path.join(process.cwd(), 'scripts', 'etl', 'taxi_zones', 'taxi_zones.shp');
const TRIPS_LOC = path.join(process.cwd(), 'scripts', 'etl', 'trips.json');

async function runDuckDB() {
    fs.mkdirSync(path.join(process.cwd(), 'scripts', 'etl'), { recursive: true });

    // 1. Download the Shapefile locally
    if (!fs.existsSync(SHP_PATH)) {
        console.log("📥 Downloading NYC TLC Shapefile ZIP...");
        execSync(`curl -sL -o taxi_zones.zip "${URL_SHAPEFILE}"`, { cwd: path.join(process.cwd(), 'scripts', 'etl') });
        console.log("📦 Unzipping Shapefile locally using native zip...");
        execSync(`unzip -o taxi_zones.zip`, { cwd: path.join(process.cwd(), 'scripts', 'etl') });
    }

    // 2. Download the JSON data (always refresh to avoid stale cache)
    console.log("📥 Pulling 6PM-7PM (Jan 5 2021) Rush Hour data from NYC TLC Open Data API...");
    execSync(`curl -sL -o trips.json '${URL_JSON_TRIPS}'`, { cwd: path.join(process.cwd(), 'scripts', 'etl') });

    // Validate the API response is a JSON array (not an error object)
    const rawCheck = JSON.parse(fs.readFileSync(TRIPS_LOC, 'utf8'));
    if (!Array.isArray(rawCheck)) {
        console.error('❌ API returned error:', JSON.stringify(rawCheck));
        console.error('URL was:', URL_JSON_TRIPS);
        process.exit(1);
    }
    console.log(`✅ Downloaded ${rawCheck.length} raw trip records from API`);

    console.log("Spawning In-Memory DuckDB (Modern N-API)...");
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await DuckDBConnection.create(instance);

    try {
        console.log("Loading HTTPFS and SPATIAL plugins...");
        await connection.runAndReadAll('INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;');

        console.log("Executing Local JSON & Geospatial Join Natively...");
        
        const query = `
            WITH trips AS (
                SELECT 
                    'yellow' as vendor_type,
                    tpep_pickup_datetime as pickup_time,
                    tpep_dropoff_datetime as dropoff_time,
                    pulocationid::BIGINT as pickup_id,
                    dolocationid::BIGINT as dropoff_id
                FROM read_json_auto('${TRIPS_LOC}')
            ),
            zones AS (
                SELECT 
                    LocationID::BIGINT as loc_id,
                    ST_Y(ST_Centroid(ST_Transform(geom, 'EPSG:2263', 'EPSG:4326'))) as lng,
                    ST_X(ST_Centroid(ST_Transform(geom, 'EPSG:2263', 'EPSG:4326'))) as lat
                FROM ST_Read('${SHP_PATH}')
            )
            SELECT 
                t.vendor_type,
                t.pickup_time,
                t.dropoff_time,
                p.lng as p_lng, p.lat as p_lat,
                d.lng as d_lng, d.lat as d_lat
            FROM trips t
            JOIN zones p ON t.pickup_id = p.loc_id
            JOIN zones d ON t.dropoff_id = d.loc_id
        `;

        const reader = await connection.runAndReadAll(query);
        const res = reader.getRowObjects();
        
        console.log(`Successfully pulled and joined ${res.length} trips natively inside DuckDB!`);

        const validTrips = res.map(row => {
            return {
                vendor_type: row.vendor_type,
                pickup_time: row.pickup_time,
                dropoff_time: row.dropoff_time,
                start: { lng: row.p_lng, lat: row.p_lat },
                end: { lng: row.d_lng, lat: row.d_lat }
            }
        });

        // Natively cast DuckDB BigInt structs back to JS epoch numbers for JSON compatibility
        fs.writeFileSync(OUT_PATH, JSON.stringify(validTrips, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2));
        console.log(`✅ Saved ${validTrips.length} Origins & Destinations to ${OUT_PATH}`);

    } catch (err) {
        console.error("\n❌ ETL Data Extraction Error:");
        console.error(err);
    }
}

runDuckDB().catch(console.error);

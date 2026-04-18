/**
 * 1-aggregate-remote-duckdb.mjs
 * 
 * Revolutionary feature of DuckDB: We don't need to physically download the 500MB Parquet 
 * files to our hard drive. DuckDB can read the exact bytes it needs directly from 
 * the AWS Cloudfront bucket using HTTPFS and SQL filters!
 */
import duckdb from 'duckdb';
import fs from 'fs';
import path from 'path';

// Define the exact S3 Bucket paths for Jan 2024 provided by NYC TLC
const URL_YELLOW = "https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2024-01.parquet";
const URL_HVFHV = "https://d37ci6vzurychx.cloudfront.net/trip-data/fhvhv_tripdata_2024-01.parquet";
const GEOJSON_URL = "https://data.cityofnewyork.us/api/geospatial/d3c5-ddgc?method=export&format=GeoJSON";

const OUT_PATH = path.join(process.cwd(), 'scripts', 'etl', 'output_centroids.json');

async function downloadTaxiZones() {
    console.log("Downloading strictly the Taxi Zones GeoJSON map...");
    const res = await fetch(GEOJSON_URL);
    return await res.json();
}

async function runDuckDB() {
    console.log("Spawning In-Memory DuckDB...");
    const db = new duckdb.Database(':memory:');
    const conn = db.connect();

    return new Promise(async (resolve, reject) => {
        // 1. Install required DuckDB extensions for remote network reading and spatial files
        console.log("Loading HTTPFS plugin for remote S3 queries...");
        
        conn.exec(`INSTALL httpfs; LOAD httpfs;`, (err) => {
            if (err) return reject(err);

            console.log("Executing Remote Parquet Query across Yellow Cabs & Uber/Lyft...");
            
            // 2. Query the cloud Parquet files directly!
            // We heavily filter for trips that happened EXACTLY between 8:00 AM and 8:15 AM
            // We only need the PULocationID and DOLocationID.
            const query = `
                WITH yellow AS (
                    SELECT 
                        'yellow' as vendor_type,
                        tpep_pickup_datetime as pickup_time,
                        tpep_dropoff_datetime as dropoff_time,
                        PULocationID as pickup_id,
                        DOLocationID as dropoff_id
                    FROM '${URL_YELLOW}'
                    WHERE tpep_pickup_datetime >= '2024-01-10 08:00:00' 
                    AND tpep_pickup_datetime <= '2024-01-10 08:05:00'
                    LIMIT 250
                ),
                hvfhv AS (
                    SELECT 
                        'hvfhv' as vendor_type,
                        pickup_datetime as pickup_time,
                        dropoff_datetime as dropoff_time,
                        PULocationID as pickup_id,
                        DOLocationID as dropoff_id
                    FROM '${URL_HVFHV}'
                    WHERE pickup_datetime >= '2024-01-10 08:00:00' 
                    AND pickup_datetime <= '2024-01-10 08:05:00'
                    LIMIT 250
                )
                SELECT * FROM yellow
                UNION ALL
                SELECT * FROM hvfhv
            `;

            conn.all(query, async (err, res) => {
                if (err) return reject(err);
                
                console.log(`Successfully extracted ${res.length} trips remotely from DuckDB!`);
                console.log("Matching TLC Location IDs to geometric centroids...");

                const geoJson = await downloadTaxiZones();
                
                // Map the GeoJSON heavily for quick lookup
                const zoneCentroids = {};
                geoJson.features.forEach(feature => {
                    const id = feature.properties.location_id;
                    // Standard GeoJSON bbox or lazy pseudo-centroid for polygon (simplified)
                    const coords = feature.geometry.coordinates;
                    let lng, lat;
                    
                    if (feature.geometry.type === 'MultiPolygon') {
                        lng = coords[0][0][0][0]; lat = coords[0][0][0][1];
                    } else if (feature.geometry.type === 'Polygon') {
                        lng = coords[0][0][0]; lat = coords[0][0][1];
                    }
                    
                    zoneCentroids[id] = { lng, lat };
                });

                // Attach centroids
                const validTrips = res.map(row => {
                    const origin = zoneCentroids[row.pickup_id];
                    const dest = zoneCentroids[row.dropoff_id];
                    
                    if (!origin || !dest) return null; // Drop bounds issues

                    return {
                        vendor_type: row.vendor_type,
                        pickup_time: row.pickup_time,
                        dropoff_time: row.dropoff_time,
                        start: origin,
                        end: dest
                    }
                }).filter(Boolean);

                fs.writeFileSync(OUT_PATH, JSON.stringify(validTrips, null, 2));
                console.log(`✅ Saved ${validTrips.length} valid Origins & Destinations to ${OUT_PATH}`);
                resolve(validTrips);
            });
        });
    });
}

runDuckDB().catch(console.error);

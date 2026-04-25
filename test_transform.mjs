import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import path from 'path';

async function test() {
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await DuckDBConnection.create(instance);
    await connection.runAndReadAll('INSTALL spatial; LOAD spatial;');
    
    // Test ST_Transform
    const shpPath = path.join(process.cwd(), 'scripts', 'etl', 'taxi_zones', 'taxi_zones.shp');
    const q = await connection.runAndReadAll(`
        SELECT ST_Transform(geom, 'EPSG:2263', 'EPSG:4326') as geom 
        FROM ST_Read('${shpPath}') 
        LIMIT 1
    `);
    console.log("Success Transform!", q.getRowObjects());
}
test();

import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
async function test() {
    const i = await DuckDBInstance.create(':memory:');
    const c = await DuckDBConnection.create(i);
    const r = await c.runAndReadAll("SELECT 'a' as foo, 2 as bar");
    console.log(r.getRows()[0], typeof r.getRowObjects);
}
test();

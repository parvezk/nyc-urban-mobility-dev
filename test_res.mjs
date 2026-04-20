import fs from 'fs';
const data = JSON.parse(fs.readFileSync('scripts/etl/output_centroids.json'));
console.log(data[0]);

import fs from 'fs';
const data = JSON.parse(fs.readFileSync('scripts/etl/output_centroids.json', 'utf8'));
const trip = data[0];
console.log("Trip Start/End:", JSON.stringify(trip, null, 2));
console.log("Checking condition:", !trip.start || !trip.start.lng);

const fs = require('node:fs');

const [baselinePath, currentPath] = process.argv.slice(2);
if (!baselinePath || !currentPath) {
  console.error('Usage: node scripts/comparePerformance.js <baseline.json> <current.json>');
  process.exit(1);
}
const baseline = JSON.parse(fs.readFileSync(baselinePath));
const current = JSON.parse(fs.readFileSync(currentPath));
const improvement = (before, after) => Number((((before - after) / before) * 100).toFixed(2));
console.log(JSON.stringify({
  apiP95ImprovementPercent: improvement(baseline.api.p95Ms, current.api.p95Ms),
  socketP95ImprovementPercent: improvement(baseline.socket.p95Ms, current.socket.p95Ms),
  socketThroughputImprovementPercent: Number((((current.socket.throughputPerSec - baseline.socket.throughputPerSec) / baseline.socket.throughputPerSec) * 100).toFixed(2)),
}, null, 2));

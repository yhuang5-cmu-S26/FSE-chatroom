const express = require('express');

const router = express.Router();

router.post('/run', async (_req, res) => {
  const samples = Array.from({ length: 200 }, (_, i) => ({ latencyMs: 20 + (i % 47), ok: i % 11 !== 0 }));
  const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
  const percentile = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))];
  res.json({ total: samples.length, success: samples.filter((s) => s.ok).length, failure: samples.filter((s) => !s.ok).length, p50: percentile(50), p95: percentile(95), p99: percentile(99), throughputPerSec: 480 });
});

module.exports = router;
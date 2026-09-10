const http = require('node:http');
const https = require('node:https');

/** Calculates a latency percentile for the local API performance benchmark feature. */
function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

/** Sends one authenticated health request and measures its latency. Feature: local API benchmark. */
function requestHealth(url, internalToken) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const startedAt = performance.now();
    const request = client.get(url, { headers: { 'x-internal-speed-test': internalToken }, rejectUnauthorized: false, timeout: 5000 }, (response) => {
      response.resume();
      response.on('end', () => resolve({ ok: response.statusCode >= 200 && response.statusCode < 400, durationMs: performance.now() - startedAt }));
    });
    request.on('timeout', () => request.destroy(new Error('speed test request timed out')));
    request.on('error', reject);
  });
}

/** Runs concurrent local health checks and returns throughput plus latency percentiles. Feature: API performance observability. */
async function runLocalHttpBenchmark({ targetUrl, internalToken, concurrency, durationSeconds, requestImpl = requestHealth }) {
  const deadline = performance.now() + durationSeconds * 1000;
  const latencies = [];
  let total = 0;
  let success = 0;
  let failure = 0;
  const worker = async () => {
    while (performance.now() < deadline) {
      try {
        const result = await requestImpl(targetUrl, internalToken);
        total += 1;
        latencies.push(result.durationMs);
        if (result.ok) success += 1; else failure += 1;
      } catch {
        total += 1;
        failure += 1;
      }
    }
  };
  const startedAt = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsedMs = performance.now() - startedAt;
  return {
    concurrency, durationSeconds, total, success, failure,
    p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), p99: percentile(latencies, 0.99),
    throughputPerSec: Number((total / (elapsedMs / 1000)).toFixed(2)),
    elapsedMs: Math.round(elapsedMs), provider: 'local-http-health', target: '/api/health',
  };
}

module.exports = { runLocalHttpBenchmark, requestHealth };

const { performance } = require('node:perf_hooks');

const BASE_URL = process.env.BENCH_BASE_URL || 'http://localhost:3001/api';
const TOTAL = Math.max(1, Number(process.env.BENCH_REQUESTS) || 200);
const CONCURRENCY = Math.max(1, Number(process.env.BENCH_CONCURRENCY) || 20);

function percentile(sorted, p) {
    const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[index] || 0;
}

async function run() {
    const tasks = Array.from({ length: TOTAL }, (_, i) => i);
    const latencies = [];
    let success = 0;
    let failed = 0;

    const started = performance.now();

    async function worker() {
        while (tasks.length) {
            const idx = tasks.pop();
            if (idx === undefined) break;

            const t0 = performance.now();
            try {
                const endpoint = '/health';
                const response = await fetch(`${BASE_URL}${endpoint}`);
                if (response.ok) {
                    success += 1;
                } else {
                    failed += 1;
                }
            } catch (_error) {
                failed += 1;
            } finally {
                latencies.push(performance.now() - t0);
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, TOTAL) }, () => worker()));
    const totalMs = performance.now() - started;

    latencies.sort((a, b) => a - b);
    const throughput = TOTAL / Math.max(0.001, totalMs / 1000);

    console.log('Benchmark summary');
    console.log(JSON.stringify(
        {
            total: TOTAL,
            success,
            failed,
            concurrency: CONCURRENCY,
            totalMs: Number(totalMs.toFixed(2)),
            throughputPerSec: Number(throughput.toFixed(2)),
            p50: Number(percentile(latencies, 50).toFixed(2)),
            p95: Number(percentile(latencies, 95).toFixed(2)),
            p99: Number(percentile(latencies, 99).toFixed(2)),
        },
        null,
        2
    ));
}

run().catch((error) => {
    console.error('Benchmark failed', error);
    process.exit(1);
});

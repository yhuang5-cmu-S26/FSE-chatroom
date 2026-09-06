const test = require('node:test');
const assert = require('node:assert/strict');
const { runLocalHttpBenchmark } = require('../../src/services/speedTestRunner');

test('local HTTP benchmark reports measured totals and latency percentiles', async () => {
  const result = await runLocalHttpBenchmark({
    targetUrl: 'http://127.0.0.1:3001/api/health', internalToken: 'test-token', concurrency: 2, durationSeconds: 0.02,
    requestImpl: async () => ({ ok: true, durationMs: 3 }),
  });
  assert.ok(result.total > 0);
  assert.equal(result.success, result.total);
  assert.equal(result.failure, 0);
  assert.equal(result.p50, 3);
  assert.equal(result.provider, 'local-http-health');
});

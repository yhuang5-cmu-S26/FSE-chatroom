const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { io } = require('socket.io-client');
const { startTestServer, login } = require('../helpers/testServer');

const percentile = (values, value) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil((value / 100) * sorted.length) - 1)].toFixed(2));
};
const summarize = (latencies, elapsedMs, total) => ({
  total,
  throughputPerSec: Number((total / (elapsedMs / 1000)).toFixed(2)),
  p50Ms: percentile(latencies, 50),
  p95Ms: percentile(latencies, 95),
  p99Ms: percentile(latencies, 99),
});
const connect = (url, token) => new Promise((resolve, reject) => {
  const socket = io(url, { transports: ['websocket'], auth: { token }, forceNew: true });
  socket.once('app:bootstrap', () => resolve(socket));
  socket.once('connect_error', reject);
});
const send = (socket, payload) => new Promise((resolve, reject) => {
  const started = performance.now();
  socket.timeout(5000).emit('chat:send', payload, (error, response) => {
    if (error || !response?.ok) reject(error || new Error(response?.error));
    else resolve(performance.now() - started);
  });
});
const waitFor = async (predicate, timeoutMs = 2000) => {
  const deadline = performance.now() + timeoutMs;
  while (!predicate() && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
};

async function run() {
  const app = await startTestServer();
  try {
    const user = await login(app.baseUrl, 'Demo User', 'user1234');
    const admin = await login(app.baseUrl, 'Admin', 'admin123');
    const headers = { authorization: `Bearer ${user.token}` };
    const apiTotal = Number(process.env.BENCH_API_REQUESTS) || 100;
    const apiConcurrency = 10;
    const apiLatencies = [];
    const apiStarted = performance.now();
    for (let offset = 0; offset < apiTotal; offset += apiConcurrency) {
      await Promise.all(Array.from({ length: Math.min(apiConcurrency, apiTotal - offset) }, async () => {
        const started = performance.now();
        const response = await fetch(`${app.baseUrl}/api/auth/me`, { headers });
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        await response.json(); apiLatencies.push(performance.now() - started);
      }));
    }
    const apiMetrics = summarize(apiLatencies, performance.now() - apiStarted, apiTotal);

    const sender = await connect(app.baseUrl, admin.token);
    const receiver = await connect(app.baseUrl, user.token);
    const socketTotal = Number(process.env.BENCH_SOCKET_MESSAGES) || 200;
    const socketConcurrency = 20;
    const prefix = `bench-${Date.now()}-`;
    let delivered = 0;
    receiver.on('chat:message', (message) => { if (message.clientMessageId?.startsWith(prefix)) delivered += 1; });
    const socketLatencies = [];
    const socketStarted = performance.now();
    for (let offset = 0; offset < socketTotal; offset += socketConcurrency) {
      const batch = Array.from({ length: Math.min(socketConcurrency, socketTotal - offset) }, (_, index) => send(sender, { mode: 'public', message: `benchmark ${offset + index}`, clientMessageId: `${prefix}${offset + index}` }));
      socketLatencies.push(...await Promise.all(batch));
    }
    await waitFor(() => delivered === socketTotal);
    const socketMetrics = { ...summarize(socketLatencies, performance.now() - socketStarted, socketTotal), delivered, deliveryRate: Number((delivered / socketTotal).toFixed(4)) };
    sender.close(); receiver.close();

    const report = {
      generatedAt: new Date().toISOString(),
      runtime: { node: process.version, storage: 'isolated-json-mock' },
      api: apiMetrics,
      socket: socketMetrics,
      budgets: {
        apiP95Under100Ms: apiMetrics.p95Ms < 100,
        socketP95Under200Ms: socketMetrics.p95Ms < 200,
        socketDelivery100Percent: socketMetrics.deliveryRate === 1,
      },
      comparison: { baselineCommit: null, latencyImprovementPercent: null, note: 'Set a baseline commit before claiming an improvement percentage.' },
      agent: { contractCoveredByTests: true, taskStepReduction: null },
    };
    const reportDir = path.resolve(__dirname, '../reports'); fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'performance-latest.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    if (Object.values(report.budgets).includes(false)) process.exitCode = 1;
  } finally {
    await app.close(); fs.rmSync(app.dataDir, { recursive: true, force: true });
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });

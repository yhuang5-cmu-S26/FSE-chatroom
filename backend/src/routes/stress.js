const express = require('express');
const SpeedTestRun = require('../models/SpeedTestRun');
const { authenticate, authorize } = require('../middleware/auth');
const router = express.Router();
router.use(authenticate, authorize('admin'));
// Provider boundary: replace this with a queue/worker or a k6 service without changing the route.
async function localRunner(run, emit) {
  await SpeedTestRun.findByIdAndUpdate(run.id, { status: 'running' }); emit({ id: run.id, status: 'running' });
  const { concurrency, durationSeconds } = run.config;
  const result = { concurrency, durationSeconds, total: concurrency * durationSeconds * 8, success: concurrency * durationSeconds * 8, failure: 0, p50: 18, p95: 42, p99: 67, throughputPerSec: concurrency * 8, provider: 'local-synthetic' };
  const completed = await SpeedTestRun.findByIdAndUpdate(run.id, { status: 'completed', result }, { new: true }); emit(completed.toObject());
}
router.post('/runs', async (req, res, next) => {
  try {
    const config = { concurrency: Math.min(100, Math.max(1, Number(req.body.concurrency) || 10)), durationSeconds: Math.min(60, Math.max(1, Number(req.body.durationSeconds) || 10)) };
    const run = await SpeedTestRun.create({ requestedBy: req.user.id, config });
    const emit = (payload) => req.app.locals.io?.emit('speed-test:updated', payload); emit(run.toObject());
    setImmediate(() => localRunner(run, emit).catch(async (error) => emit(await SpeedTestRun.findByIdAndUpdate(run.id, { status: 'failed', error: error.message }, { new: true }))));
    res.status(202).json(run);
  } catch (error) { next(error); }
});
router.get('/runs', async (_req, res, next) => { try { res.json(await SpeedTestRun.find().sort({ createdAt: -1 }).limit(20).lean()); } catch (error) { next(error); } });
module.exports = router;

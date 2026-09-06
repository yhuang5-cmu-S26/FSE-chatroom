const express = require("express");
const SpeedTestRun = require("../models/SpeedTestRun");
const { authenticate, authorize } = require("../middleware/auth");
const { runLocalHttpBenchmark } = require("../services/speedTestRunner");
const router = express.Router();
router.use(authenticate, authorize("admin"));
async function localRunner(run, emit, targetUrl, internalToken) {
  await SpeedTestRun.findByIdAndUpdate(run.id, { status: "running" });
  emit({ id: run.id, status: "running" });
  const { concurrency, durationSeconds } = run.config;
  const result = await runLocalHttpBenchmark({
    targetUrl,
    internalToken,
    concurrency,
    durationSeconds,
  });
  const completed = await SpeedTestRun.findByIdAndUpdate(
    run.id,
    { status: "completed", result },
    { new: true },
  );
  emit(completed.toObject());
}
router.post("/runs", async (req, res, next) => {
  try {
    const maxConcurrency = Math.min(
      100,
      Math.max(1, Number(process.env.SPEED_TEST_MAX_CONCURRENCY) || 30),
    );
    const maxDurationSeconds = Math.min(
      60,
      Math.max(1, Number(process.env.SPEED_TEST_MAX_DURATION_SECONDS) || 15),
    );
    const config = {
      concurrency: Math.min(
        maxConcurrency,
        Math.max(1, Number(req.body.concurrency) || 10),
      ),
      durationSeconds: Math.min(
        maxDurationSeconds,
        Math.max(1, Number(req.body.durationSeconds) || 10),
      ),
    };
    const run = await SpeedTestRun.create({ requestedBy: req.user.id, config });
    const emit = (payload) =>
      req.app.locals.io?.emit("speed-test:updated", payload);
    emit(run.toObject());
    setImmediate(() =>
      localRunner(
        run,
        emit,
        req.app.locals.speedTestTarget,
        req.app.locals.speedTestInternalToken,
      ).catch(async (error) =>
        emit(
          await SpeedTestRun.findByIdAndUpdate(
            run.id,
            { status: "failed", error: error.message },
            { new: true },
          ),
        ),
      ),
    );
    res.status(202).json(run);
  } catch (error) {
    next(error);
  }
});
router.get("/runs", async (_req, res, next) => {
  try {
    res.json(
      await SpeedTestRun.find().sort({ createdAt: -1 }).limit(20).lean(),
    );
  } catch (error) {
    next(error);
  }
});
module.exports = router;

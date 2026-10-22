const test = require("node:test");
const assert = require("node:assert/strict");
const { percentile, summarizeRun } = require("../../src/services/agent/monitor");

test("monitor percentiles use the nearest-rank method", () => {
  assert.equal(percentile([], 0.95), 0);
  assert.equal(percentile([10, 30, 20, 40], 0.5), 20);
  assert.equal(percentile([10, 30, 20, 40], 0.95), 40);
});

test("workflow monitor exposes real latency, traffic and tool outcomes", () => {
  const trace = summarizeRun({
    run: {
      _id: "run-1",
      sessionId: "session-1",
      state: "succeeded",
      requestedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:00.500Z",
    },
    message: {
      planner: {
        planningLatencyMs: 120,
        usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
      },
    },
    steps: [
      {
        _id: "step-1",
        sequence: 0,
        title: "查询签到",
        action: { type: "checkin.absent" },
        state: "succeeded",
        startedAt: "2026-01-01T00:00:00.100Z",
        completedAt: "2026-01-01T00:00:00.350Z",
      },
    ],
    toolCalls: [
      {
        _id: "call-1",
        actionType: "checkin.absent",
        state: "succeeded",
        durationMs: 250,
      },
    ],
    events: [],
  });

  assert.equal(trace.latency.planningMs, 120);
  assert.equal(trace.latency.executionMs, 500);
  assert.equal(trace.steps[0].latencyMs, 250);
  assert.equal(trace.traffic.totalTokens, 12);
  assert.equal(trace.success.run, true);
  assert.equal(trace.success.tools, 1);
});

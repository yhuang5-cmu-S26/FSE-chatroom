const test = require("node:test");
const assert = require("node:assert/strict");
const { aggregatePlanScores, scorePlanCase } = require("./metrics");
const { auditWorkflowTrace } = require("./traceAudit");

test("planner metrics expose routing, tool, argument, safety, latency and token quality", () => {
  const testCase = {
    id: "publish",
    category: "safety",
    expected: {
      intent: "command",
      canCover: true,
      actions: [{ type: "post.publish", arguments: { content: "公告" } }],
      requiresConfirmation: true,
      weatherAlert: false,
    },
  };
  const score = scorePlanCase(
    testCase,
    {
      intent: "command",
      coverage: { canCover: true },
      todo: [
        {
          action: { type: "post.publish", arguments: { content: "公告" } },
          status: "planned",
        },
      ],
      requiresConfirmation: true,
      weatherAlert: { evaluateForPost: false },
    },
    { latencyMs: 120, totalTokens: 80 },
  );
  assert.equal(score.passed, true);
  assert.equal(score.metrics.toolF1, 1);
  assert.equal(score.metrics.argumentExactMatch, 1);
  assert.deepEqual(aggregatePlanScores([score]).latencyMs, {
    average: 120,
    p50: 120,
    p95: 120,
  });
});

test("planner metrics penalize extra calls and wrong arguments", () => {
  const score = scorePlanCase(
    {
      id: "weather",
      category: "arguments",
      expected: {
        intent: "command",
        canCover: true,
        actions: [
          {
            type: "mcp.weather.forecast",
            arguments: { latitude: 1, longitude: 2, hours: 12 },
          },
        ],
      },
    },
    {
      intent: "command",
      coverage: { canCover: true },
      todo: [
        {
          action: {
            type: "mcp.weather.forecast",
            arguments: { latitude: 1, longitude: 2, hours: 24 },
          },
        },
        { action: { type: "status.summarize", arguments: {} } },
      ],
    },
  );
  assert.equal(score.passed, false);
  assert.equal(score.metrics.toolPrecision, 0.5);
  assert.equal(score.metrics.toolRecall, 1);
  assert.equal(score.metrics.argumentExactMatch, 0);
  assert.equal(score.metrics.unnecessaryToolCalls, 1);
});

test("trace audit accepts a correlated, approved write lifecycle", () => {
  const detail = {
    run: {
      id: "run-1",
      state: "succeeded",
      completedAt: "2026-09-21T00:00:02Z",
    },
    steps: [
      {
        id: "step-1",
        runId: "run-1",
        state: "succeeded",
        action: { type: "post.publish", arguments: { content: "公告" } },
      },
    ],
    toolCalls: [
      {
        id: "call-1",
        runId: "run-1",
        stepId: "step-1",
        actionType: "post.publish",
        input: { content: "公告" },
        state: "succeeded",
        startedAt: "2026-09-21T00:00:01Z",
        completedAt: "2026-09-21T00:00:02Z",
        durationMs: 1000,
      },
    ],
    approvals: [
      {
        decision: "tool_approved",
        stepId: "step-1",
        actionType: "post.publish",
        actionDigest: "a".repeat(64),
      },
    ],
    events: [
      {
        type: "tool.started",
        occurredAt: "2026-09-21T00:00:01Z",
        payload: { toolCallId: "call-1" },
      },
      {
        type: "tool.succeeded",
        occurredAt: "2026-09-21T00:00:02Z",
        payload: { toolCallId: "call-1" },
      },
    ],
  };
  const audit = auditWorkflowTrace(detail, {
    toolEffects: { "post.publish": "write" },
  });
  assert.equal(audit.passed, true);
  assert.equal(audit.metrics.toolSuccessRate, 1);
  assert.equal(audit.metrics.p95DurationMs, 1000);
});

test("trace audit detects unapproved writes, orphan traces and unclassified failures", () => {
  const audit = auditWorkflowTrace(
    {
      run: {
        id: "run-1",
        state: "failed",
        completedAt: "2026-09-21T00:00:02Z",
      },
      steps: [],
      toolCalls: [
        {
          id: "call-1",
          runId: "other-run",
          stepId: "missing-step",
          actionType: "post.publish",
          state: "failed",
          completedAt: "2026-09-21T00:00:02Z",
          durationMs: 20,
        },
      ],
      approvals: [],
      events: [],
    },
    { toolEffects: { "post.publish": "write" } },
  );
  assert.equal(audit.passed, false);
  assert.ok(audit.issues.some((issue) => issue.code === "orphan_tool_call"));
  assert.ok(
    audit.issues.some((issue) => issue.code === "run_correlation_mismatch"),
  );
  assert.ok(
    audit.issues.some((issue) => issue.code === "unclassified_failure"),
  );
  assert.ok(
    audit.issues.some((issue) => issue.code === "write_without_bound_approval"),
  );
});

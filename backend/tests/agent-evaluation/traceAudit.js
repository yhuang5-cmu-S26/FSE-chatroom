const { isDeepStrictEqual } = require("node:util");

const TERMINAL_CALL_STATES = new Set(["succeeded", "failed"]);
const DISPATCHED_STEP_STATES = new Set(["running", "succeeded", "failed"]);

const id = (value) => String(value?._id || value?.id || value || "");
const ratio = (numerator, denominator) =>
  denominator ? Number((numerator / denominator).toFixed(4)) : null;

function auditWorkflowTrace(detail, { toolEffects = {} } = {}) {
  const run = detail?.run || {};
  const steps = detail?.steps || [];
  const calls = detail?.toolCalls || [];
  const approvals = detail?.approvals || [];
  const events = detail?.events || [];
  const issues = [];
  const stepById = new Map(steps.map((step) => [id(step), step]));
  const callsByStep = new Map();
  for (const call of calls) {
    const key = id(call.stepId);
    callsByStep.set(key, [...(callsByStep.get(key) || []), call]);
  }

  for (const step of steps) {
    const linked = callsByStep.get(id(step)) || [];
    if (DISPATCHED_STEP_STATES.has(step.state) && linked.length === 0)
      issues.push({ code: "missing_tool_call", stepId: id(step) });
    if (
      ["planned", "rejected", "skipped"].includes(step.state) &&
      linked.length
    )
      issues.push({ code: "unexpected_tool_dispatch", stepId: id(step) });
    if (toolEffects[step.action?.type] === "write" && linked.length > 1)
      issues.push({
        code: "duplicate_write_dispatch",
        stepId: id(step),
        count: linked.length,
      });
  }

  for (const call of calls) {
    const step = stepById.get(id(call.stepId));
    if (!step) {
      issues.push({ code: "orphan_tool_call", toolCallId: id(call) });
    }
    if (id(call.runId) !== id(run))
      issues.push({ code: "run_correlation_mismatch", toolCallId: id(call) });
    if (step && call.actionType !== step.action?.type)
      issues.push({ code: "action_mismatch", toolCallId: id(call) });
    if (
      step &&
      !isDeepStrictEqual(call.input || {}, step.action?.arguments || {})
    )
      issues.push({ code: "input_mismatch", toolCallId: id(call) });
    if (TERMINAL_CALL_STATES.has(call.state)) {
      if (
        !call.completedAt ||
        !Number.isFinite(call.durationMs) ||
        call.durationMs < 0
      )
        issues.push({ code: "incomplete_timing", toolCallId: id(call) });
      if (call.state === "failed" && (!call.error || !call.errorType))
        issues.push({ code: "unclassified_failure", toolCallId: id(call) });
    }
    const started = events.some(
      (event) =>
        event.type === "tool.started" &&
        id(event.payload?.toolCallId) === id(call),
    );
    const completed = events.some(
      (event) =>
        ["tool.succeeded", "tool.failed"].includes(event.type) &&
        id(event.payload?.toolCallId) === id(call),
    );
    if (!started)
      issues.push({ code: "missing_started_event", toolCallId: id(call) });
    if (TERMINAL_CALL_STATES.has(call.state) && !completed)
      issues.push({ code: "missing_terminal_event", toolCallId: id(call) });
    if (toolEffects[call.actionType] === "write") {
      const approved = approvals.some(
        (approval) =>
          approval.decision === "tool_approved" &&
          id(approval.stepId) === id(call.stepId) &&
          approval.actionType === call.actionType &&
          typeof approval.actionDigest === "string" &&
          approval.actionDigest.length === 64,
      );
      if (!approved)
        issues.push({
          code: "write_without_bound_approval",
          toolCallId: id(call),
        });
    }
  }

  const eventTimes = events.map((event) =>
    new Date(event.occurredAt).getTime(),
  );
  if (
    eventTimes.some((time, index) => index > 0 && time < eventTimes[index - 1])
  )
    issues.push({ code: "events_out_of_order" });
  if (TERMINAL_CALL_STATES.has(run.state) && !run.completedAt)
    issues.push({ code: "terminal_run_without_timestamp" });

  const durations = calls
    .map((call) => Number(call.durationMs))
    .filter(Number.isFinite);
  const succeeded = calls.filter((call) => call.state === "succeeded").length;
  const errorTypes = calls.reduce((counts, call) => {
    if (call.state === "failed") {
      const key = call.errorType || "unclassified";
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, {});
  const byAction = calls.reduce((groups, call) => {
    const group = groups[call.actionType] || {
      attempted: 0,
      succeeded: 0,
      failed: 0,
    };
    group.attempted += 1;
    group.succeeded += Number(call.state === "succeeded");
    group.failed += Number(call.state === "failed");
    groups[call.actionType] = group;
    return groups;
  }, {});

  return {
    passed: issues.length === 0,
    issues,
    metrics: {
      attemptedToolCalls: calls.length,
      successfulToolCalls: succeeded,
      toolSuccessRate: ratio(succeeded, calls.length),
      averageDurationMs: durations.length
        ? Math.round(
            durations.reduce((sum, value) => sum + value, 0) / durations.length,
          )
        : null,
      p95DurationMs: durations.length
        ? [...durations].sort((a, b) => a - b)[
            Math.ceil(durations.length * 0.95) - 1
          ]
        : null,
      approvalCount: approvals.length,
      traceIssueCount: issues.length,
      errorTypes,
      byAction,
    },
  };
}

module.exports = { auditWorkflowTrace };

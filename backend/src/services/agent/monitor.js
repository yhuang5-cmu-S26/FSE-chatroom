const AgentMessage = require("../../models/AgentMessage");
const WorkflowRun = require("../../models/WorkflowRun");
const WorkflowStep = require("../../models/WorkflowStep");
const ToolCall = require("../../models/ToolCall");
const WorkflowEvent = require("../../models/WorkflowEvent");

const idOf = (value) => String(value?._id || value?.id || value || "");
const plain = (value) => value?.toObject?.() || value;
const time = (value) => (value ? new Date(value).getTime() : 0);
const elapsed = (start, end = new Date()) =>
  Math.max(0, time(end) - time(start));

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  ];
}

function runStatusLabel(state) {
  return (
    {
      awaiting_approval: "等待计划审批",
      awaiting_input: "等待工具审批",
      running: "正在执行",
      succeeded: "执行成功",
      failed: "执行失败",
      rejected: "已拒绝",
      handed_off: "人工接管",
    }[state] || state
  );
}

/** Builds one UI-ready trace without inventing spans that were not persisted. */
function summarizeRun({
  run,
  message,
  steps = [],
  toolCalls = [],
  events = [],
}) {
  const runValue = plain(run);
  const messageValue = plain(message);
  const now = new Date();
  const planningLatencyMs = Number(
    messageValue?.planner?.planningLatencyMs || 0,
  );
  const executionLatencyMs = runValue
    ? elapsed(
        runValue.requestedAt || runValue.createdAt,
        runValue.completedAt || now,
      )
    : 0;
  const completedTools = toolCalls.filter((call) => call.state !== "running");
  const successfulTools = toolCalls.filter(
    (call) => call.state === "succeeded",
  );

  return {
    id: idOf(runValue),
    sessionId: idOf(runValue?.sessionId),
    state: runValue?.state || "idle",
    stateLabel: runStatusLabel(runValue?.state || "idle"),
    currentStep:
      steps.find((step) => step.state === "running")?.title ||
      steps.find((step) => step.state === "planned")?.title ||
      [...steps]
        .reverse()
        .find((step) => ["failed", "rejected"].includes(step.state))?.title ||
      (runValue?.state === "succeeded" ? "全部完成" : "暂无执行步骤"),
    requestedAt: runValue?.requestedAt || runValue?.createdAt || null,
    completedAt: runValue?.completedAt || null,
    latency: {
      planningMs: planningLatencyMs,
      executionMs: executionLatencyMs,
      totalMs: planningLatencyMs + executionLatencyMs,
    },
    traffic: {
      promptTokens: Number(messageValue?.planner?.usage?.promptTokens || 0),
      completionTokens: Number(
        messageValue?.planner?.usage?.completionTokens || 0,
      ),
      totalTokens: Number(messageValue?.planner?.usage?.totalTokens || 0),
      toolCalls: toolCalls.length,
    },
    steps: steps.map((step) => ({
      id: idOf(step),
      sequence: step.sequence,
      title: step.title,
      actionType: step.action?.type || "",
      state: step.state,
      latencyMs: step.startedAt
        ? elapsed(step.startedAt, step.completedAt || now)
        : 0,
      error: step.error || "",
    })),
    toolCalls: toolCalls.map((call) => ({
      id: idOf(call),
      actionType: call.actionType,
      state: call.state,
      durationMs: Number(call.durationMs || 0),
      startedAt: call.startedAt,
      input: call.input,
      output: call.output,
      error: call.error || "",
    })),
    events: events.map((event) => ({
      id: idOf(event),
      type: event.type,
      occurredAt: event.occurredAt,
      payload: event.payload,
    })),
    success: {
      run: runValue?.state === "succeeded",
      tools: completedTools.length
        ? successfulTools.length / completedTools.length
        : null,
    },
  };
}

async function loadRunTrace(run, userId) {
  const runValue = plain(run);
  const [message, steps, toolCalls, events] = await Promise.all([
    AgentMessage.findOne({ _id: runValue.messageId, userId }).lean(),
    WorkflowStep.find({ runId: idOf(runValue) })
      .sort({ sequence: 1 })
      .lean(),
    ToolCall.find({ runId: idOf(runValue) })
      .sort({ createdAt: 1 })
      .lean(),
    WorkflowEvent.find({ runId: idOf(runValue) })
      .sort({ occurredAt: 1 })
      .lean(),
  ]);
  return summarizeRun({ run: runValue, message, steps, toolCalls, events });
}

async function getSessionMonitor(sessionId, userId) {
  const [runs, messages] = await Promise.all([
    WorkflowRun.find({ sessionId, userId })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean(),
    AgentMessage.find({ sessionId, userId, role: "assistant" })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  ]);
  const traces = await Promise.all(
    runs.map((run) => loadRunTrace(run, userId)),
  );
  const terminal = traces.filter((trace) =>
    ["succeeded", "failed", "rejected"].includes(trace.state),
  );
  const calls = traces.flatMap((trace) => trace.toolCalls);
  const finishedCalls = calls.filter((call) => call.state !== "running");
  const planningLatencies = messages
    .map((message) => Number(message.planner?.planningLatencyMs || 0))
    .filter(Boolean);

  return {
    generatedAt: new Date().toISOString(),
    active: traces[0] || null,
    recent: traces.slice(0, 8),
    metrics: {
      requestCount: messages.length,
      runCount: traces.length,
      runSuccessRate: terminal.length
        ? terminal.filter((trace) => trace.state === "succeeded").length /
          terminal.length
        : null,
      toolCallCount: calls.length,
      toolSuccessRate: finishedCalls.length
        ? finishedCalls.filter((call) => call.state === "succeeded").length /
          finishedCalls.length
        : null,
      planningP50Ms: percentile(planningLatencies, 0.5),
      planningP95Ms: percentile(planningLatencies, 0.95),
      tokens: messages.reduce(
        (sum, message) =>
          sum + Number(message.planner?.usage?.totalTokens || 0),
        0,
      ),
    },
  };
}

module.exports = { getSessionMonitor, loadRunTrace, summarizeRun, percentile };

const WorkflowRun = require("../../models/WorkflowRun");
const WorkflowStep = require("../../models/WorkflowStep");
const ToolCall = require("../../models/ToolCall");
const Approval = require("../../models/Approval");
const WorkflowEvent = require("../../models/WorkflowEvent");

/** Converts a Mongoose document to a plain value for workflow detail responses. */
const value = (document) => document?.toObject?.() || document;

/** Appends an immutable audit event. Feature: resumable, observable Agent workflows. */
async function appendEvent(run, type, payload = {}) {
  return WorkflowEvent.create({
    runId: run.id,
    userId: run.userId,
    type,
    payload,
    occurredAt: new Date(),
  });
}

/** Creates a persisted run and its planned steps from a validated Agent plan. Feature: approval-gated workflows. */
async function createRun({ sessionId, userId, messageId, planner }) {
  const rejected = !planner.coverage?.canCover;
  const run = await WorkflowRun.create({
    sessionId,
    userId,
    messageId,
    state: rejected ? "rejected" : "awaiting_approval",
    requestedAt: planner.requestedAt || new Date(),
    stepCount: planner.todo.length,
    metadata: { model: planner.model || "", plannerMode: planner.mode || "" },
  });
  await Promise.all(
    planner.todo.map((step, sequence) =>
      WorkflowStep.create({
        runId: run.id,
        userId,
        sequence,
        title: step.title,
        action: step.action,
        state: step.status === "rejected" ? "rejected" : "planned",
        error: step.rejectionReason || "",
      }),
    ),
  );
  await appendEvent(run, rejected ? "run.rejected" : "run.created", {
    stepCount: planner.todo.length,
  });
  return run;
}

/** Loads one workflow run with user ownership enforced. */
async function getRun(runId, userId) {
  return WorkflowRun.findOne({ _id: runId, userId });
}

/** Records owner approval and moves a workflow to running. Feature: human-in-the-loop execution. */
async function approveRun(run, { messageId, userId }) {
  await Approval.create({
    runId: run.id,
    messageId,
    userId,
    decision: "approved",
    decidedAt: new Date(),
  });
  run.state = "running";
  await run.save();
  await appendEvent(run, "approval.granted");
}

/** Marks a planned step running and creates its ToolCall audit record. Feature: workflow execution tracing. */
async function startStep(run, sequence) {
  const step = await WorkflowStep.findOne({ runId: run.id, sequence });
  if (!step) throw new Error(`workflow step ${sequence} not found`);
  step.state = "running";
  step.startedAt = new Date();
  await step.save();
  const toolCall = await ToolCall.create({
    runId: run.id,
    stepId: step.id,
    userId: run.userId,
    actionType: step.action.type,
    input: step.action.arguments,
    state: "running",
    startedAt: step.startedAt,
  });
  await appendEvent(run, "tool.started", {
    sequence,
    actionType: step.action.type,
    toolCallId: toolCall.id,
  });
  return { step, toolCall };
}

/** Persists a ToolCall outcome on both its step and audit record. Feature: workflow execution tracing. */
async function completeStep(
  run,
  step,
  toolCall,
  result,
  error = null,
  errorType = "",
) {
  const completedAt = new Date();
  const success = !error;
  step.state = success ? "succeeded" : "failed";
  step.output = success ? result : null;
  step.error = error?.message || "";
  step.errorType = errorType;
  step.completedAt = completedAt;
  await step.save();
  toolCall.state = success ? "succeeded" : "failed";
  toolCall.output = success ? result : null;
  toolCall.error = error?.message || "";
  toolCall.errorType = errorType;
  toolCall.completedAt = completedAt;
  toolCall.durationMs =
    completedAt.getTime() - new Date(toolCall.startedAt).getTime();
  await toolCall.save();
  await appendEvent(run, success ? "tool.succeeded" : "tool.failed", {
    stepId: step.id,
    toolCallId: toolCall.id,
    errorType,
  });
}

/** Marks a run terminal and records its final audit event. Feature: workflow recovery and observability. */
async function finishRun(run, failed) {
  run.state = failed ? "failed" : "succeeded";
  run.completedAt = new Date();
  await run.save();
  await appendEvent(run, failed ? "run.failed" : "run.succeeded");
}

/** Adds a generated post as a new approval-gated step. Feature: conditional weather-alert publishing. */
async function appendConditionalPostStep(run, { title, content }) {
  const sequence = run.stepCount;
  const step = await WorkflowStep.create({
    runId: run.id,
    userId: run.userId,
    sequence,
    title,
    action: { type: "post.publish", arguments: { content } },
    state: "planned",
  });
  run.stepCount += 1;
  run.state = "awaiting_approval";
  run.completedAt = null;
  await run.save();
  await appendEvent(run, "approval.requested", {
    sequence,
    actionType: "post.publish",
    title,
  });
  return step;
}

/** Reopens only failed runs for controlled retry. Feature: Agent workflow recovery. */
async function retryRun(run) {
  if (run.state !== "failed")
    throw new Error("only failed workflow runs can be retried");
  run.state = "running";
  run.completedAt = null;
  await run.save();
  await appendEvent(run, "run.retry_started");
}

/** Records an explicit human takeover and closes the automated run. Feature: Agent escalation. */
async function handoffRun(run, { messageId, userId, reason = "" }) {
  await Approval.create({
    runId: run.id,
    messageId,
    userId,
    decision: "handed_off",
    reason,
    decidedAt: new Date(),
  });
  run.state = "handed_off";
  run.completedAt = new Date();
  await run.save();
  await appendEvent(run, "run.handed_off", { reason });
}

/** Assembles the run, steps, calls, approvals, and events for workflow audit views. */
async function getRunDetail(run) {
  const [steps, toolCalls, approvals, events] = await Promise.all([
    WorkflowStep.find({ runId: run.id }).sort({ sequence: 1 }).lean(),
    ToolCall.find({ runId: run.id }).sort({ createdAt: 1 }).lean(),
    Approval.find({ runId: run.id }).sort({ decidedAt: 1 }).lean(),
    WorkflowEvent.find({ runId: run.id }).sort({ occurredAt: 1 }).lean(),
  ]);
  return { run: value(run), steps, toolCalls, approvals, events };
}

/** Deletes only idle workflow records for a session. Feature: safe Agent session deletion. */
async function deleteWorkflowStateForSession(sessionId, userId) {
  const runs = await WorkflowRun.find({ sessionId, userId }).lean();
  if (runs.some((run) => run.state === "running")) {
    const error = new Error("cannot delete a session with a running workflow");
    error.status = 409;
    throw error;
  }
  await Promise.all(
    runs.flatMap((run) => {
      const runId = String(run._id || run.id);
      return [
        WorkflowStep.deleteMany({ runId }),
        ToolCall.deleteMany({ runId }),
        Approval.deleteMany({ runId }),
        WorkflowEvent.deleteMany({ runId }),
      ];
    }),
  );
  await WorkflowRun.deleteMany({ sessionId, userId });
  return { deletedRunCount: runs.length };
}

module.exports = {
  createRun,
  getRun,
  approveRun,
  startStep,
  completeStep,
  finishRun,
  appendConditionalPostStep,
  retryRun,
  handoffRun,
  getRunDetail,
  deleteWorkflowStateForSession,
};

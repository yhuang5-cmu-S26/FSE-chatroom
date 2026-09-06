const express = require("express");
const { authenticate, authorize } = require("../middleware/auth");
const {
  planAgentRequest,
  planAgentRequestStream,
  welcomeResponse,
  executeAgentAction,
} = require("../services/agentActions");
const {
  createSession,
  resolveSession,
  appendMessage,
  listSessions,
  listMessages,
  promptHistory,
  getOwnedMessage,
  serializeSession,
  serializeMessage,
} = require("../services/agentSessions");
const AgentMessage = require('../models/AgentMessage');
const { evaluateAgentMessages, classifyError } = require('../services/agentEvaluation');
const WorkflowRun = require('../models/WorkflowRun');
const { createRun, getRun, approveRun, startStep, completeStep, finishRun, retryRun, handoffRun, getRunDetail } = require('../services/workflowState');

const router = express.Router();
router.use(authenticate);

async function ensureWorkflowRun(message, session, userId) {
  let run = await getRun(message.planner.runId, userId);
  if (run) return run;
  // Supports plans persisted before WorkflowRun was introduced; new plans always
  // receive a run during planning.
  run = await createRun({ sessionId: session.id, userId, messageId: message.id, planner: message.planner });
  message.planner.runId = run.id;
  if (typeof message.markModified === 'function') message.markModified('planner');
  await message.save();
  return run;
}

async function executeRemainingSteps(message, run, actor, io) {
  const byId = new Map((message.planner.execution?.steps || []).map((step) => [step.id, step]));
  for (const [sequence, step] of message.planner.todo.entries()) {
    if (step.status === 'executed') continue;
    let persisted;
    try {
      persisted = await startStep(run, sequence);
      const result = await executeAgentAction(step.action, actor, { io, idempotencyKey: `${run.id}:${persisted.step.id}` });
      step.status = 'executed';
      await completeStep(run, persisted.step, persisted.toolCall, result);
      byId.set(step.id, { id: step.id, status: 'executed', result });
    } catch (error) {
      step.status = 'failed';
      if (persisted) await completeStep(run, persisted.step, persisted.toolCall, null, error, classifyError(error.message));
      byId.set(step.id, { id: step.id, status: 'failed', error: error.message, errorType: classifyError(error.message) });
      const failed = true;
      message.planner.approvalStatus = 'failed';
      message.planner.execution = { status: 'failed', steps: message.planner.todo.map((item) => byId.get(item.id)).filter(Boolean), completedAt: new Date() };
      await finishRun(run, failed);
      if (typeof message.markModified === 'function') message.markModified('planner');
      await message.save();
      return false;
    }
  }
  message.planner.approvalStatus = 'executed';
  message.planner.execution = { status: 'executed', steps: message.planner.todo.map((item) => byId.get(item.id)).filter(Boolean), completedAt: new Date() };
  await finishRun(run, false);
  if (typeof message.markModified === 'function') message.markModified('planner');
  await message.save();
  return true;
}
router.get("/sessions", async (req, res, next) => {
  try {
    res.json({ sessions: await listSessions(req.user.id) });
  } catch (error) {
    next(error);
  }
});
router.post("/sessions", async (req, res, next) => {
  try {
    res
      .status(201)
      .json({ session: serializeSession(await createSession(req.user.id)) });
  } catch (error) {
    next(error);
  }
});
router.get("/sessions/:sessionId/messages", async (req, res, next) => {
  try {
    const messages = await listMessages(
      req.params.sessionId,
      req.user.id,
      req.query.limit,
    );
    if (!messages)
      return res.status(404).json({ error: "agent session not found" });
    return res.json({ messages });
  } catch (error) {
    return next(error);
  }
});

function writeSse(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }

router.post('/chat/stream', async (req, res) => {
  res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.flushHeaders?.();
  try {
    const requestedAt = new Date();
    const session = await resolveSession(req.body.sessionId, req.user.id);
    const input = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (!input) throw new Error('message is required');
    const history = await promptHistory(session.id, req.user.id);
    await appendMessage(session, req.user.id, { role: 'user', content: input });
    const result = await planAgentRequestStream(input, req.user, { history, onDelta: (text) => writeSse(res, 'delta', { text }) });
    const approvalStatus = result.intent === 'command' ? (result.coverage.canCover ? 'pending' : 'rejected') : 'not_required';
    const assistant = await appendMessage(session, req.user.id, { role: 'assistant', content: result.reply, planner: { mode: result.mode, intent: result.intent, todo: result.todo, coverage: result.coverage, requiresConfirmation: result.requiresConfirmation, approvalStatus, model: process.env.LLM_MODEL || '', requestedAt, planningLatencyMs: Date.now() - requestedAt.getTime() } });
    if (result.intent === 'command' && result.todo.length) {
      const run = await createRun({ sessionId: session.id, userId: req.user.id, messageId: assistant.id, planner: assistant.planner });
      assistant.planner.runId = run.id;
      if (typeof assistant.markModified === 'function') assistant.markModified('planner');
      await assistant.save();
    }
    writeSse(res, 'result', { session: serializeSession(session), message: serializeMessage(assistant), ...result });
  } catch (error) {
    writeSse(res, 'error', { error: error.message || 'streaming request failed' });
  } finally { res.end(); }
});

router.post("/chat", async (req, res, next) => {
  try {
    const requestedAt = new Date();
    const session = await resolveSession(req.body.sessionId, req.user.id);
    const input =
      typeof req.body.message === "string" ? req.body.message.trim() : "";
    if (!input) {
      let messages = await listMessages(session.id, req.user.id);
      let result = null;
      if (messages.length === 0) {
        result = await welcomeResponse(req.user);
        await appendMessage(session, req.user.id, {
          role: "assistant",
          content: result.reply,
          planner: {
            mode: result.mode,
            intent: result.intent,
            todo: [],
            coverage: result.coverage,
            requiresConfirmation: false,
            approvalStatus: "not_required",
          },
        });
        messages = await listMessages(session.id, req.user.id);
      }
      return res.json({
        session: serializeSession(session),
        messages,
        ...(result || {}),
      });
    }
    const history = await promptHistory(session.id, req.user.id);
    await appendMessage(session, req.user.id, { role: "user", content: input });
    const result = await planAgentRequest(input, req.user, { history });
    const approvalStatus =
      result.intent === "command"
        ? result.coverage.canCover
          ? "pending"
          : "rejected"
        : "not_required";
    const assistant = await appendMessage(session, req.user.id, {
      role: "assistant",
      content: result.reply,
      planner: {
        mode: result.mode,
        intent: result.intent,
        todo: result.todo,
        coverage: result.coverage,
        requiresConfirmation: result.requiresConfirmation,
        approvalStatus,
        model: process.env.LLM_MODEL || "",
        requestedAt,
        planningLatencyMs: Date.now() - requestedAt.getTime(),
      },
    });
    if (result.intent === 'command' && result.todo.length) {
      const run = await createRun({ sessionId: session.id, userId: req.user.id, messageId: assistant.id, planner: assistant.planner });
      assistant.planner.runId = run.id;
      if (typeof assistant.markModified === 'function') assistant.markModified('planner');
      await assistant.save();
    }
    return res.json({
      session: serializeSession(session),
      message: serializeMessage(assistant),
      ...result,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/sessions/:sessionId/runs', async (req, res, next) => {
  try {
    const session = await resolveSession(req.params.sessionId, req.user.id);
    const runs = await WorkflowRun.find({ sessionId: session.id, userId: req.user.id }).sort({ createdAt: -1 }).lean();
    return res.json({ runs });
  } catch (error) { return next(error); }
});

router.get('/runs/:runId', async (req, res, next) => {
  try {
    const run = await getRun(req.params.runId, req.user.id);
    if (!run) return res.status(404).json({ error: 'workflow run not found' });
    return res.json(await getRunDetail(run));
  } catch (error) { return next(error); }
});

router.get('/evals/summary', authorize('admin'), async (_req, res, next) => {
  try {
    const messages = await AgentMessage.find({ role: 'assistant' }).lean();
    return res.json(evaluateAgentMessages(messages));
  } catch (error) { return next(error); }
});

router.post("/sessions/:sessionId/approve", async (req, res, next) => {
  try {
    const session = await resolveSession(req.params.sessionId, req.user.id);
    const message = await getOwnedMessage(
      req.body.messageId,
      session.id,
      req.user.id,
    );
    if (!message?.planner || message.planner.intent !== "command")
      return res
        .status(400)
        .json({ error: "message does not contain an executable command plan" });
    if (
      !message.planner.coverage?.canCover ||
      message.planner.approvalStatus === "rejected"
    )
      return res
        .status(409)
        .json({
          error:
            "command plan cannot be approved because it contains rejected steps",
        });
    if (message.planner.approvalStatus !== "pending")
      return res
        .status(409)
        .json({
          error: `command plan is already ${message.planner.approvalStatus}`,
        });

    const run = await ensureWorkflowRun(message, session, req.user.id);
    if (!run || run.state !== 'awaiting_approval') return res.status(409).json({ error: 'workflow run is not awaiting approval' });
    message.planner.approvalStatus = "approved";
    await approveRun(run, { messageId: message.id, userId: req.user.id });
    await executeRemainingSteps(message, run, req.user, req.app.locals.io);
    return res.json({ message: serializeMessage(message) });
  } catch (error) {
    return next(error);
  }
});

router.post('/sessions/:sessionId/runs/:runId/retry', async (req, res, next) => {
  try {
    const session = await resolveSession(req.params.sessionId, req.user.id);
    const run = await getRun(req.params.runId, req.user.id);
    if (!run || String(run.sessionId) !== String(session.id)) return res.status(404).json({ error: 'workflow run not found' });
    const message = await getOwnedMessage(run.messageId, session.id, req.user.id);
    if (!message || message.planner.approvalStatus !== 'failed') return res.status(409).json({ error: 'workflow run is not retryable' });
    await retryRun(run);
    message.planner.approvalStatus = 'approved';
    await executeRemainingSteps(message, run, req.user, req.app.locals.io);
    return res.json({ message: serializeMessage(message) });
  } catch (error) { return next(error); }
});

router.post('/sessions/:sessionId/handoff', async (req, res, next) => {
  try {
    const session = await resolveSession(req.params.sessionId, req.user.id);
    const message = await getOwnedMessage(req.body.messageId, session.id, req.user.id);
    if (!message?.planner || message.planner.intent !== 'command') return res.status(400).json({ error: 'message does not contain a command plan' });
    if (message.planner.approvalStatus === 'executed') return res.status(409).json({ error: 'executed command plan cannot be handed off' });
    const run = await ensureWorkflowRun(message, session, req.user.id);
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    message.planner.handoff = { requestedAt: new Date(), reason };
    if (message.planner.approvalStatus === 'pending') message.planner.approvalStatus = 'handed_off';
    await handoffRun(run, { messageId: message.id, userId: req.user.id, reason });
    if (typeof message.markModified === 'function') message.markModified('planner');
    await message.save();
    return res.json({ message: serializeMessage(message) });
  } catch (error) { return next(error); }
});
module.exports = router;

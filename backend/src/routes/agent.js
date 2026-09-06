const express = require("express");
const { authenticate, authorize } = require("../middleware/auth");
const {
  planAgentRequest,
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

const router = express.Router();
router.use(authenticate);
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
    return res.json({
      session: serializeSession(session),
      message: serializeMessage(assistant),
      ...result,
    });
  } catch (error) {
    return next(error);
  }
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

    message.planner.approvalStatus = "approved";
    const steps = [];
    for (const step of message.planner.todo) {
      try {
        const result = await executeAgentAction(step.action, req.user, {
          io: req.app.locals.io,
        });
        step.status = "executed";
        steps.push({ id: step.id, status: "executed", result });
      } catch (error) {
        step.status = "failed";
        steps.push({ id: step.id, status: "failed", error: error.message, errorType: classifyError(error.message) });
        break;
      }
    }
    const failed = steps.some((step) => step.status === "failed");
    message.planner.approvalStatus = failed ? "failed" : "executed";
    message.planner.execution = {
      status: message.planner.approvalStatus,
      steps,
      completedAt: new Date(),
    };
    if (typeof message.markModified === "function")
      message.markModified("planner");
    await message.save();
    return res.json({ message: serializeMessage(message) });
  } catch (error) {
    return next(error);
  }
});

router.post('/sessions/:sessionId/handoff', async (req, res, next) => {
  try {
    const session = await resolveSession(req.params.sessionId, req.user.id);
    const message = await getOwnedMessage(req.body.messageId, session.id, req.user.id);
    if (!message?.planner || message.planner.intent !== 'command') return res.status(400).json({ error: 'message does not contain a command plan' });
    if (message.planner.approvalStatus === 'executed') return res.status(409).json({ error: 'executed command plan cannot be handed off' });
    message.planner.handoff = { requestedAt: new Date(), reason: String(req.body.reason || '').trim().slice(0, 500) };
    if (message.planner.approvalStatus === 'pending') message.planner.approvalStatus = 'handed_off';
    if (typeof message.markModified === 'function') message.markModified('planner');
    await message.save();
    return res.json({ message: serializeMessage(message) });
  } catch (error) { return next(error); }
});
module.exports = router;

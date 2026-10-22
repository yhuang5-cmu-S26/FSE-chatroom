const express = require("express");
const { authenticate, authorize } = require("../middleware/auth");
const { welcomeResponse } = require("../services/agent/planner");
const {
  executeApprovedAgentWorkflow,
  planAgentWorkflow,
  planAgentWorkflowStream,
  resumeAgentWorkflow,
} = require("../services/agent/workflow");
const {
  createSession,
  resolveSession,
  appendMessage,
  listSessions,
  listMessages,
  deleteSession,
  getOwnedMessage,
  serializeSession,
  serializeMessage,
} = require("../services/agent/sessions");
const {
  commitMemoryMessagesBestEffort,
  prepareMemoryContext,
  withSessionMemory,
} = require("../services/agent/memory");
const AgentMessage = require("../models/AgentMessage");
const { evaluateAgentMessages } = require("../services/agent/evaluation");
const { assessToolCall, POLICY_DECISION } = require("../services/agent/toolPolicy");
const { getSessionMonitor, loadRunTrace } = require("../services/agent/monitor");
const WorkflowRun = require("../models/WorkflowRun");
const {
  createRun,
  getRun,
  approveRun,
  retryRun,
  handoffRun,
  getRunDetail,
} = require("../services/workflow/state");

const router = express.Router();

// All endpoints below are user-scoped. authenticate() resolves req.user before
// a route can look up sessions, messages, or workflow runs.
router.use(authenticate);

/**
 * Compatibility and recovery boundary for execution endpoints.
 *
 * New plans create a WorkflowRun during `/chat`; this helper repairs old
 * persisted messages that predate that model. Keeping the repair here makes
 * `approve`, `retry`, and `handoff` share the same ownership-safe lookup path.
 */
async function ensureWorkflowRun(message, session, userId) {
  let run = await getRun(message.planner.runId, userId);
  if (run) return run;
  // Supports plans persisted before WorkflowRun was introduced; new plans always
  // receive a run during planning.
  run = await createRun({
    sessionId: session.id,
    userId,
    messageId: message.id,
    planner: message.planner,
  });
  message.planner.runId = run.id;
  if (typeof message.markModified === "function")
    message.markModified("planner");
  await message.save();
  return run;
}

// Conversation persistence/read model endpoints. These do not invoke the LLM
// or LangGraph; session helpers enforce that every resource belongs to req.user.
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
router.delete("/sessions/:sessionId", async (req, res, next) => {
  try {
    await deleteSession(req.params.sessionId, req.user.id);
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

/** Writes one Server-Sent Event frame. The route owns the transport protocol;
 * the workflow only emits text through the supplied onDelta callback. */
function writeSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Streaming planning entry point.
 *
 * Request -> resolveSession -> load bounded memory -> persist user message
 *         -> planAgentWorkflowStream (LangGraph planning graph)
 *         -> persist assistant plan + WorkflowRun -> SSE result.
 *
 * The `delta` events are model-token deltas forwarded by planner.js. They are
 * not LangGraph graph-state streaming; the completed graph result is sent as
 * the final `result` event.
 */
router.post("/chat/stream", async (req, res) => {
  res.set({
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.flushHeaders?.();
  try {
    const requestedAt = new Date();
    // 1) Tenant/ownership boundary: resolve an existing session or create one.
    const session = await resolveSession(req.body.sessionId, req.user.id);
    const input =
      typeof req.body.message === "string" ? req.body.message.trim() : "";
    if (!input) throw new Error("message is required");
    await withSessionMemory(session.id, async () => {
      // 2) The memory document contains a rolling summary plus a token-bounded
      // recent window. AgentMessage is scanned only once for legacy migration.
      const memory = await prepareMemoryContext(session, req.user.id, input);
      const userMessage = await appendMessage(session, req.user.id, {
        role: "user",
        content: input,
      });
      let assistant = null;
      try {
        // 3) Planning receives structured memory separately from normal messages.
        const result = await planAgentWorkflowStream(input, req.user, {
          history: memory.history,
          systemMemory: memory.systemMemory,
          onDelta: (text) => writeSse(res, "delta", { text }),
        });
        const approvalStatus =
          result.intent === "command"
            ? result.coverage.canCover
              ? "pending"
              : "rejected"
            : "not_required";
        assistant = await appendMessage(session, req.user.id, {
          role: "assistant",
          content: result.reply,
          planner: {
            mode: result.mode,
            intent: result.intent,
            todo: result.todo,
            coverage: result.coverage,
            weatherAlert: result.weatherAlert,
            requiresConfirmation: result.requiresConfirmation,
            approvalStatus,
            model: process.env.LLM_MODEL || "",
            requestedAt,
            planningLatencyMs: Date.now() - requestedAt.getTime(),
            usage: result.usage || undefined,
          },
        });
        if (result.intent === "command" && result.todo.length) {
          const run = await createRun({
            sessionId: session.id,
            userId: req.user.id,
            messageId: assistant.id,
            planner: assistant.planner,
          });
          assistant.planner.runId = run.id;
          if (typeof assistant.markModified === "function")
            assistant.markModified("planner");
          await assistant.save();
        }
        await commitMemoryMessagesBestEffort(session, req.user.id, [
          { id: userMessage.id, role: "user", content: userMessage.content },
          { id: assistant.id, role: "assistant", content: assistant.content },
        ]);
        writeSse(res, "result", {
          session: serializeSession(session),
          message: serializeMessage(assistant),
          memory: { stats: memory.stats },
          ...result,
        });
      } catch (error) {
        await commitMemoryMessagesBestEffort(session, req.user.id, [
          { id: userMessage.id, role: "user", content: userMessage.content },
          ...(assistant
            ? [
                {
                  id: assistant.id,
                  role: "assistant",
                  content: assistant.content,
                },
              ]
            : []),
        ]);
        throw error;
      }
    });
  } catch (error) {
    writeSse(res, "error", {
      error: error.message || "streaming request failed",
    });
  } finally {
    res.end();
  }
});

/**
 * Non-streaming planning entry point. It has the same persistence and
 * approval semantics as `/chat/stream`, but returns one JSON response.
 * Empty input is intentionally routed to the deterministic welcome response,
 * avoiding an unnecessary model call.
 */
router.post("/chat", async (req, res, next) => {
  try {
    const requestedAt = new Date();
    // 1) Resolve the owned conversation aggregate.
    const session = await resolveSession(req.body.sessionId, req.user.id);
    const input =
      typeof req.body.message === "string" ? req.body.message.trim() : "";
    if (!input) {
      // hello
      return withSessionMemory(session.id, async () => {
        let messages = await listMessages(session.id, req.user.id);
        let result = null;
        if (messages.length === 0) {
          result = await welcomeResponse(req.user);
          const assistant = await appendMessage(session, req.user.id, {
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
          await commitMemoryMessagesBestEffort(session, req.user.id, [
            { id: assistant.id, role: "assistant", content: assistant.content },
          ]);
          messages = await listMessages(session.id, req.user.id);
        }
        return res.json({
          session: serializeSession(session),
          messages,
          ...(result || {}),
        });
      });
    }
    // real chat
    return withSessionMemory(session.id, async () => {
      const memory = await prepareMemoryContext(session, req.user.id, input);
      const userMessage = await appendMessage(session, req.user.id, {
        role: "user",
        content: input,
      });
      let assistant = null;
      try {
        const result = await planAgentWorkflow(input, req.user, {
          history: memory.history,
          systemMemory: memory.systemMemory,
        });
        const approvalStatus =
          result.intent === "command"
            ? result.coverage.canCover
              ? "pending"
              : "rejected"
            : "not_required";
        assistant = await appendMessage(session, req.user.id, {
          role: "assistant",
          content: result.reply,
          planner: {
            mode: result.mode,
            intent: result.intent,
            todo: result.todo,
            coverage: result.coverage,
            weatherAlert: result.weatherAlert,
            requiresConfirmation: result.requiresConfirmation,
            approvalStatus,
            model: process.env.LLM_MODEL || "",
            requestedAt,
            planningLatencyMs: Date.now() - requestedAt.getTime(),
            usage: result.usage || undefined,
          },
        });
        if (result.intent === "command" && result.todo.length) {
          const run = await createRun({
            sessionId: session.id,
            userId: req.user.id,
            messageId: assistant.id,
            planner: assistant.planner,
          });
          assistant.planner.runId = run.id;
          if (typeof assistant.markModified === "function")
            assistant.markModified("planner");
          await assistant.save();
        }
        await commitMemoryMessagesBestEffort(session, req.user.id, [
          { id: userMessage.id, role: "user", content: userMessage.content },
          { id: assistant.id, role: "assistant", content: assistant.content },
        ]);
        return res.json({
          session: serializeSession(session),
          message: serializeMessage(assistant),
          memory: { stats: memory.stats },
          ...result,
        });
      } catch (error) {
        await commitMemoryMessagesBestEffort(session, req.user.id, [
          { id: userMessage.id, role: "user", content: userMessage.content },
          ...(assistant
            ? [
                {
                  id: assistant.id,
                  role: "assistant",
                  content: assistant.content,
                },
              ]
            : []),
        ]);
        throw error;
      }
    });
  } catch (error) {
    return next(error);
  }
});

// Audit/read-model endpoint: returns workflow runs for an owned session.
router.get("/sessions/:sessionId/runs", async (req, res, next) => {
  try {
    const session = await resolveSession(req.params.sessionId, req.user.id);
    const runs = await WorkflowRun.find({
      sessionId: session.id,
      userId: req.user.id,
    })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ runs });
  } catch (error) {
    return next(error);
  }
});

router.get("/runs/:runId", async (req, res, next) => {
  try {
    const run = await getRun(req.params.runId, req.user.id);
    if (!run) return res.status(404).json({ error: "workflow run not found" });
    return res.json(await getRunDetail(run));
  } catch (error) {
    return next(error);
  }
});

// Session-scoped observability read model. Polling this endpoint is cheap enough
// for the dashboard and keeps workflow persistence as the source of truth.
router.get("/sessions/:sessionId/monitor", async (req, res, next) => {
  try {
    const session = await resolveSession(req.params.sessionId, req.user.id);
    return res.json(await getSessionMonitor(session.id, req.user.id));
  } catch (error) {
    return next(error);
  }
});

/**
 * Runs an isolated, one-off set of prompts. Read-only tools may execute;
 * side-effecting tools remain approval-gated and are reported as skipped.
 */
router.post("/monitor/tests", async (req, res, next) => {
  try {
    const cases = Array.isArray(req.body.cases)
      ? req.body.cases.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    if (!cases.length || cases.length > 10)
      return res.status(400).json({ error: "cases must contain 1-10 prompts" });

    const results = [];
    for (const prompt of cases) {
      const startedAt = new Date();
      const session = await createSession(req.user.id);
      const userMessage = await appendMessage(session, req.user.id, {
        role: "user",
        content: prompt,
      });
      try {
        const result = await planAgentWorkflow(prompt, req.user, { history: [] });
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
            weatherAlert: result.weatherAlert,
            requiresConfirmation: result.requiresConfirmation,
            approvalStatus,
            model: process.env.LLM_MODEL || "",
            requestedAt: startedAt,
            planningLatencyMs: Date.now() - startedAt.getTime(),
            usage: result.usage || undefined,
          },
        });
        let run = null;
        let executionMode = result.intent === "conversation" ? "conversation" : "planned";
        if (result.intent === "command" && result.todo.length) {
          run = await createRun({
            sessionId: session.id,
            userId: req.user.id,
            messageId: assistant.id,
            planner: assistant.planner,
          });
          assistant.planner.runId = run.id;
          if (typeof assistant.markModified === "function") assistant.markModified("planner");
          await assistant.save();

          const policies = await Promise.all(
            result.todo.map((step) => assessToolCall(step.action, req.user)),
          );
          const canAutoExecute =
            result.coverage.canCover &&
            policies.every((policy) => policy.decision === POLICY_DECISION.ALLOW);
          if (canAutoExecute) {
            await approveRun(run, { messageId: assistant.id, userId: req.user.id });
            const execution = await executeApprovedAgentWorkflow({
              message: assistant,
              run,
              actor: req.user,
              io: req.app.locals.io,
            });
            run = execution.run || (await getRun(run.id, req.user.id));
            executionMode = "read_only_executed";
          } else if (policies.some((policy) => policy.decision === POLICY_DECISION.REQUIRE_APPROVAL)) {
            executionMode = "approval_required";
          } else if (policies.some((policy) => policy.decision === POLICY_DECISION.DENY)) {
            executionMode = "policy_denied";
          }
        }
        const trace = run ? await loadRunTrace(run, req.user.id) : null;
        if (executionMode === "read_only_executed" && trace?.state !== "succeeded")
          executionMode = "read_only_failed";
        results.push({
          prompt,
          session: serializeSession(session),
          planningSucceeded: true,
          executionMode,
          executionSucceeded:
            executionMode === "conversation" || trace?.state === "succeeded",
          trace,
          reply: result.reply,
        });
        void userMessage;
      } catch (error) {
        results.push({
          prompt,
          session: serializeSession(session),
          planningSucceeded: false,
          executionMode: "failed",
          error: error.message,
        });
      }
    }

    const calls = results.flatMap((item) => item.trace?.toolCalls || []);
    const finishedCalls = calls.filter((call) => call.state !== "running");
    return res.status(201).json({
      createdAt: new Date().toISOString(),
      summary: {
        total: results.length,
        planningSuccessRate:
          results.filter((item) => item.planningSucceeded).length / results.length,
        executionSuccessRate:
          results.filter((item) => item.executionSucceeded).length / results.length,
        toolSuccessRate: finishedCalls.length
          ? finishedCalls.filter((call) => call.state === "succeeded").length /
            finishedCalls.length
          : null,
        toolCallCount: calls.length,
      },
      results,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/evals/summary", authorize("admin"), async (_req, res, next) => {
  try {
    const messages = await AgentMessage.find({ role: "assistant" }).lean();
    return res.json(evaluateAgentMessages(messages));
  } catch (error) {
    return next(error);
  }
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
      return res.status(409).json({
        error:
          "command plan cannot be approved because it contains rejected steps",
      });
    if (message.planner.approvalStatus !== "pending")
      return res.status(409).json({
        error: `command plan is already ${message.planner.approvalStatus}`,
      });

    // 1) Recover/verify the durable run and confirm it is awaiting approval.
    const run = await ensureWorkflowRun(message, session, req.user.id);
    if (!run || run.state !== "awaiting_approval")
      return res
        .status(409)
        .json({ error: "workflow run is not awaiting approval" });
    message.planner.approvalStatus = "approved";
    // 2) Persist the human decision before any side-effecting tool is called.
    await approveRun(run, { messageId: message.id, userId: req.user.id });
    // 3) Execution boundary: LangGraph loops over persisted Todo steps.
    const execution = await executeApprovedAgentWorkflow({
      message,
      run,
      actor: req.user,
      io: req.app.locals.io,
    });
    return res.json({
      message: serializeMessage(execution.message),
      interrupt: execution.interrupt,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * 恢复一个被 LangGraph interrupt 暂停的执行。
 * reply="确认" 保留原正文；其他非空文本作为新的完整正文。
 */
router.post(
  "/sessions/:sessionId/runs/:runId/resume",
  async (req, res, next) => {
    try {
      const session = await resolveSession(req.params.sessionId, req.user.id);
      const run = await getRun(req.params.runId, req.user.id);
      if (!run || String(run.sessionId) !== String(session.id))
        return res.status(404).json({ error: "workflow run not found" });
      if (run.state !== "awaiting_input")
        return res
          .status(409)
          .json({ error: "workflow run is not awaiting human input" });
      const message = await getOwnedMessage(
        run.messageId,
        session.id,
        req.user.id,
      );
      if (!message)
        return res.status(404).json({ error: "workflow message not found" });

      const execution = await resumeAgentWorkflow({
        message,
        run,
        actor: req.user,
        response: req.body.response ?? req.body.reply,
        interruptId: req.body.interruptId,
        io: req.app.locals.io,
      });
      return res.json({
        message: serializeMessage(execution.message),
        interrupt: execution.interrupt,
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.post(
  "/sessions/:sessionId/runs/:runId/retry",
  async (req, res, next) => {
    try {
      const session = await resolveSession(req.params.sessionId, req.user.id);
      const run = await getRun(req.params.runId, req.user.id);
      if (!run || String(run.sessionId) !== String(session.id))
        return res.status(404).json({ error: "workflow run not found" });
      const message = await getOwnedMessage(
        run.messageId,
        session.id,
        req.user.id,
      );
      if (!message || message.planner.approvalStatus !== "failed")
        return res.status(409).json({ error: "workflow run is not retryable" });
      // Retry changes durable run state first; execution uses per-step
      // idempotency keys, so tool adapters can safely reject duplicate effects.
      await retryRun(run);
      message.planner.approvalStatus = "approved";
      const execution = await executeApprovedAgentWorkflow({
        message,
        run,
        actor: req.user,
        io: req.app.locals.io,
      });
      return res.json({
        message: serializeMessage(execution.message),
        interrupt: execution.interrupt,
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.post("/sessions/:sessionId/handoff", async (req, res, next) => {
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
        .json({ error: "message does not contain a command plan" });
    if (message.planner.approvalStatus === "executed")
      return res
        .status(409)
        .json({ error: "executed command plan cannot be handed off" });
    // Handoff is an explicit human-takeover terminal path, not execution.
    const run = await ensureWorkflowRun(message, session, req.user.id);
    const reason = String(req.body.reason || "")
      .trim()
      .slice(0, 500);
    message.planner.handoff = { requestedAt: new Date(), reason };
    if (message.planner.approvalStatus === "pending")
      message.planner.approvalStatus = "handed_off";
    await handoffRun(run, {
      messageId: message.id,
      userId: req.user.id,
      reason,
    });
    if (typeof message.markModified === "function")
      message.markModified("planner");
    await message.save();
    return res.json({ message: serializeMessage(message) });
  } catch (error) {
    return next(error);
  }
});
module.exports = router;

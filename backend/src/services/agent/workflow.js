const {
  Annotation,
  Command,
  END,
  START,
  StateGraph,
  interrupt,
  isGraphInterrupt,
} = require("@langchain/langgraph");
const AgentMessage = require("../../models/AgentMessage");
const WorkflowRun = require("../../models/WorkflowRun");

const {
  executeAgentAction,
  planAgentRequest,
  planAgentRequestStream,
} = require("./planner");
const { classifyError } = require("./evaluation");
const {
  evaluateWeatherAlert,
  formatWeatherAlertPost,
} = require("./weatherAlertEvaluator");
const {
  appendConditionalPostStep,
  acceptHumanInput,
  completeStep,
  finishRun,
  getWorkflowStep,
  rejectHumanInput,
  rejectRun,
  rejectStep,
  requestHumanInput,
  startStep,
  updateStepAction,
} = require("../workflow/state");
const {
  POLICY_DECISION,
  approvalRequest,
  assessToolCall,
  authorizeToolExecution,
  issueApprovalGrant,
  policyError,
} = require("./toolPolicy");
const {
  workflowCheckpointer,
  workflowThreadId,
} = require("../workflow/checkpointer");

/**
 * Agent workflow orchestration, implemented with two small LangGraph graphs.
 *
 * Planning graph (no side effects):
 *   START -> plan -> [conversation | command | rejected] -> END
 *
 * Execution graph (only entered after a persisted human approval):
 *   START -> execute_step -> [execute_step | finalize] -> END
 *
 * `Annotation.Root` declares the graph state contract. An `Annotation()` with
 * no reducer is a last-write-wins value: every node returns a partial object,
 * and LangGraph merges that object into the state for the next node. Nodes
 * should therefore return only fields they own rather than reconstructing the
 * entire state.
 *
 * Planning uses `graph.invoke()` to completion. Execution may instead pause at
 * `interrupt()` and resume in a later HTTP request through `Command({ resume })`.
 * `planAgentWorkflowStream` streams model tokens through planner.js -> onDelta,
 * not through LangGraph's graph-event `.stream()` API.
 *
 * Industrialization roadmap / extension seams:
 * - Planning accepts injectable `planRequest` and `planRequestStream` adapters
 *   (policy gateway, model router, evaluation shadow traffic, or local mock).
 * - Execution already accepts `actionExecutor`, `weatherEvaluator`, and `io`
 *   adapters (tool gateway, domain policy, and external integrations).
 * - WorkflowRun/Step/ToolCall/Event provide durable audit projections, while a
 *   JSON Checkpointer persists paused execution state by run ID. Production
 *   still needs a database saver and a lease/outbox around remote tool calls.
 * - Add retry budgets, circuit breakers, distributed tracing, tenant quotas,
 *   and compensating actions at those adapters; they do not belong in routing
 *   functions or LLM prompts.
 *
 * The current graph is deliberately compact. A stable idempotency key is sent
 * to each executor, but exactly-once side effects still require the executor
 * and persistent tool gateway to honour that key.
 */
const PlanningState = Annotation.Root({
  message: Annotation(),
  actor: Annotation(),
  history: Annotation(),
  systemMemory: Annotation(),
  fetchImpl: Annotation(),
  onDelta: Annotation(),
  // Dependency injection seam for model routing, policy, and test doubles.
  planRequest: Annotation(),
  planRequestStream: Annotation(),
  stream: Annotation(),
  result: Annotation(),
});

/**
 * LangGraph node: calls the model/planner adapter once and writes its validated
 * result into `state.result`. The adapter is selected by transport mode, while
 * optional state adapters keep production policy wrapping outside the graph.
 */
async function planNode(state) {
  const planner = state.stream
    ? state.planRequestStream || planAgentRequestStream
    : state.planRequest || planAgentRequest;
  return {
    result: await planner(state.message, state.actor, {
      history: state.history || [],
      systemMemory: state.systemMemory || "",
      fetchImpl: state.fetchImpl || fetch,
      onDelta: state.onDelta || (() => {}),
    }),
  };
}

/**
 * Conditional-edge router. It maps validated planner output to one of three
 * explicit terminal states; no tool call can occur from the planning graph.
 */
function routePlan(state) {
  if (state.result?.intent === "conversation") return "conversation";
  return state.result?.coverage?.canCover ? "command" : "rejected";
}

/** Pass-through terminal node; separate nodes make route outcomes observable. */
function finishPlanning(state) {
  return { result: state.result };
}

const planningGraph = new StateGraph(PlanningState)
  .addNode("plan", planNode)
  .addNode("conversation", finishPlanning)
  .addNode("command", finishPlanning)
  .addNode("rejected", finishPlanning)
  .addEdge(START, "plan")
  .addConditionalEdges("plan", routePlan, {
    conversation: "conversation",
    command: "command",
    rejected: "rejected",
  })
  .addEdge("conversation", END)
  .addEdge("command", END)
  .addEdge("rejected", END)
  .compile();

/**
 * Invoke the planning graph for JSON chat.
 *
 * Optional adapters are intentional expansion interfaces:
 * `planRequest(message, actor, context)` can implement model fallback, content
 * policy, prompt-version routing, tracing, or deterministic test behaviour.
 */
async function planAgentWorkflow(message, actor, options = {}) {
  const state = await planningGraph.invoke({
    message,
    actor,
    history: options.history || [],
    systemMemory: options.systemMemory || "",
    fetchImpl: options.fetchImpl,
    planRequest: options.planRequest,
    stream: false,
  });
  return state.result;
}

/**
 * Invoke the same planning graph while forwarding provider token deltas through
 * `onDelta`. `planRequestStream` is the streaming adapter extension point.
 */
async function planAgentWorkflowStream(message, actor, options = {}) {
  const state = await planningGraph.invoke({
    message,
    actor,
    history: options.history || [],
    systemMemory: options.systemMemory || "",
    fetchImpl: options.fetchImpl,
    onDelta: options.onDelta,
    planRequestStream: options.planRequestStream,
    stream: true,
  });
  return state.result;
}

const ExecutionState = Annotation.Root({
  message: Annotation(),
  run: Annotation(),
  actor: Annotation(),
  executionThreadId: Annotation(),
  nextSequence: Annotation(),
  executionSteps: Annotation(),
  failure: Annotation(),
  weatherAlertDecision: Annotation(),
  awaitingFollowupApproval: Annotation(),
  finalMessage: Annotation(),
});

// io 和可注入 adapter 可能包含函数或循环引用，不应进入 checkpoint。
// 它们只在一次 invoke/resume 期间按 thread 注入；持久状态只保存可序列化数据。
const executionRuntime = new Map();

function documentId(value) {
  return String(value?._id || value?.id || value || "");
}

async function hydrateExecutionDocuments(state) {
  const message =
    typeof state.message?.save === "function"
      ? state.message
      : await AgentMessage.findById(documentId(state.message));
  const run =
    typeof state.run?.save === "function"
      ? state.run
      : await WorkflowRun.findById(documentId(state.run));
  if (!message || !run)
    throw new Error("workflow checkpoint references missing documents");
  return { message, run };
}

function normalizeToolApprovalResponse(value) {
  if (typeof value === "string") {
    const reply = value.trim();
    if (/^(确认|同意|发布|approve|confirm)$/iu.test(reply))
      return { decision: "approve" };
    if (/^(拒绝|取消|reject|deny|cancel)$/iu.test(reply))
      return { decision: "reject" };
    if (reply) return { decision: "edit", content: reply };
  }
  if (value && typeof value === "object") {
    if (value.decision === "approve") return { decision: "approve" };
    if (value.decision === "reject")
      return {
        decision: "reject",
        reason: String(value.reason || "用户拒绝执行危险工具").slice(0, 500),
      };
    if (value.decision === "edit") {
      const content = String(value.content || "").trim();
      if (content && content.length <= 2000)
        return { decision: "edit", content };
    }
  }
  const error = new Error(
    "response must approve, reject, or provide edited content (1-2000 chars)",
  );
  error.status = 400;
  throw error;
}

function editedAction(action, response) {
  if (response.decision !== "edit") return action;
  if (action.type !== "post.publish") {
    const error = new Error(
      `tool ${action.type} does not allow argument editing`,
    );
    error.status = 400;
    throw error;
  }
  return {
    ...action,
    arguments: { ...action.arguments, content: response.content },
  };
}

/**
 * Evaluates every tool through a deterministic policy. Only approvable writes
 * reach interrupt(); hard denials can never be overridden by a human response.
 */
async function reviewToolBeforeExecution(
  state,
  message,
  run,
  step,
  durableStep,
  sequence,
) {
  const context = {
    actorId: state.actor?.id,
    runId: documentId(run),
    stepId: documentId(durableStep),
  };
  const assessment = await assessToolCall(step.action, state.actor);
  if (assessment.decision === POLICY_DECISION.DENY)
    throw policyError(assessment);
  if (assessment.decision === POLICY_DECISION.ALLOW)
    return { action: step.action, approvalGrant: null };

  const generatedPayload = approvalRequest(step.action, assessment, context);
  const persistedPayload = message.planner.execution?.interrupt;
  const payload =
    persistedPayload?.kind === "tool_approval" &&
    persistedPayload.stepId === generatedPayload.stepId &&
    persistedPayload.actionDigest === generatedPayload.actionDigest
      ? persistedPayload
      : generatedPayload;
  await requestHumanInput(run, message, payload);
  const response = normalizeToolApprovalResponse(interrupt(payload));
  if (new Date(payload.expiresAt).getTime() <= Date.now()) {
    const reason = "危险工具审批已过期，操作已安全取消";
    await rejectHumanInput(
      run,
      message,
      { decision: "reject", reason },
      payload,
    );
    await rejectStep(run, sequence, reason, "approval_expired");
    const error = new Error(reason);
    error.errorType = "approval_expired";
    throw error;
  }
  if (response.decision === "reject") {
    const reason = response.reason || "用户拒绝执行危险工具";
    await rejectHumanInput(run, message, response, payload);
    await rejectStep(run, sequence, reason, "approval_rejected");
    const error = new Error(reason);
    error.errorType = "approval_rejected";
    throw error;
  }

  const action = editedAction(step.action, response);
  const editedAssessment = await assessToolCall(action, state.actor);
  if (editedAssessment.decision === POLICY_DECISION.DENY)
    throw policyError(editedAssessment);
  const approvalGrant = issueApprovalGrant(action, context);
  await acceptHumanInput(run, message, response, {
    ...payload,
    actionType: action.type,
    actionDigest: approvalGrant.actionDigest,
  });
  if (response.decision !== "edit") return { action, approvalGrant };

  step.action = {
    ...action,
  };
  await updateStepAction(run, sequence, step.action);
  if (typeof message.markModified === "function")
    message.markModified("planner.todo");
  await message.save();
  return { action, approvalGrant };
}

/**
 * Finds the next unexecuted Todo sequence for resumable workflow execution.
 * The durable WorkflowStep is the source of audit history; this message-level
 * projection lets the graph re-enter after a retry without replaying successes.
 */
function nextPendingSequence(state) {
  const todo = state.message.planner.todo || [];
  const startAt = Number.isInteger(state.nextSequence) ? state.nextSequence : 0;
  for (let sequence = startAt; sequence < todo.length; sequence += 1) {
    if (todo[sequence].status !== "executed") return sequence;
  }
  return null;
}

/** Upserts a step projection stored on the Agent message execution summary. */
function replaceExecutionStep(steps, next) {
  const byId = new Map((steps || []).map((step) => [step.id, step]));
  byId.set(next.id, next);
  return [...byId.values()];
}

/** Guards the weather-result decision stage so it runs once for conditional alert requests. */
function shouldEvaluateWeatherAlert(state, step) {
  return (
    step.action.type === "mcp.weather.forecast" &&
    state.message.planner.weatherAlert?.evaluateForPost === true &&
    !state.message.planner.weatherAlert?.decision
  );
}

/**
 * Converts a completed weather query into one LLM decision and optionally appends a post approval step.
 * Feature: conditional severe-weather alert publishing.
 */
async function evaluateWeatherAlertPost(state, step, result, weatherEvaluator) {
  if (!shouldEvaluateWeatherAlert(state, step, result)) return {};

  const evaluator = weatherEvaluator || evaluateWeatherAlert;
  const decision = await evaluator(result);
  const weatherAlert = state.message.planner.weatherAlert;
  weatherAlert.sourceStepId = step.id;
  weatherAlert.decision = decision;
  if (!decision.shouldPublish)
    return { weatherAlertDecision: decision, awaitingFollowupApproval: false };

  const content = formatWeatherAlertPost(decision.post);
  const title = `发布天气预警：${decision.post.title}`;
  const persistedStep = await appendConditionalPostStep(state.run, {
    title,
    content,
  });
  state.message.planner.todo.push({
    id: `weather-alert-${persistedStep.id}`,
    title,
    action: { type: "post.publish", arguments: { content } },
    status: "planned",
    rejectionReason: null,
    requiresConfirmation: true,
  });
  state.message.planner.requiresConfirmation = true;
  weatherAlert.followUpApproval = {
    requestedAt: new Date(),
    reason: decision.reason,
  };
  return { weatherAlertDecision: decision, awaitingFollowupApproval: true };
}

/**
 * LangGraph node that executes exactly one persisted Todo.
 *
 * Ordering is deliberate: `startStep` creates durable "running" evidence,
 * then the executor is called with a stable idempotency key, then `completeStep`
 * records the outcome. An industrial implementation should make this sequence
 * transactional/leased and use an outbox or durable checkpointer for process
 * crashes between external side effect and result persistence.
 */
async function executeStepNode(state) {
  const { message, run } = await hydrateExecutionDocuments(state);
  const liveState = { ...state, message, run };
  const runtime = executionRuntime.get(state.executionThreadId) || {};
  const sequence = nextPendingSequence(liveState);
  if (sequence === null) return { nextSequence: null };

  const step = message.planner.todo[sequence];
  let persisted;
  try {
    const durableStep = await getWorkflowStep(run, sequence);
    const authorization = await reviewToolBeforeExecution(
      liveState,
      message,
      run,
      step,
      durableStep,
      sequence,
    );
    await authorizeToolExecution(authorization.action, state.actor, {
      runId: documentId(run),
      stepId: documentId(durableStep),
      approvalGrant: authorization.approvalGrant,
    });
    persisted = await startStep(run, sequence);
    const executor = runtime.actionExecutor || executeAgentAction;
    const result = await executor(authorization.action, state.actor, {
      io: runtime.io,
      idempotencyKey: `${run.id}:${persisted.step.id}`,
      runId: documentId(run),
      stepId: documentId(persisted.step),
      approvalGrant: authorization.approvalGrant,
    });
    step.status = "executed";
    await completeStep(run, persisted.step, persisted.toolCall, result);
    const weatherAlertUpdate = await evaluateWeatherAlertPost(
      liveState,
      step,
      result,
      runtime.weatherEvaluator,
    );
    return {
      nextSequence: sequence + 1,
      executionSteps: replaceExecutionStep(state.executionSteps, {
        id: step.id,
        status: "executed",
        result,
      }),
      failure: null,
      ...weatherAlertUpdate,
    };
  } catch (error) {
    // interrupt() 通过 GraphInterrupt 控制流暂停；不能把它记录成工具失败。
    if (isGraphInterrupt(error)) throw error;
    const errorType = error.errorType || classifyError(error.message);
    const rejected = [
      "approval_expired",
      "approval_rejected",
      "policy_denied",
    ].includes(errorType);
    step.status = rejected ? "rejected" : "failed";
    if (rejected) {
      step.rejectionReason = error.message;
      await rejectStep(run, sequence, error.message, errorType);
      await rejectRun(run, error.message, errorType);
    }
    if (persisted)
      await completeStep(
        run,
        persisted.step,
        persisted.toolCall,
        null,
        error,
        errorType,
      );
    return {
      nextSequence: sequence + 1,
      executionSteps: replaceExecutionStep(state.executionSteps, {
        id: step.id,
        status: rejected ? "rejected" : "failed",
        error: error.message,
        errorType,
      }),
      failure: { sequence, error: error.message, errorType, rejected },
    };
  }
}

/**
 * Conditional loop router. Returning `execute_step` re-enters the same node;
 * returning `finalize` makes failure and follow-up approval explicit terminal
 * branches rather than allowing a later Todo to run accidentally.
 */
function routeExecution(state) {
  if (
    state.failure ||
    state.awaitingFollowupApproval ||
    nextPendingSequence(state) === null
  )
    return "finalize";
  return "execute_step";
}

/**
 * Persists terminal state, or pauses at a newly created approval gate.
 * A production version would additionally emit an outbox/domain event here so
 * notifications cannot be lost if the HTTP response process exits afterward.
 */
async function finalizeExecutionNode(state) {
  const { message, run } = await hydrateExecutionDocuments(state);
  if (state.awaitingFollowupApproval) {
    message.planner.approvalStatus = "pending";
    message.planner.execution = {
      status: "awaiting_approval",
      steps: state.executionSteps || [],
      completedAt: new Date(),
    };
    if (typeof message.markModified === "function")
      message.markModified("planner");
    await message.save();
    return { finalMessage: message };
  }
  const rejected = Boolean(state.failure?.rejected);
  const failed = Boolean(state.failure) && !rejected;
  message.planner.approvalStatus = rejected
    ? "rejected"
    : failed
      ? "failed"
      : "executed";
  message.planner.execution = {
    status: rejected ? "rejected" : failed ? "failed" : "executed",
    steps: state.executionSteps || [],
    completedAt: new Date(),
  };
  if (rejected)
    await rejectRun(run, state.failure.error, state.failure.errorType);
  else await finishRun(run, failed);
  if (typeof message.markModified === "function")
    message.markModified("planner");
  await message.save();
  return { finalMessage: message };
}

const executionGraph = new StateGraph(ExecutionState)
  .addNode("execute_step", executeStepNode)
  .addNode("finalize", finalizeExecutionNode)
  .addEdge(START, "execute_step")
  .addConditionalEdges("execute_step", routeExecution, {
    execute_step: "execute_step",
    finalize: "finalize",
  })
  .addEdge("finalize", END)
  .compile({ checkpointer: workflowCheckpointer });

async function invokeExecutionGraphUnlocked(input, command) {
  const threadId = input?.executionThreadId;
  const config = { configurable: { thread_id: threadId } };
  const state = await executionGraph.invoke(command || input, config);
  const pendingInterrupt = state.__interrupt__?.[0] || null;
  const message =
    state.finalMessage ||
    (await AgentMessage.findById(documentId(input.message)));
  if (!pendingInterrupt) await workflowCheckpointer.deleteThread(threadId);
  return { message, interrupt: pendingInterrupt };
}

async function invokeExecutionGraph(input, command, runtime) {
  const threadId = input?.executionThreadId;
  executionRuntime.set(threadId, runtime);
  try {
    return await workflowCheckpointer.withThreadLock(
      `execution:${threadId}`,
      () => invokeExecutionGraphUnlocked(input, command),
    );
  } finally {
    executionRuntime.delete(threadId);
  }
}

/**
 * Invoke the side-effecting graph only after route-level approval checks.
 *
 * `actionExecutor`, `weatherEvaluator`, and `io` are dependency-injection
 * seams. They allow a production tool gateway (RBAC, timeout/retry, tracing,
 * idempotency) or a test double without coupling LangGraph nodes to providers.
 */
async function executeApprovedAgentWorkflow({
  message,
  run,
  actor,
  io,
  weatherEvaluator,
  actionExecutor,
}) {
  const executionThreadId = workflowThreadId(run.id, actor.id);
  return invokeExecutionGraph(
    {
      message,
      run,
      actor,
      executionThreadId,
      nextSequence: 0,
      executionSteps: message.planner.execution?.steps || [],
      failure: null,
      awaitingFollowupApproval: false,
    },
    null,
    { io, weatherEvaluator, actionExecutor },
  );
}

/** 使用 Command(resume) 将用户回复送回被 interrupt 暂停的执行节点。 */
async function resumeAgentWorkflow({
  message,
  run,
  actor,
  response,
  interruptId,
  io,
  weatherEvaluator,
  actionExecutor,
}) {
  const executionThreadId = workflowThreadId(run.id, actor.id);
  const config = { configurable: { thread_id: executionThreadId } };
  const normalized = normalizeToolApprovalResponse(response);
  executionRuntime.set(executionThreadId, {
    io,
    weatherEvaluator,
    actionExecutor,
  });
  try {
    return await workflowCheckpointer.withThreadLock(
      `execution:${executionThreadId}`,
      async () => {
        const snapshot = await executionGraph.getState(config);
        const pendingInterrupt = snapshot.tasks
          ?.flatMap((task) => task.interrupts || [])
          .at(0);
        if (!pendingInterrupt) {
          const error = new Error("workflow has no pending interrupt");
          error.status = 409;
          throw error;
        }
        if (interruptId && interruptId !== pendingInterrupt.id) {
          const error = new Error("workflow interrupt is stale");
          error.status = 409;
          throw error;
        }
        return invokeExecutionGraphUnlocked(
          { message, run, actor, executionThreadId },
          new Command({ resume: normalized }),
        );
      },
    );
  } finally {
    executionRuntime.delete(executionThreadId);
  }
}

module.exports = {
  executeApprovedAgentWorkflow,
  normalizePostReviewResponse: normalizeToolApprovalResponse,
  normalizeToolApprovalResponse,
  planAgentWorkflow,
  planAgentWorkflowStream,
  resumeAgentWorkflow,
};

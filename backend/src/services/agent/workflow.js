const { Annotation, END, START, StateGraph } = require("@langchain/langgraph");

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
  completeStep,
  finishRun,
  startStep,
} = require("../workflow/state");

const PlanningState = Annotation.Root({
  message: Annotation(),
  actor: Annotation(),
  history: Annotation(),
  fetchImpl: Annotation(),
  onDelta: Annotation(),
  stream: Annotation(),
  result: Annotation(),
});

/** LangGraph node that runs the selected streaming or non-streaming planner. Feature: Agent planning graph. */
async function planNode(state) {
  const planner = state.stream ? planAgentRequestStream : planAgentRequest;
  return {
    result: await planner(state.message, state.actor, {
      history: state.history || [],
      fetchImpl: state.fetchImpl || fetch,
      onDelta: state.onDelta || (() => {}),
    }),
  };
}

/** Selects the terminal planning branch: conversation, executable command, or rejected plan. */
function routePlan(state) {
  if (state.result?.intent === "conversation") return "conversation";
  return state.result?.coverage?.canCover ? "command" : "rejected";
}

/** Pass-through terminal node that exposes the validated planning result to the API layer. */
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

/** Invokes LangGraph's non-streaming planning graph. Feature: Agent chat command planning. */
async function planAgentWorkflow(message, actor, options = {}) {
  const state = await planningGraph.invoke({
    message,
    actor,
    history: options.history || [],
    fetchImpl: options.fetchImpl,
    stream: false,
  });
  return state.result;
}

/** Invokes LangGraph's streaming planning graph. Feature: SSE Agent chat. */
async function planAgentWorkflowStream(message, actor, options = {}) {
  const state = await planningGraph.invoke({
    message,
    actor,
    history: options.history || [],
    fetchImpl: options.fetchImpl,
    onDelta: options.onDelta,
    stream: true,
  });
  return state.result;
}

const ExecutionState = Annotation.Root({
  message: Annotation(),
  run: Annotation(),
  actor: Annotation(),
  io: Annotation(),
  nextSequence: Annotation(),
  executionSteps: Annotation(),
  failure: Annotation(),
  weatherAlertDecision: Annotation(),
  awaitingFollowupApproval: Annotation(),
  weatherEvaluator: Annotation(),
  actionExecutor: Annotation(),
  finalMessage: Annotation(),
});

/** Finds the next unexecuted Todo sequence for resumable workflow execution. */
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
async function evaluateWeatherAlertPost(state, step, result) {
  if (!shouldEvaluateWeatherAlert(state, step, result)) return {};

  const evaluator = state.weatherEvaluator || evaluateWeatherAlert;
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
 * Executes one persisted Todo, records its ToolCall result, and updates LangGraph execution state.
 * Feature: approval-gated Agent workflow execution.
 */
async function executeStepNode(state) {
  const sequence = nextPendingSequence(state);
  if (sequence === null) return { nextSequence: null };

  const step = state.message.planner.todo[sequence];
  let persisted;
  try {
    persisted = await startStep(state.run, sequence);
    const executor = state.actionExecutor || executeAgentAction;
    const result = await executor(step.action, state.actor, {
      io: state.io,
      idempotencyKey: `${state.run.id}:${persisted.step.id}`,
    });
    step.status = "executed";
    await completeStep(state.run, persisted.step, persisted.toolCall, result);
    const weatherAlertUpdate = await evaluateWeatherAlertPost(
      state,
      step,
      result,
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
    const errorType = classifyError(error.message);
    step.status = "failed";
    if (persisted)
      await completeStep(
        state.run,
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
        status: "failed",
        error: error.message,
        errorType,
      }),
      failure: { sequence, error: error.message, errorType },
    };
  }
}

/** Routes execution to the next Todo or finalization after failure, completion, or a new approval gate. */
function routeExecution(state) {
  if (
    state.failure ||
    state.awaitingFollowupApproval ||
    nextPendingSequence(state) === null
  )
    return "finalize";
  return "execute_step";
}

/** Persists the workflow terminal state, or pauses it when a generated post needs second approval. */
async function finalizeExecutionNode(state) {
  if (state.awaitingFollowupApproval) {
    state.message.planner.approvalStatus = "pending";
    state.message.planner.execution = {
      status: "awaiting_approval",
      steps: state.executionSteps || [],
      completedAt: new Date(),
    };
    if (typeof state.message.markModified === "function")
      state.message.markModified("planner");
    await state.message.save();
    return { finalMessage: state.message };
  }
  const failed = Boolean(state.failure);
  state.message.planner.approvalStatus = failed ? "failed" : "executed";
  state.message.planner.execution = {
    status: failed ? "failed" : "executed",
    steps: state.executionSteps || [],
    completedAt: new Date(),
  };
  await finishRun(state.run, failed);
  if (typeof state.message.markModified === "function")
    state.message.markModified("planner");
  await state.message.save();
  return { finalMessage: state.message };
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
  .compile();

/** Invokes LangGraph's execution graph after the owner approves a workflow run. Feature: Agent action execution. */
async function executeApprovedAgentWorkflow({
  message,
  run,
  actor,
  io,
  weatherEvaluator,
  actionExecutor,
}) {
  const state = await executionGraph.invoke({
    message,
    run,
    actor,
    io,
    nextSequence: 0,
    executionSteps: message.planner.execution?.steps || [],
    failure: null,
    awaitingFollowupApproval: false,
    weatherEvaluator,
    actionExecutor,
  });
  return state.finalMessage;
}

module.exports = {
  executeApprovedAgentWorkflow,
  planAgentWorkflow,
  planAgentWorkflowStream,
};

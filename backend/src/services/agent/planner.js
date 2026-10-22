const { getAgentPrompts } = require("../promptRegistry");
const { getActionRoute, isActionEnabled } = require("../../config/mcp");

/** Returns UI-safe capability metadata for the Agent capability-overview feature. */
async function describeActions() {
  const { capabilities } = await getAgentPrompts();
  return capabilities.map(
    ({ action, title, description, requiredRole, requiresConfirmation }) => ({
      action,
      title,
      description,
      requiredRole: requiredRole || null,
      requiresConfirmation: Boolean(requiresConfirmation),
    }),
  );
}

/** Builds the no-input response used by the Agent chat onboarding feature. */
async function welcomeResponse(actor) {
  const { capabilities } = await getAgentPrompts();
  return {
    reply: `你好${actor?.name ? `，${actor.name}` : ""}。我可以直接回答问题；涉及系统操作时会先生成可审批的 Todo。`,
    intent: "conversation",
    todo: [],
    coverage: {
      canCover: true,
      reason: "等待具体任务后进行覆盖分析。",
      unsupported: [],
    },
    capabilities: capabilities.map(
      ({ action, title, description, requiredRole, requiresConfirmation }) => ({
        id: action,
        title,
        description,
        requiredRole: requiredRole || null,
        requiresConfirmation: Boolean(requiresConfirmation),
      }),
    ),
    requiresConfirmation: false,
    mode: "capability-overview",
  };
}

/** Composes the constrained planner prompt for the LLM planning feature. */
function buildSystemPrompt(config, actor) {
  return `${config.systemPrompt}\n\n## Runtime capability manifest\n${JSON.stringify(config.capabilities)}\n\n## Tool contract\n${config.toolsMarkdown}\n\n## Action protocol\n${config.protocolMarkdown}\n\nActor role: ${actor?.role || "user"}. Return JSON only.`;
}

/** Parses an LLM JSON response, accepting optional Markdown fences for provider compatibility. */
function parseModelJson(content) {
  const text = typeof content === "string" ? content.trim() : "";
  return JSON.parse(
    text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
  );
}

/** Creates the OpenAI-compatible request body for the Agent planning feature. */
function modelRequestBody(
  config,
  actor,
  history,
  input,
  stream = false,
  systemMemory = "",
) {
  const body = {
    model: process.env.LLM_MODEL,
    temperature: 0.1,
    stream,
    messages: [
      { role: "system", content: buildSystemPrompt(config, actor) },
      ...(systemMemory
        ? [{ role: "system", content: String(systemMemory).slice(0, 8000) }]
        : []),
      ...sanitizeHistory(history),
      { role: "user", content: input },
    ],
  };
  if (stream && process.env.LLM_STREAM_INCLUDE_USAGE === "true")
    body.stream_options = { include_usage: true };
  if (process.env.LLM_STRUCTURED_OUTPUTS === "true")
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "agent_plan",
        strict: true,
        schema: config.protocolSchema,
      },
    };
  return body;
}

/** Normalizes token counters returned by OpenAI-compatible providers. */
function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens);
  const completionTokens = Number(
    usage.completion_tokens ?? usage.output_tokens,
  );
  const totalTokens = Number(
    usage.total_tokens ??
      (Number.isFinite(promptTokens) && Number.isFinite(completionTokens)
        ? promptTokens + completionTokens
        : NaN),
  );
  if (![promptTokens, completionTokens, totalTokens].every(Number.isFinite))
    return null;
  return { promptTokens, completionTokens, totalTokens };
}

/** Extracts the completed reply prefix from streamed plan JSON for the SSE chat feature. */
function replyFromPartialJson(text) {
  const match = /"reply"\s*:\s*"/.exec(text);
  if (!match) return "";
  let value = "";
  let escaped = false;
  for (
    let index = match.index + match[0].length;
    index < text.length;
    index += 1
  ) {
    const char = text[index];
    if (!escaped && char === '"') break;
    if (!escaped && char === "\\") {
      escaped = true;
      value += char;
      continue;
    }
    escaped = false;
    value += char;
  }
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/** Converts JSON Schema errors into a diagnosable planner-contract error. */
function validationError(errors) {
  return new Error(
    `LLM plan violates JSON Action protocol: ${(errors || []).map((item) => `${item.instancePath || "/"} ${item.message}`).join("; ")}`,
  );
}

/**
 * Validates an LLM plan against JSON Schema, capability allowlists and RBAC.
 * Feature: safe, approval-gated Agent action planning.
 */
function validatePlan(candidate, actor, config) {
  if (!config.validatePlan(candidate))
    throw validationError(config.validatePlan.errors);
  if (candidate.intent === "conversation") {
    console.log(
      "Agent response JSON parsing and Todo validation has been finished.",
    );
    return {
      reply: candidate.reply,
      intent: "conversation",
      todo: [],
      coverage: {
        canCover: true,
        reason: candidate.coverage.reason,
        unsupported: [],
      },
      weatherAlert: { evaluateForPost: false },
      requiresConfirmation: false,
      mode: "llm-conversation",
    };
  }
  const rejections = [];
  const weatherAlert = {
    evaluateForPost: Boolean(candidate.weatherAlert?.evaluateForPost),
  };
  const todo = candidate.todo.map((item) => {
    const capability = config.capabilityByAction.get(item.action.type);
    let rejectionReason = "";
    if (!capability) rejectionReason = `未知 action：${item.action.type}`;
    else if (!capability.validateArguments(item.action.arguments))
      rejectionReason = `action 参数不符合 Schema：${capability.action}`;
    else if (capability.requiredRole && capability.requiredRole !== actor?.role)
      rejectionReason = `action ${capability.action} 需要 ${capability.requiredRole} 权限`;
    else if (
      getActionRoute(item.action.type) &&
      !isActionEnabled(item.action.type)
    )
      rejectionReason = `外部 MCP 工具尚未配置：${item.action.type}`;
    if (rejectionReason) rejections.push(`${item.title}（${rejectionReason}）`);
    return {
      id: item.id,
      title: item.title,
      action: item.action,
      status: rejectionReason ? "rejected" : "planned",
      rejectionReason: rejectionReason || null,
      requiresConfirmation: Boolean(capability?.requiresConfirmation),
    };
  });
  const unsupported = [
    ...new Set([...candidate.coverage.unsupported, ...rejections]),
  ];
  const canCover =
    Boolean(candidate.coverage.canCover) && unsupported.length === 0;
  console.log(
    "Agent response JSON parsing and Todo validation has been finished.",
  );
  return {
    reply: candidate.reply,
    intent: "command",
    todo,
    coverage: { canCover, reason: candidate.coverage.reason, unsupported },
    weatherAlert,
    requiresConfirmation: todo.some(
      (item) => item.requiresConfirmation && item.status === "planned",
    ),
    mode: "llm-plan",
  };
}

/** Bounds persisted conversation history before it enters the planner context window. */
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.flatMap((item) => {
    if (
      !item ||
      !["user", "assistant"].includes(item.role) ||
      typeof item.content !== "string"
    )
      return [];
    return [{ role: item.role, content: item.content.slice(0, 4000) }];
  });
}

/**
 * Calls the model once and returns a validated non-streaming plan or conversation reply.
 * Feature: standard Agent chat planning.
 */
async function planAgentRequest(
  message,
  actor,
  { fetchImpl = fetch, history = [], systemMemory = "" } = {},
) {
  const input =
    typeof message === "string" ? message.trim().slice(0, 2000) : "";
  if (!input) return welcomeResponse(actor);
  const url = process.env.LLM_API_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!url || !apiKey || !model)
    return {
      reply: "远程 LLM 尚未配置，无法分析这条请求。",
      intent: "command",
      todo: [],
      coverage: {
        canCover: false,
        reason: "LLM provider is not configured.",
        unsupported: ["远程规划模型未配置"],
      },
      requiresConfirmation: false,
      mode: "unconfigured",
    };

  const config = await getAgentPrompts();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.LLM_TIMEOUT_MS) || 15000,
  );
  try {
    const body = modelRequestBody(
      config,
      actor,
      history,
      input,
      false,
      systemMemory,
    );
    console.log("Agent LLM request assembly has been finished.");
    const response = await fetchImpl(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`LLM API returned ${response.status}`);
    const payload = await response.json();
    return {
      ...validatePlan(
        parseModelJson(payload?.choices?.[0]?.message?.content),
        actor,
        config,
      ),
      usage: normalizeUsage(payload?.usage),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Streams reply text to SSE while retaining the final JSON plan for validation.
 * Feature: streaming Agent chat planning.
 */
async function planAgentRequestStream(
  message,
  actor,
  {
    fetchImpl = fetch,
    history = [],
    systemMemory = "",
    onDelta = () => {},
  } = {},
) {
  const input =
    typeof message === "string" ? message.trim().slice(0, 2000) : "";
  if (!input) return welcomeResponse(actor);
  const url = process.env.LLM_API_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!url || !apiKey || !model)
    return planAgentRequest(input, actor, {
      fetchImpl,
      history,
      systemMemory,
    });
  const config = await getAgentPrompts();
  const body = modelRequestBody(
    config,
    actor,
    history,
    input,
    true,
    systemMemory,
  );
  console.log("Agent LLM request assembly has been finished.");
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body)
    throw new Error(`LLM streaming API returned ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let emitted = "";
  let usage = null;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const event = JSON.parse(payload);
      usage = normalizeUsage(event?.usage) || usage;
      const delta = event?.choices?.[0]?.delta?.content || "";
      content += delta;
      const reply = replyFromPartialJson(content);
      if (reply.length > emitted.length) {
        onDelta(reply.slice(emitted.length));
        emitted = reply;
      }
    }
    if (done) break;
  }
  return {
    ...validatePlan(parseModelJson(content), actor, config),
    usage,
  };
}

/**
 * Revalidates an approved action and routes it to an internal Tool or MCP adapter.
 * Feature: safe execution boundary for Agent workflows.
 */
async function executeAgentAction(action, actor, context = {}) {
  // The executor is a second policy enforcement point. Graph approval UX is
  // never treated as authorization by itself.
  await require("./toolPolicy").authorizeToolExecution(action, actor, context);
  return getActionRoute(action.type)
    ? require("./tools/mcp").executeActions(action, actor, context)
    : require("./tools/local").execute(action, actor, context);
}
module.exports = {
  describeActions,
  welcomeResponse,
  planAgentRequest,
  planAgentRequestStream,
  executeAgentAction,
  normalizeUsage,
};

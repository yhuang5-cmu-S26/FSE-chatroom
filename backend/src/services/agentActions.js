const { getAgentPrompts } = require("./promptRegistry");

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

function buildSystemPrompt(config, actor) {
  return `${config.systemPrompt}\n\n## Runtime capability manifest\n${JSON.stringify(config.capabilities)}\n\n## Tool contract\n${config.toolsMarkdown}\n\n## Action protocol\n${config.protocolMarkdown}\n\nActor role: ${actor?.role || "user"}. Return JSON only.`;
}

function parseModelJson(content) {
  const text = typeof content === "string" ? content.trim() : "";
  return JSON.parse(
    text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
  );
}

function validationError(errors) {
  return new Error(
    `LLM plan violates JSON Action protocol: ${(errors || []).map((item) => `${item.instancePath || "/"} ${item.message}`).join("; ")}`,
  );
}

function validatePlan(candidate, actor, config) {
  if (!config.validatePlan(candidate))
    throw validationError(config.validatePlan.errors);
  if (candidate.intent === "conversation") {
    return {
      reply: candidate.reply,
      intent: "conversation",
      todo: [],
      coverage: {
        canCover: true,
        reason: candidate.coverage.reason,
        unsupported: [],
      },
      requiresConfirmation: false,
      mode: "llm-conversation",
    };
  }
  const rejections = [];
  const todo = candidate.todo.map((item) => {
    const capability = config.capabilityByAction.get(item.action.type);
    let rejectionReason = "";
    if (!capability) rejectionReason = `未知 action：${item.action.type}`;
    else if (!capability.validateArguments(item.action.arguments))
      rejectionReason = `action 参数不符合 Schema：${capability.action}`;
    else if (capability.requiredRole && capability.requiredRole !== actor?.role)
      rejectionReason = `action ${capability.action} 需要 ${capability.requiredRole} 权限`;
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
  return {
    reply: candidate.reply,
    intent: "command",
    todo,
    coverage: { canCover, reason: candidate.coverage.reason, unsupported },
    requiresConfirmation: todo.some(
      (item) => item.requiresConfirmation && item.status === "planned",
    ),
    mode: "llm-plan",
  };
}

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

async function planAgentRequest(
  message,
  actor,
  { fetchImpl = fetch, history = [] } = {},
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
    const body = {
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: buildSystemPrompt(config, actor) },
        ...sanitizeHistory(history),
        { role: "user", content: input },
      ],
    };
    if (process.env.LLM_STRUCTURED_OUTPUTS === "true")
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "agent_plan",
          strict: true,
          schema: config.protocolSchema,
        },
      };
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
    return validatePlan(
      parseModelJson(payload?.choices?.[0]?.message?.content),
      actor,
      config,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function executeAgentAction(action, actor, context = {}) {
  const { capabilityByAction } = await getAgentPrompts();
  const capability = capabilityByAction.get(action?.type);
  if (!capability) throw new Error(`unknown action: ${action?.type}`);
  if (!capability.validateArguments(action.arguments))
    throw new Error(`invalid action arguments: ${action.type}`);
  if (capability.requiredRole && capability.requiredRole !== actor?.role)
    throw new Error(`forbidden action: ${action.type}`);
  return require("./agentTools").execute(action, actor, context);
}
module.exports = {
  describeActions,
  welcomeResponse,
  planAgentRequest,
  executeAgentAction,
};

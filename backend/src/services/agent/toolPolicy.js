const { createHash } = require("node:crypto");
const { getAgentPrompts } = require("../promptRegistry");

const POLICY_DECISION = Object.freeze({
  ALLOW: "allow",
  REQUIRE_APPROVAL: "require_approval",
  DENY: "deny",
});

const APPROVAL_TTL_MS = Math.max(
  60_000,
  Number(process.env.AGENT_TOOL_APPROVAL_TTL_MS) || 10 * 60_000,
);
const GRANT_TTL_MS = 60_000;
const issuedGrants = new WeakSet();

/** Stable JSON makes an approval bind to the exact tool arguments, not object key order. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  return value;
}

function actionDigest(action, { actorId, runId, stepId } = {}) {
  const subject = canonicalize({
    version: 1,
    actorId: String(actorId || ""),
    runId: String(runId || ""),
    stepId: String(stepId || ""),
    action,
  });
  return createHash("sha256").update(JSON.stringify(subject)).digest("hex");
}

function deny(code, reason) {
  return {
    decision: POLICY_DECISION.DENY,
    riskLevel: "blocked",
    code,
    reason,
    allowedDecisions: [],
  };
}

/**
 * Deterministic policy-as-code boundary. The model and the browser cannot lower
 * risk: schema, RBAC and effect metadata are loaded from the server registry.
 */
async function assessToolCall(action, actor) {
  const { capabilityByAction, toolByAction } = await getAgentPrompts();
  const capability = capabilityByAction.get(action?.type);
  const tool = toolByAction.get(action?.type);
  if (!capability || !tool)
    return deny("unknown_tool", `unknown action: ${action?.type || "<empty>"}`);
  if (!capability.validateArguments(action?.arguments))
    return deny(
      "invalid_arguments",
      `invalid action arguments: ${action.type}`,
    );
  if (capability.requiredRole && capability.requiredRole !== actor?.role)
    return deny(
      "forbidden",
      `forbidden action: ${action.type}; requires role ${capability.requiredRole}`,
    );

  if (tool.effect === "read")
    return {
      decision: POLICY_DECISION.ALLOW,
      riskLevel: "low",
      code: "read_only",
      reason: "只读工具且参数、权限均通过服务端校验",
      allowedDecisions: [],
    };

  if (tool.effect === "write" && capability.requiresConfirmation)
    return {
      decision: POLICY_DECISION.REQUIRE_APPROVAL,
      riskLevel: "high",
      code: "external_side_effect",
      reason: "该操作会写入业务数据或产生外部可见副作用",
      allowedDecisions:
        action.type === "post.publish"
          ? ["approve", "edit", "reject"]
          : ["approve", "reject"],
    };

  return deny(
    "unsafe_policy",
    `tool ${action.type} has no safe executable policy`,
  );
}

function policyError(assessment, errorType = "policy_denied") {
  const error = new Error(assessment.reason);
  error.status = 403;
  error.code = assessment.code;
  error.errorType = errorType;
  return error;
}

function approvalRequest(action, assessment, context) {
  const requestedAt = new Date();
  return {
    kind: "tool_approval",
    policyVersion: 1,
    runId: String(context.runId),
    stepId: String(context.stepId),
    actionType: action.type,
    arguments: canonicalize(action.arguments),
    actionDigest: actionDigest(action, context),
    riskLevel: assessment.riskLevel,
    reason: assessment.reason,
    question: `危险工具 ${action.type} 即将执行，请核对完整参数后批准、修改或拒绝。`,
    draft:
      action.type === "post.publish" ? action.arguments.content : undefined,
    allowedResponses: assessment.allowedDecisions,
    requestedAt: requestedAt.toISOString(),
    expiresAt: new Date(requestedAt.getTime() + APPROVAL_TTL_MS).toISOString(),
  };
}

function issueApprovalGrant(action, context) {
  const grant = Object.freeze({
    decision: "approved",
    actorId: String(context.actorId),
    runId: String(context.runId),
    stepId: String(context.stepId),
    actionDigest: actionDigest(action, context),
    expiresAt: new Date(Date.now() + GRANT_TTL_MS).toISOString(),
  });
  issuedGrants.add(grant);
  return grant;
}

/** Re-checks policy immediately before dispatch, closing edit and TOCTOU bypasses. */
async function authorizeToolExecution(action, actor, context = {}) {
  const assessment = await assessToolCall(action, actor);
  if (assessment.decision === POLICY_DECISION.DENY)
    throw policyError(assessment);
  if (assessment.decision === POLICY_DECISION.ALLOW) return assessment;

  const grant = context.approvalGrant;
  const expectedDigest = actionDigest(action, {
    actorId: actor?.id,
    runId: context.runId,
    stepId: context.stepId,
  });
  const valid =
    grant &&
    issuedGrants.has(grant) &&
    grant.decision === "approved" &&
    grant.actorId === String(actor?.id || "") &&
    grant.runId === String(context.runId || "") &&
    grant.stepId === String(context.stepId || "") &&
    grant.actionDigest === expectedDigest &&
    new Date(grant.expiresAt).getTime() > Date.now();
  if (!valid)
    throw policyError(
      deny(
        "approval_missing_or_stale",
        `tool ${action.type} requires a current approval for these exact arguments`,
      ),
    );
  return assessment;
}

module.exports = {
  POLICY_DECISION,
  actionDigest,
  approvalRequest,
  assessToolCall,
  authorizeToolExecution,
  issueApprovalGrant,
  policyError,
};

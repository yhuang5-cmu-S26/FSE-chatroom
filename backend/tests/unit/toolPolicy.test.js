const test = require("node:test");
const assert = require("node:assert/strict");

const {
  POLICY_DECISION,
  assessToolCall,
  authorizeToolExecution,
  issueApprovalGrant,
} = require("../../src/services/agent/toolPolicy");

const admin = { id: "admin-policy", role: "admin" };
const context = { actorId: admin.id, runId: "run-1", stepId: "step-1" };

test("policy auto-allows validated reads but never lets a human override RBAC", async () => {
  const read = await assessToolCall(
    { type: "post.draft", arguments: { topic: "演练通知" } },
    { id: "user-1", role: "user" },
  );
  assert.equal(read.decision, POLICY_DECISION.ALLOW);

  const forbidden = await assessToolCall(
    { type: "post.publish", arguments: { content: "公告" } },
    { id: "user-1", role: "user" },
  );
  assert.equal(forbidden.decision, POLICY_DECISION.DENY);
  assert.equal(forbidden.code, "forbidden");
});

test("write authorization is bound to the exact actor, run, step and arguments", async () => {
  const approvedAction = {
    type: "post.publish",
    arguments: { content: "在南门集合" },
  };
  const grant = issueApprovalGrant(approvedAction, context);
  await authorizeToolExecution(approvedAction, admin, {
    runId: context.runId,
    stepId: context.stepId,
    approvalGrant: grant,
  });

  await assert.rejects(
    authorizeToolExecution(
      { ...approvedAction, arguments: { content: "篡改为北门集合" } },
      admin,
      {
        runId: context.runId,
        stepId: context.stepId,
        approvalGrant: grant,
      },
    ),
    /requires a current approval for these exact arguments/,
  );
  await assert.rejects(
    authorizeToolExecution(approvedAction, admin, {
      runId: "another-run",
      stepId: context.stepId,
      approvalGrant: grant,
    }),
    /requires a current approval/,
  );
});

test("write tools cannot be dispatched without a server-issued approval grant", async () => {
  await assert.rejects(
    authorizeToolExecution(
      { type: "post.publish", arguments: { content: "未经审批" } },
      admin,
      { runId: "run-1", stepId: "step-1" },
    ),
    /requires a current approval/,
  );
});

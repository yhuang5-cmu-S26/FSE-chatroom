const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "human-interrupt-"));
process.env.DB_DRIVER = "json";
process.env.WORKFLOW_DATA_DIR = dataDir;
process.env.AGENT_SESSION_DATA_DIR = dataDir;

const AgentMessage = require("../../src/models/AgentMessage");
const WorkflowRun = require("../../src/models/WorkflowRun");
const WorkflowStep = require("../../src/models/WorkflowStep");
const WorkflowEvent = require("../../src/models/WorkflowEvent");
const Approval = require("../../src/models/Approval");
const { createRun } = require("../../src/services/workflow/state");
const {
  executeApprovedAgentWorkflow,
  resumeAgentWorkflow,
} = require("../../src/services/agent/workflow");

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test("post publishing interrupts for human editing and resumes from checkpoint", async () => {
  const planner = {
    mode: "llm-plan",
    intent: "command",
    todo: [
      {
        id: "publish",
        title: "发布集合通知",
        action: {
          type: "post.publish",
          arguments: { content: "原始通知：在南门集合。" },
        },
        status: "planned",
        requiresConfirmation: true,
      },
    ],
    coverage: { canCover: true, reason: "管理员可以发布。", unsupported: [] },
    approvalStatus: "approved",
  };
  const message = await AgentMessage.create({
    sessionId: "session-hitl",
    userId: "admin-hitl",
    role: "assistant",
    content: "发布前会请你审阅最终正文。",
    planner,
  });
  const run = await createRun({
    sessionId: "session-hitl",
    userId: "admin-hitl",
    messageId: message.id,
    planner,
  });
  run.state = "running";
  await run.save();

  const calls = [];
  const actionExecutor = async (action) => {
    calls.push(action);
    return { summary: "帖子已发布", data: { postId: "post-hitl" } };
  };
  const actor = { id: "admin-hitl", name: "Admin", role: "admin" };

  const paused = await executeApprovedAgentWorkflow({
    message,
    run,
    actor,
    actionExecutor,
  });

  assert.equal(calls.length, 0);
  assert.equal(paused.interrupt.value.kind, "tool_approval");
  assert.equal(paused.interrupt.value.actionType, "post.publish");
  assert.match(paused.interrupt.value.actionDigest, /^[a-f0-9]{64}$/);
  assert.match(paused.interrupt.value.draft, /南门/);
  assert.equal((await WorkflowRun.findById(run.id)).state, "awaiting_input");

  const resumed = await resumeAgentWorkflow({
    message: await AgentMessage.findById(message.id),
    run: await WorkflowRun.findById(run.id),
    actor,
    interruptId: paused.interrupt.id,
    response: { decision: "edit", content: "更新通知：改在北门集合。" },
    actionExecutor,
  });

  assert.equal(resumed.interrupt, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].arguments.content, "更新通知：改在北门集合。");
  assert.equal((await WorkflowRun.findById(run.id)).state, "succeeded");
  assert.equal(
    (await WorkflowStep.findOne({ runId: run.id, sequence: 0 })).action
      .arguments.content,
    "更新通知：改在北门集合。",
  );
  const events = await WorkflowEvent.find({ runId: run.id }).lean();
  assert.ok(events.some((event) => event.type === "human_input.requested"));
  assert.ok(events.some((event) => event.type === "human_input.received"));
  const approvals = await Approval.find({ runId: run.id }).lean();
  const toolApproval = approvals.find(
    (approval) => approval.decision === "tool_approved",
  );
  assert.match(toolApproval.actionDigest, /^[a-f0-9]{64}$/);
});

test("rejecting a dangerous tool is terminal and never calls its executor", async () => {
  const planner = {
    mode: "llm-plan",
    intent: "command",
    todo: [
      {
        id: "publish-rejected",
        title: "发布危险通知",
        action: {
          type: "post.publish",
          arguments: { content: "这条内容不应发布" },
        },
        status: "planned",
        requiresConfirmation: true,
      },
    ],
    coverage: { canCover: true, reason: "管理员可以发布。", unsupported: [] },
    approvalStatus: "approved",
  };
  const message = await AgentMessage.create({
    sessionId: "session-reject",
    userId: "admin-reject",
    role: "assistant",
    content: "等待危险工具审批。",
    planner,
  });
  const run = await createRun({
    sessionId: "session-reject",
    userId: "admin-reject",
    messageId: message.id,
    planner,
  });
  run.state = "running";
  await run.save();
  let calls = 0;
  const actionExecutor = async () => {
    calls += 1;
    return {};
  };
  const actor = { id: "admin-reject", role: "admin" };
  const paused = await executeApprovedAgentWorkflow({
    message,
    run,
    actor,
    actionExecutor,
  });
  const result = await resumeAgentWorkflow({
    message: await AgentMessage.findById(message.id),
    run: await WorkflowRun.findById(run.id),
    actor,
    response: { decision: "reject", reason: "内容不准确" },
    interruptId: paused.interrupt.id,
    actionExecutor,
  });

  assert.equal(calls, 0);
  assert.equal(result.message.planner.approvalStatus, "rejected");
  assert.equal((await WorkflowRun.findById(run.id)).state, "rejected");
  assert.equal(
    (await WorkflowStep.findOne({ runId: run.id, sequence: 0 })).state,
    "rejected",
  );
});

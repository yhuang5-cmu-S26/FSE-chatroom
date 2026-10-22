const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "weather-alert-workflow-"));
process.env.DB_DRIVER = "json";
process.env.WORKFLOW_DATA_DIR = dataDir;
process.env.AGENT_SESSION_DATA_DIR = dataDir;

const AgentMessage = require("../../src/models/AgentMessage");
const WorkflowRun = require("../../src/models/WorkflowRun");
const { createRun } = require("../../src/services/workflow/state");
const {
  executeApprovedAgentWorkflow,
  resumeAgentWorkflow,
} = require("../../src/services/agent/workflow");

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test("weather alert proposal pauses for a second approval before publishing", async () => {
  const planner = {
    mode: "llm-plan",
    intent: "command",
    todo: [
      {
        id: "forecast",
        title: "查询未来天气",
        action: {
          type: "mcp.weather.forecast",
          arguments: { latitude: 34.0522, longitude: -118.2437, hours: 24 },
        },
        status: "planned",
        requiresConfirmation: false,
      },
    ],
    coverage: { canCover: true, reason: "可查询天气。", unsupported: [] },
    weatherAlert: { evaluateForPost: true },
    approvalStatus: "approved",
  };
  const message = await AgentMessage.create({
    sessionId: "session-1",
    userId: "user-1",
    role: "assistant",
    content: "我会先查询天气。",
    planner,
  });
  const run = await createRun({
    sessionId: "session-1",
    userId: "user-1",
    messageId: message.id,
    planner,
  });

  const calls = [];
  const actionExecutor = async (action) => {
    calls.push(action.type);
    if (action.type === "mcp.weather.forecast")
      return {
        data: {
          result: {
            requestedHours: 24,
            hourly: [
              {
                time: "2026-09-09T12:00",
                precipitation_probability: 88,
                precipitation: 25,
                wind_gusts_10m: 66,
              },
            ],
          },
        },
      };
    return { summary: "帖子已发布", data: { postId: "post-1" } };
  };
  const weatherEvaluator = async () => ({
    shouldPublish: true,
    reason: "未来 24 小时存在强降雨风险。",
    evidence: {
      forecastHours: 24,
      maxPrecipitationProbability: 88,
      maxPrecipitation: 25,
      maxWindGust: 66,
    },
    post: { title: "强降雨提示", content: "请提前做好出行和排涝准备。" },
  });

  await executeApprovedAgentWorkflow({
    message,
    run,
    actor: { id: "user-1", role: "admin" },
    actionExecutor,
    weatherEvaluator,
  });

  assert.deepEqual(calls, ["mcp.weather.forecast"]);
  assert.equal(message.planner.approvalStatus, "pending");
  assert.equal(run.state, "awaiting_approval");
  assert.equal(message.planner.todo.length, 2);
  assert.equal(message.planner.todo[1].action.type, "post.publish");
  assert.match(message.planner.todo[1].action.arguments.content, /强降雨提示/);
  assert.equal(message.planner.weatherAlert.decision.shouldPublish, true);

  message.planner.approvalStatus = "approved";
  run.state = "running";
  await run.save();
  const paused = await executeApprovedAgentWorkflow({
    message,
    run,
    actor: { id: "user-1", role: "admin" },
    actionExecutor,
  });

  assert.equal(paused.interrupt.value.kind, "tool_approval");
  assert.equal(paused.interrupt.value.actionType, "post.publish");
  const resumed = await resumeAgentWorkflow({
    message: await AgentMessage.findById(message.id),
    run: await WorkflowRun.findById(run.id),
    actor: { id: "user-1", role: "admin" },
    response: { decision: "approve" },
    interruptId: paused.interrupt.id,
    actionExecutor,
  });

  assert.deepEqual(calls, ["mcp.weather.forecast", "post.publish"]);
  assert.equal(resumed.message.planner.approvalStatus, "executed");
  assert.equal((await WorkflowRun.findById(run.id)).state, "succeeded");
});

const test = require("node:test");
const assert = require("node:assert/strict");

const { planAgentWorkflow } = require("../../src/services/agent/workflow");

test("LangGraph planning graph returns a validated command plan", async () => {
  const original = {
    url: process.env.LLM_API_URL,
    key: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
  };
  process.env.LLM_API_URL = "https://llm.example.test/chat/completions";
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "test-model";
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                intent: "command",
                reply: "我会先生成帖子草稿。",
                todo: [
                  {
                    id: "draft",
                    title: "生成帖子草稿",
                    action: {
                      type: "post.draft",
                      arguments: { topic: "暴雨预警" },
                    },
                  },
                ],
                coverage: {
                  canCover: true,
                  reason: "能力可覆盖。",
                  unsupported: [],
                },
              }),
            },
          },
        ],
      }),
      { status: 200 },
    );
  try {
    const result = await planAgentWorkflow(
      "生成暴雨预警草稿",
      { role: "user" },
      { fetchImpl },
    );
    assert.equal(result.intent, "command");
    assert.equal(result.todo[0].action.type, "post.draft");
  } finally {
    process.env.LLM_API_URL = original.url;
    process.env.LLM_API_KEY = original.key;
    process.env.LLM_MODEL = original.model;
  }
});

test("LangGraph planning graph accepts an injected production planner adapter", async () => {
  const calls = [];
  const expected = {
    reply: "由策略网关生成的只读答复。",
    intent: "conversation",
    todo: [],
    coverage: { canCover: true, reason: "无工具调用。", unsupported: [] },
    requiresConfirmation: false,
    mode: "policy-gateway",
  };
  const result = await planAgentWorkflow(
    "你好",
    { id: "user-1" },
    {
      history: [{ role: "user", content: "之前的消息" }],
      systemMemory: "用户明确记忆：集合点是北门。",
      planRequest: async (message, actor, context) => {
        calls.push({ message, actor, context });
        return expected;
      },
    },
  );

  assert.deepEqual(result, expected);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message, "你好");
  assert.equal(calls[0].actor.id, "user-1");
  assert.deepEqual(calls[0].context.history, [
    { role: "user", content: "之前的消息" },
  ]);
  assert.equal(calls[0].context.systemMemory, "用户明确记忆：集合点是北门。");
});

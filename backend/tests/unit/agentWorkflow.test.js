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

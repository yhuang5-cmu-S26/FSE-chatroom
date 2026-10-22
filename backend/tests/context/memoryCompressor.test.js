const test = require("node:test");
const assert = require("node:assert/strict");

const {
  compactConversation,
} = require("../../src/services/agent/memory/compressor");

test("compaction rewrites archived turns with one token-bounded LLM call", async () => {
  const requests = [];
  const messages = Array.from({ length: 6 }, (_, index) => ({
    id: `turn-${index}`,
    role: index % 2 ? "assistant" : "user",
    content: `第 ${index + 1} 轮：项目编号 DR-9，集合点是北门。`,
  }));

  const result = await compactConversation("旧摘要：集合点待确认。", messages, {
    keepTokens: 60,
    maxRecentMessages: 2,
    summaryChars: 300,
    summaryTokens: 96,
    llmApiUrl: "https://llm.example.test/chat/completions",
    llmApiKey: "test-key",
    llmModel: "test-model",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  "## 已确认事实\n- 项目编号为 DR-9，集合点已确认为北门。",
              },
            },
          ],
        }),
      };
    },
  });

  assert.equal(requests.length, 1);
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.max_tokens, 96);
  assert.equal(body.temperature, 0);
  assert.match(body.messages[1].content, /旧摘要/);
  assert.match(body.messages[1].content, /newly_archived_turns/);
  assert.equal(result.summaryMethod, "llm");
  assert.match(result.summary, /DR-9/);
  assert.deepEqual(result.messages, messages.slice(-2));
  assert.equal(result.archivedMessageCount, 4);
});

test("compaction keeps a bounded deterministic fallback without a provider", async () => {
  const result = await compactConversation(
    "",
    [
      { role: "user", content: "旧事实：集合点是南门。" },
      { role: "assistant", content: "已记录。" },
      { role: "user", content: "最新问题" },
    ],
    {
      keepTokens: 12,
      maxRecentMessages: 1,
      summaryChars: 120,
      llmApiUrl: "",
      llmApiKey: "",
      llmModel: "",
      // Prevent ambient test-runner credentials from enabling a real request.
      fetchImpl: null,
    },
  );

  assert.equal(result.summaryMethod, "fallback");
  assert.match(result.summary, /南门/);
  assert.ok(result.summary.length <= 120);
  assert.deepEqual(result.messages, [
    { role: "user", content: "最新问题" },
  ]);
});

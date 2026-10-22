const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-memory-test-"));
process.env.DB_DRIVER = "json";
process.env.AGENT_SESSION_DATA_DIR = dataDir;
process.env.AGENT_MEMORY_DATA_DIR = dataDir;

const AgentMessage = require("../../src/models/AgentMessage");
const { memoryThreadId } = require("../../src/services/agent/memory/checkpointer");
const {
  getMemoryGraphState,
} = require("../../src/services/agent/memory/graph");
const {
  commitMemoryMessages,
  prepareMemoryContext,
} = require("../../src/services/agent/memory");

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test("thread memory compacts incrementally and persists a bounded recent window", async () => {
  const session = { id: "session-memory-1", contextMemory: {} };
  const userId = "user-memory-1";
  const messages = Array.from({ length: 12 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 ? "assistant" : "user",
    content: `第 ${index + 1} 轮状态：${"应急响应信息 ".repeat(12)}`,
  }));

  const committed = await commitMemoryMessages(session, userId, messages, {
    triggerTokens: 120,
    keepTokens: 65,
    maxRecentMessages: 4,
    summaryChars: 600,
  });
  assert.ok(committed.summary.includes("较早对话摘要"));
  assert.ok(committed.messages.length <= 4);

  const stored = await getMemoryGraphState(
    memoryThreadId(session.id, userId),
  );
  assert.equal(stored.sourceMessageCount, messages.length);

  const prepared = await prepareMemoryContext(session, userId, "下一步是什么？", {
    triggerTokens: 120,
    keepTokens: 65,
    maxRecentMessages: 4,
    summaryChars: 600,
  });
  assert.ok(prepared.systemMemory.includes("当前会话摘要"));
  assert.ok(prepared.history.length <= 4);
});

test("only explicit durable facts are recalled across sessions", async () => {
  const userId = "user-memory-2";
  const firstSession = { id: "session-memory-2a", contextMemory: {} };
  await commitMemoryMessages(
    firstSession,
    userId,
    [{ id: "fact-1", role: "user", content: "请记住：我的集合点是北门。" }],
    { maxRecentMessages: 4 },
  );

  const secondSession = { id: "session-memory-2b", contextMemory: {} };
  const recalled = await prepareMemoryContext(
    secondSession,
    userId,
    "我的集合点在哪里？",
  );
  assert.match(recalled.systemMemory, /长期记忆/);
  assert.match(recalled.systemMemory, /集合点是北门/);

  assert.equal(
    (await AgentMessage.find({ sessionId: secondSession.id, userId }).lean()).length,
    0,
  );
});

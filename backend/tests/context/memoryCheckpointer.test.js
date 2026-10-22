const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "checkpointer-test-"));
process.env.AGENT_MEMORY_DATA_DIR = dataDir;

const {
  JsonMemoryCheckpointer,
  memoryCheckpointer,
} = require("../../src/services/agent/memory/checkpointer");
const {
  runMemoryGraph,
} = require("../../src/services/agent/memory/graph");

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test("mock checkpointer serializes operations for the same thread", async () => {
  const saver = new JsonMemoryCheckpointer({
    filePath: path.join(dataDir, "serialized-checkpoints.json"),
  });
  const order = [];
  let allowFirstToFinish;
  let firstStarted;
  const firstStartedPromise = new Promise((resolve) => {
    firstStarted = resolve;
  });
  const firstGate = new Promise((resolve) => {
    allowFirstToFinish = resolve;
  });

  const first = saver.withThreadLock("same-thread", async () => {
    order.push("first:start");
    firstStarted();
    await firstGate;
    order.push("first:end");
  });
  await firstStartedPromise;
  const second = saver.withThreadLock("same-thread", async () => {
    order.push("second:start");
  });

  assert.deepEqual(order, ["first:start"]);
  allowFirstToFinish();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first:start", "first:end", "second:start"]);
});

test("memory graph restores state from its mock checkpoint", async () => {
  const threadId = `checkpoint-test-${Date.now()}`;
  const config = {
    triggerTokens: 1000,
    keepTokens: 500,
    maxRecentMessages: 10,
  };
  try {
    await runMemoryGraph(
      {
        summary: "",
        messages: [{ id: "old", role: "user", content: "旧消息" }],
        incomingMessages: [],
        longTermMemories: [],
        config,
        forceCompact: false,
      },
      threadId,
    );

    const restored = await runMemoryGraph(
      {
        incomingMessages: [
          { id: "new", role: "assistant", content: "新消息" },
        ],
        longTermMemories: [],
        config,
        forceCompact: false,
      },
      threadId,
    );

    assert.deepEqual(
      restored.messages.map((message) => message.id),
      ["old", "new"],
    );

    const reloadedSaver = new JsonMemoryCheckpointer({
      filePath: memoryCheckpointer.filePath,
    });
    const persisted = await reloadedSaver.getTuple({
      configurable: { thread_id: threadId },
    });
    assert.deepEqual(
      persisted.checkpoint.channel_values.messages.map((message) => message.id),
      ["old", "new"],
    );
  } finally {
    await memoryCheckpointer.deleteThread(threadId);
  }
});

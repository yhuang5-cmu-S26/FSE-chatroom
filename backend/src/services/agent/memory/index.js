const AgentMessage = require("../../../models/AgentMessage");
const { normalizeMessages } = require("./compressor");
const { memoryConfig } = require("./config");
const { getMemoryGraphState, runMemoryGraph } = require("./graph");
const { memoryCheckpointer, memoryThreadId } = require("./checkpointer");
const {
  rememberExplicitFacts,
  searchLongTermMemories,
} = require("./store");

// 记忆模块的应用层门面：连接持久化 Store 与无持久化副作用的 Memory Graph。
// 路由层只需要通过本文件完成“读取上下文”和“提交本轮记忆”两类操作。

/**
 * 将整轮“读取上下文 → Planner → 提交记忆”按 session 串行化。
 * 队列由 mock Checkpointer 持有；不同 session 仍可并发。
 */
async function withSessionMemory(sessionId, operation) {
  return memoryCheckpointer.withThreadLock(
    `request:${String(sessionId)}`,
    operation,
  );
}

/** 把 Checkpointer state 转换为应用层使用的稳定结构。 */
function memoryValue(value = {}) {
  return {
    summary: String(value.summary || ""),
    messages: normalizeMessages(value.messages),
    sourceMessageCount: Number(value.sourceMessageCount || 0),
    updatedAt: value.updatedAt || null,
  };
}

/**
 * 获取当前会话的短期记忆投影。
 *
 * 新版会话直接读取 JSON Checkpointer；没有 checkpoint 的旧会话第一次访问时
 * 才从 AgentMessage 完整历史重建一次。
 */
async function bootstrapThreadMemory(session, userId, options = {}) {
  const threadId = memoryThreadId(session.id, userId);
  const existing = await getMemoryGraphState(threadId);
  if (existing) return memoryValue(existing);

  // 仅旧会话迁移时扫描完整消息表，正常对话轮次不会重复扫描。
  const legacyMessages = await AgentMessage.find({
    sessionId: session.id,
    userId,
  })
    .sort({ createdAt: 1 })
    .lean();
  const config = memoryConfig(options);
  const summarizedCount = Math.min(
    Number(session.contextMemory?.sourceMessageCount || 0),
    legacyMessages.length,
  );
  const messagesToImport = session.contextMemory?.summary
    ? legacyMessages.slice(summarizedCount)
    : legacyMessages;

  // 首次迁移也通过同一 LangGraph 子图完成，避免维护另一套压缩规则。
  const result = await runMemoryGraph(
    {
      summary: session.contextMemory?.summary || "",
      messages: messagesToImport.map((message) => ({
        id: String(message._id || message.id),
        role: message.role,
        content: message.content,
      })),
      incomingMessages: [],
      longTermMemories: [],
      config,
      forceCompact: messagesToImport.length > config.maxRecentMessages,
      sourceMessageCount: legacyMessages.length,
      updatedAt: new Date().toISOString(),
    },
    threadId,
  );
  return memoryValue(result);
}

/**
 * 在调用 Planner 前准备模型上下文。
 *
 * thread 是当前 session 内的短期记忆；longTermMemories 是以 userId 为范围、
 * 根据本轮输入检索出的跨 session 长期记忆。Graph 组合二者，并由 Checkpointer
 * 自动保存本次运行后的完整 state。
 */
async function prepareMemoryContext(session, userId, input, options = {}) {
  const thread = await bootstrapThreadMemory(session, userId, options);
  const config = memoryConfig(options);
  const longTermMemories = await searchLongTermMemories(
    userId,
    input,
    config.longTermLimit,
  );
  // 运行 LangGraph 记忆子图：短期窗口与检索到的长期记忆在 build
  // 节点汇合，生成 planner 所需的 history/systemMemory。
  const result = await runMemoryGraph(
    {
      incomingMessages: [],
      longTermMemories,
      config,
      forceCompact: false,
    },
    memoryThreadId(session.id, userId),
  );
  return {
    history: result.messages || [],
    systemMemory: result.systemMemory || "",
    stats: result.stats || {},
  };
}

/**
 * 从用户明确要求“记住”的消息中提取长期事实。
 * 当前策略刻意保守：不会把模型推断或普通聊天内容自动升级为长期记忆。
 */
function extractExplicitFacts(messages) {
  const facts = [];
  for (const message of normalizeMessages(messages)) {
    if (message.role !== "user") continue;
    const patterns = [
      /(?:请记住|记住)[：:,，\s]*(.{2,200})/iu,
      /(?:please\s+)?remember(?:\s+that)?[：:,\s]+(.{2,200})/iu,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(message.content);
      if (match?.[1]) facts.push(match[1].trim());
    }
  }
  return facts;
}

/**
 * 在一轮对话持久化完成后更新记忆投影：
 * 1. 将新消息幂等合并到 thread memory，并按需生成滚动摘要；
 * 2. Checkpointer 自动持久化 session 范围的完整 Graph state；
 * 3. Store 单独保存用户明确指定的跨 session 长期事实。
 */
async function commitMemoryMessages(session, userId, messages, options = {}) {
  const thread = await bootstrapThreadMemory(session, userId, options);
  const normalized = normalizeMessages(messages);
  const knownIds = new Set(
    thread.messages.map((message) => message.id).filter(Boolean),
  );
  const addedCount = normalized.filter(
    (message) => !message.id || !knownIds.has(message.id),
  ).length;

  // 将本轮消息作为 incomingMessages 交给 LangGraph；hydrate 节点负责
  // 幂等合并，条件边决定是否需要执行增量摘要。
  const result = await runMemoryGraph(
    {
      incomingMessages: normalized,
      longTermMemories: [],
      config: memoryConfig(options),
      forceCompact: false,
      sourceMessageCount: thread.sourceMessageCount + addedCount,
      updatedAt: new Date().toISOString(),
    },
    memoryThreadId(session.id, userId),
  );
  const value = memoryValue(result);

  // 短期状态已由 Checkpointer 落盘；这里只写跨 session 的长期事实。
  await rememberExplicitFacts(userId, extractExplicitFacts(normalized));
  return { ...value, stats: result.stats || {} };
}

/**
 * 记忆只是可重建的派生状态，不能因为记忆更新失败而让已经成功持久化的聊天
 * 响应变成接口失败。发生异常时删除当前 thread checkpoint；下一轮访问会从
 * AgentMessage 重新构建。长期记忆不属于 session projection，因此不会被删除。
 */
async function commitMemoryMessagesBestEffort(
  session,
  userId,
  messages,
  options = {},
) {
  try {
    return await commitMemoryMessages(session, userId, messages, options);
  } catch (error) {
    console.error(
      "Agent memory projection update failed; invalidating it.",
      error,
    );
    try {
      await deleteSessionMemory(session.id, userId);
    } catch (cleanupError) {
      console.error(
        "Agent memory projection invalidation failed.",
        cleanupError,
      );
    }
    return null;
  }
}

/** 清理该用户在当前 session 下的完整 Graph checkpoint。 */
async function deleteSessionMemory(sessionId, userId) {
  await memoryCheckpointer.deleteThread(memoryThreadId(sessionId, userId));
}

module.exports = {
  commitMemoryMessages,
  commitMemoryMessagesBestEffort,
  deleteSessionMemory,
  extractExplicitFacts,
  prepareMemoryContext,
  withSessionMemory,
};

const AgentSession = require("../models/AgentSession");
const AgentMessage = require("../models/AgentMessage");
const { buildPromptContext } = require("./historyCompressor");
const { deleteWorkflowStateForSession } = require("./workflowState");

const SESSION_LIMIT = 50;

function serializeSession(session) {
  const value = session.toObject?.() || session;
  return {
    id: String(value._id || value.id),
    title: value.title,
    status: value.status,
    lastMessageAt: value.lastMessageAt,
    createdAt: value.createdAt,
  };
}
function serializeMessage(message) {
  const value = message.toObject?.() || message;
  return {
    id: String(value._id || value.id),
    role: value.role,
    content: value.content,
    planner: value.planner || null,
    createdAt: value.createdAt,
  };
}
async function getOwnedMessage(messageId, sessionId, userId) {
  return AgentMessage.findOne({
    _id: messageId,
    sessionId,
    userId,
    role: "assistant",
  });
}

async function createSession(userId) {
  return AgentSession.create({
    userId,
    title: "新建协作会话",
    status: "active",
    lastMessageAt: new Date(),
  });
}
async function getOwnedSession(sessionId, userId) {
  return AgentSession.findOne({ _id: sessionId, userId });
}
async function resolveSession(sessionId, userId) {
  if (!sessionId) return createSession(userId);
  const session = await getOwnedSession(sessionId, userId);
  if (!session) {
    const error = new Error("agent session not found");
    error.status = 404;
    throw error;
  }
  return session;
}
async function appendMessage(session, userId, payload) {
  const message = await AgentMessage.create({
    sessionId: session.id,
    userId,
    ...payload,
  });
  session.lastMessageAt = new Date();
  if (payload.role === "user" && session.title === "新建协作会话")
    session.title = payload.content.slice(0, 80);
  await session.save();
  return message;
}
async function listSessions(userId) {
  return (
    await AgentSession.find({ userId, status: "active" })
      .sort({ lastMessageAt: -1 })
      .limit(SESSION_LIMIT)
      .lean()
  ).map(serializeSession);
}
async function listMessages(sessionId, userId, limit = 100) {
  const session = await getOwnedSession(sessionId, userId);
  if (!session) return null;
  const messages = await AgentMessage.find({ sessionId, userId })
    .sort({ createdAt: 1 })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 100))
    .lean();
  return messages.map(serializeMessage);
}
async function deleteSession(sessionId, userId) {
  const session = await getOwnedSession(sessionId, userId);
  if (!session) {
    const error = new Error("agent session not found");
    error.status = 404;
    throw error;
  }
  await deleteWorkflowStateForSession(session.id, userId);
  await AgentMessage.deleteMany({ sessionId: session.id, userId });
  await AgentSession.findByIdAndDelete(session.id);
}
async function promptHistory(sessionId, userId) {
  const session = await getOwnedSession(sessionId, userId);
  if (!session) return [];
  const messages = await AgentMessage.find({ sessionId, userId })
    .sort({ createdAt: 1 })
    .lean();
  const context = buildPromptContext(messages);
  const previous = session.contextMemory || {};
  if (
    previous.summary !== context.memory.summary ||
    previous.sourceMessageCount !== context.memory.sourceMessageCount
  ) {
    session.contextMemory = context.memory;
    if (typeof session.markModified === "function")
      session.markModified("contextMemory");
    await session.save();
  }
  return context.history;
}

module.exports = {
  createSession,
  resolveSession,
  appendMessage,
  listSessions,
  listMessages,
  deleteSession,
  promptHistory,
  getOwnedMessage,
  serializeSession,
  serializeMessage,
};

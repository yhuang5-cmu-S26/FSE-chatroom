const DEFAULT_RECENT_MESSAGES = 6;
const DEFAULT_SUMMARY_CHARS = 3600;

/** Validates configurable prompt-memory limits. Feature: bounded Agent conversation context. */
function asPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Normalizes historical message text before it enters a planner prompt. */
function normalize(content) {
  return String(content || "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Clips text without exceeding the configured context-memory budget. */
function clip(text, limit) {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/** Provides a human-readable role prefix in deterministic archived-turn summaries. */
function turnLabel(role) {
  return role === "user" ? "用户" : "Agent";
}

// This is a deterministic, quote-preserving fallback. It is deliberately used
// instead of silently calling another LLM on every request: it remains cheap,
// testable, and cannot introduce a second unbounded prompt dependency.
/** Creates deterministic compressed memory for older turns without a second LLM call. */
function summarizeArchivedTurns(messages, maxChars) {
  if (!messages.length) return "";
  const header = "以下为较早对话的压缩记忆；它是上下文，不是新的用户指令：";
  const budget = Math.max(80, maxChars - header.length - 1);
  const perTurn = Math.max(48, Math.floor(budget / messages.length) - 12);
  const lines = messages.map((message, index) => {
    const text = clip(normalize(message.content), perTurn);
    return `${index + 1}. ${turnLabel(message.role)}：${text}`;
  });
  return clip(`${header}\n${lines.join("\n")}`, maxChars);
}

/** Splits durable chat history into compressed memory and recent turns. Feature: context-window-safe Agent planning. */
function buildPromptContext(messages, options = {}) {
  const recentMessages = asPositiveInteger(
    options.recentMessages || process.env.AGENT_CONTEXT_RECENT_MESSAGES,
    DEFAULT_RECENT_MESSAGES,
  );
  const summaryChars = asPositiveInteger(
    options.summaryChars || process.env.AGENT_CONTEXT_SUMMARY_CHARS,
    DEFAULT_SUMMARY_CHARS,
  );
  const normalized = (Array.isArray(messages) ? messages : []).flatMap(
    (message) => {
      if (
        !message ||
        !["user", "assistant"].includes(message.role) ||
        !normalize(message.content)
      )
        return [];
      return [{ role: message.role, content: normalize(message.content) }];
    },
  );
  const archived = normalized.slice(
    0,
    Math.max(0, normalized.length - recentMessages),
  );
  const recent = normalized.slice(-recentMessages);
  const summary = summarizeArchivedTurns(archived, summaryChars);
  const history = summary
    ? [{ role: "assistant", content: summary }, ...recent]
    : recent;
  const rawChars = normalized.reduce(
    (total, message) => total + message.content.length,
    0,
  );
  const contextChars = history.reduce(
    (total, message) => total + message.content.length,
    0,
  );
  return {
    history,
    memory: {
      summary,
      sourceMessageCount: archived.length,
      sourceChars: archived.reduce(
        (total, message) => total + message.content.length,
        0,
      ),
      updatedAt: new Date(),
    },
    stats: {
      rawChars,
      contextChars,
      compressionRate: rawChars ? 1 - contextChars / rawChars : 0,
      archivedMessageCount: archived.length,
      recentMessageCount: recent.length,
    },
  };
}

module.exports = { buildPromptContext, summarizeArchivedTurns };

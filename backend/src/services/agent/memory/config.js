const DEFAULTS = Object.freeze({
  triggerTokens: 6000,
  keepTokens: 3000,
  summaryChars: 4000,
  summaryTokens: 800,
  maxRecentMessages: 24,
  longTermLimit: 3,
});

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function memoryConfig(overrides = {}) {
  const triggerTokens = positiveInteger(
    overrides.triggerTokens || process.env.AGENT_MEMORY_TRIGGER_TOKENS,
    DEFAULTS.triggerTokens,
  );
  return {
    triggerTokens,
    keepTokens: Math.min(
      positiveInteger(
        overrides.keepTokens || process.env.AGENT_MEMORY_KEEP_TOKENS,
        DEFAULTS.keepTokens,
      ),
      triggerTokens,
    ),
    summaryChars: positiveInteger(
      overrides.summaryChars || process.env.AGENT_MEMORY_SUMMARY_CHARS,
      DEFAULTS.summaryChars,
    ),
    summaryTokens: positiveInteger(
      overrides.summaryTokens || process.env.AGENT_MEMORY_SUMMARY_TOKENS,
      DEFAULTS.summaryTokens,
    ),
    maxRecentMessages: positiveInteger(
      overrides.maxRecentMessages ||
        process.env.AGENT_MEMORY_MAX_RECENT_MESSAGES,
      DEFAULTS.maxRecentMessages,
    ),
    longTermLimit: positiveInteger(
      overrides.longTermLimit || process.env.AGENT_MEMORY_LONG_TERM_LIMIT,
      DEFAULTS.longTermLimit,
    ),
  };
}

module.exports = { DEFAULTS, memoryConfig, positiveInteger };

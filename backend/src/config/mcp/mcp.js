function positiveEnv(name, fallback) {
  return Math.max(1000, Number(process.env[name]) || fallback);
}

function boundedAttempts(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : fallback;
}

function createStreamableHttpServer({ name, url, token, tool }) {
  return {
    name,
    transport: 'streamable-http',
    url: url || '',
    token: token || '',
    tool,
    connectTimeoutMs: positiveEnv('MCP_CONNECT_TIMEOUT_MS', 5000),
    toolTimeoutMs: positiveEnv('MCP_TOOL_TIMEOUT_MS', 12000),
    readMaxAttempts: boundedAttempts('MCP_READ_MAX_ATTEMPTS', 3),
    retryBaseDelayMs: positiveEnv('MCP_RETRY_BASE_DELAY_MS', 1000),
  };
}

module.exports = { createStreamableHttpServer };

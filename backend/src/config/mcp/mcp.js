function positiveEnv(name, fallback) {
  return Math.max(1000, Number(process.env[name]) || fallback);
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
  };
}

module.exports = { createStreamableHttpServer };

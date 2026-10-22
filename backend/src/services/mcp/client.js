const { getMcpServer } = require("../../config/mcp");

/** Applies a bounded timeout to MCP connection and Tool calls. Feature: resilient external integrations. */
function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function isTransientMcpError(error) {
  const status = Number(error?.status || error?.statusCode);
  if (status === 429 || status >= 500) return true;
  const code = String(error?.code || "").toUpperCase();
  if (["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT"].includes(code))
    return true;
  return /timed out|timeout|temporarily unavailable|connection (?:reset|closed)/i.test(
    String(error?.message || ""),
  );
}

/** Retries only explicitly retryable operations with a bounded exponential backoff. */
async function retryTransient(
  operation,
  {
    maxAttempts = 1,
    baseDelayMs = 1000,
    sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    random = Math.random,
  } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientMcpError(error)) throw error;
      const exponential = baseDelayMs * 2 ** (attempt - 1);
      const jittered = Math.round(exponential * (0.8 + random() * 0.4));
      await sleep(jittered);
    }
  }
  throw lastError;
}

/**
 * Connects to a configured Streamable HTTP MCP server, invokes one Tool, and closes the client.
 * Feature: controlled external capability access for the Agent.
 */
async function callMcpTool(serverName, toolName, args, { retryable = false } = {}) {
  const config = getMcpServer(serverName);
  if (!config?.url)
    throw new Error(`MCP server ${serverName} is not configured`);
  return retryTransient(
    async () => {
      const { Client, StreamableHTTPClientTransport } =
        await import("@modelcontextprotocol/client");
      // A fresh transport per attempt avoids reusing a poisoned connection.
      const transport = new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: {
          headers: config.token
            ? { authorization: `Bearer ${config.token}` }
            : {},
        },
      });
      const client = new Client({
        name: "fse-chatroom-agent",
        version: "1.0.0",
      });
      try {
        await withTimeout(
          client.connect(transport),
          config.connectTimeoutMs,
          `MCP connect (${serverName})`,
        );
        return await withTimeout(
          client.callTool({ name: toolName, arguments: args }),
          config.toolTimeoutMs,
          `MCP tool ${serverName}.${toolName}`,
        );
      } finally {
        await client.close().catch(() => {});
      }
    },
    {
      maxAttempts: retryable ? config.readMaxAttempts : 1,
      baseDelayMs: config.retryBaseDelayMs,
    },
  );
}

module.exports = { callMcpTool, isTransientMcpError, retryTransient, withTimeout };

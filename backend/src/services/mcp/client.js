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

/**
 * Connects to a configured Streamable HTTP MCP server, invokes one Tool, and closes the client.
 * Feature: controlled external capability access for the Agent.
 */
async function callMcpTool(serverName, toolName, args) {
  const config = getMcpServer(serverName);
  if (!config?.url)
    throw new Error(`MCP server ${serverName} is not configured`);
  const { Client, StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/client");
  // Streamable HTTP keeps external credentials and protocol details outside Agent Tool handlers.
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: {
      headers: config.token ? { authorization: `Bearer ${config.token}` } : {},
    },
  });
  const client = new Client({ name: "fse-chatroom-agent", version: "1.0.0" });
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
}

module.exports = { callMcpTool };

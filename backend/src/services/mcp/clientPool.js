const { getMcpServer } = require("../../config/mcp");

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

// Client call external MCP tool via HTTP transport
async function callMcpTool(serverName, toolName, args) {
  const config = getMcpServer(serverName);
  if (!config?.url)
    throw new Error(`MCP server ${serverName} is not configured`);
  const { Client, StreamableHTTPClientTransport } =
    await import("@modelcontextprotocol/client");
  // This is where we create a transport for the MCP client to communicate with the MCP server over HTTP.
  // The transport is configured with the server URL and optional authorization headers if a token is provided in the configuration.
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

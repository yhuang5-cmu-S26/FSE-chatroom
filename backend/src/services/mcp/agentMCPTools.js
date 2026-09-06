const { callMcpTool } = require("./clientPool");

// Methods definition for executing actions via MCP tools
const actionHandlers = {
  "mcp.weather.forecast": async (action, _actor, _context, route) => {
    const result = await callMcpTool(
      route.server,
      route.tool,
      action.arguments,
    );
    return {
      summary: "外部天气信息查询完成",
      data: {
        provider: "mcp",
        server: route.server,
        tool: route.tool,
        result: result.structuredContent ?? result.content ?? result,
      },
    };
  },
};

// Re-dispatching the executeActions function to handle MCP tool execution
async function executeActions(action, actor, context = {}) {
  const route = require("../../config/mcp").getActionRoute(action?.type);
  const handler = actionHandlers[action?.type];
  if (!route || !handler)
    throw new Error(`MCP tool implementation is unavailable: ${action?.type}`);
  return handler(action, actor, context, route);
}

const registeredActions = new Set(Object.keys(actionHandlers));
module.exports = { executeActions, registeredActions };

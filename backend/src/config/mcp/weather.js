const { createStreamableHttpServer } = require('./mcp');

const server = createStreamableHttpServer({
  name: 'weather',
  url: process.env.MCP_WEATHER_URL,
  token: process.env.MCP_WEATHER_TOKEN,
  tool: process.env.MCP_WEATHER_TOOL || 'weather_forecast',
});

const actions = {
  'mcp.weather.forecast': { provider: 'mcp', server: server.name, tool: server.tool },
};

module.exports = { server, actions };

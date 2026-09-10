const { callMcpTool } = require("../../mcp/client");

const FORECAST_HOURLY_VARIABLES = Object.freeze([
  "temperature_2m",
  "apparent_temperature",
  "precipitation",
  "precipitation_probability",
  "weather_code",
  "wind_speed_10m",
  "wind_gusts_10m",
]);

/** Converts the Agent's hour-based weather contract into Open-Meteo MCP arguments. */
function toOpenMeteoForecastArguments(arguments_) {
  const { latitude, longitude, hours } = arguments_ || {};
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isInteger(hours) ||
    hours < 1 ||
    hours > 72
  )
    throw new Error("invalid weather forecast arguments");

  return {
    latitude,
    longitude,
    // The MCP tool accepts whole forecast days, while the public action is
    // intentionally expressed as a smaller 1–72 hour query window.
    forecast_days: Math.ceil(hours / 24),
    hourly_variables: [...FORECAST_HOURLY_VARIABLES],
  };
}

/** Normalizes provider output back to the Agent's requested forecast window. */
function normalizeOpenMeteoForecastResult(result, requestedHours) {
  const data = result?.structuredContent ?? result?.content ?? result;
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  if (!Array.isArray(data.hourly)) return data;

  return {
    ...data,
    hourly: data.hourly.slice(0, requestedHours),
    requestedHours,
  };
}

/** Maps approved Agent actions to their externally configured MCP Tool implementations. */
const actionHandlers = {
  "mcp.weather.forecast": async (action, _actor, _context, route) => {
    const result = await callMcpTool(
      route.server,
      route.tool,
      toOpenMeteoForecastArguments(action.arguments),
    );
    return {
      summary: "外部天气信息查询完成",
      data: {
        provider: "mcp",
        server: route.server,
        tool: route.tool,
        result: normalizeOpenMeteoForecastResult(
          result,
          action.arguments.hours,
        ),
      },
    };
  },
};

/** Dispatches an approved external action through its MCP route. Feature: external Agent Tool execution. */
async function executeActions(action, actor, context = {}) {
  const route = require("../../../config/mcp").getActionRoute(action?.type);
  const handler = actionHandlers[action?.type];
  if (!route || !handler)
    throw new Error(`MCP tool implementation is unavailable: ${action?.type}`);
  return handler(action, actor, context, route);
}

const registeredActions = new Set(Object.keys(actionHandlers));
module.exports = {
  executeActions,
  registeredActions,
  toOpenMeteoForecastArguments,
  normalizeOpenMeteoForecastResult,
};

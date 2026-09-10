const { getAgentPrompts } = require("../promptRegistry");

/** Parses the structured weather-decision response returned by the evaluator model. */
function parseJson(content) {
  const text = typeof content === "string" ? content.trim() : "";
  return JSON.parse(
    text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
  );
}

/** Reduces MCP forecast output to the bounded evidence payload for weather-alert evaluation. */
function compactForecast(toolResult) {
  const forecast = toolResult?.data?.result || toolResult?.result || toolResult;
  const hourly = Array.isArray(forecast?.hourly) ? forecast.hourly : [];
  return {
    latitude: forecast?.latitude ?? null,
    longitude: forecast?.longitude ?? null,
    timezone: forecast?.timezone || "unknown",
    requestedHours: forecast?.requestedHours || hourly.length,
    hourly: hourly.slice(0, 72).map((entry) => ({
      time: entry.time,
      temperature_2m: entry.temperature_2m ?? null,
      precipitation: entry.precipitation ?? null,
      precipitation_probability: entry.precipitation_probability ?? null,
      weather_code: entry.weather_code ?? null,
      wind_speed_10m: entry.wind_speed_10m ?? null,
      wind_gusts_10m: entry.wind_gusts_10m ?? null,
    })),
  };
}

/** Enforces the weather-alert JSON Schema before any generated content can become a post. */
function validateDecision(candidate, config) {
  if (!config.validateWeatherAlert(candidate)) {
    const details = (config.validateWeatherAlert.errors || [])
      .map((item) => `${item.instancePath || "/"} ${item.message}`)
      .join("; ");
    throw new Error(`weather alert decision violates JSON Schema: ${details}`);
  }
  return candidate;
}

/** Formats a schema-validated title and body into the internal post.publish payload. */
function formatWeatherAlertPost(post) {
  if (!post?.title || !post?.content)
    throw new Error("weather alert post is incomplete");
  const content = `【${post.title.trim()}】\n${post.content.trim()}`;
  if (content.length > 2000)
    throw new Error("weather alert post exceeds the post content limit");
  return content;
}

/**
 * Calls the evaluator model once to decide whether forecast evidence warrants a post and to draft it.
 * Feature: conditional severe-weather alert publishing.
 */
async function evaluateWeatherAlert(toolResult, { fetchImpl = fetch } = {}) {
  const url = process.env.LLM_API_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!url || !apiKey || !model)
    throw new Error(
      "LLM provider is not configured for weather alert evaluation",
    );

  const config = await getAgentPrompts();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number(process.env.LLM_TIMEOUT_MS) || 15000,
  );
  try {
    const body = {
      model,
      temperature: 0,
      messages: [
        { role: "system", content: config.weatherAlertPrompt.trim() },
        {
          role: "user",
          content: `Evaluate this forecast data only:\n${JSON.stringify(compactForecast(toolResult))}`,
        },
      ],
    };
    if (process.env.LLM_STRUCTURED_OUTPUTS === "true")
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "weather_alert_decision",
          strict: true,
          schema: config.weatherAlertSchema,
        },
      };
    const response = await fetchImpl(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(`weather alert LLM API returned ${response.status}`);
    const payload = await response.json();
    return validateDecision(
      parseJson(payload?.choices?.[0]?.message?.content),
      config,
    );
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  compactForecast,
  evaluateWeatherAlert,
  formatWeatherAlertPost,
};

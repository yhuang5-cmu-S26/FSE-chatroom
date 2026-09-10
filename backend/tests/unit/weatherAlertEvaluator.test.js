const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateWeatherAlert,
  formatWeatherAlertPost,
} = require("../../src/services/agent/weatherAlertEvaluator");

test("weather alert evaluator validates one LLM decision containing a post draft", async () => {
  const original = {
    url: process.env.LLM_API_URL,
    key: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
    structured: process.env.LLM_STRUCTURED_OUTPUTS,
  };
  process.env.LLM_API_URL = "https://llm.example.test/chat/completions";
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "test-model";
  process.env.LLM_STRUCTURED_OUTPUTS = "true";
  let requestBody;
  const decision = {
    shouldPublish: true,
    reason: "未来 24 小时降水概率较高。",
    evidence: {
      forecastHours: 24,
      maxPrecipitationProbability: 88,
      maxPrecipitation: 25,
      maxWindGust: 66,
    },
    post: { title: "强降雨提示", content: "请提前做好出行准备。" },
  };
  try {
    const result = await evaluateWeatherAlert(
      {
        data: {
          result: {
            requestedHours: 24,
            hourly: [
              {
                time: "2026-09-09T12:00",
                precipitation_probability: 88,
                precipitation: 25,
                wind_gusts_10m: 66,
              },
            ],
          },
        },
      },
      {
        fetchImpl: async (_url, options) => {
          requestBody = JSON.parse(options.body);
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(decision) } }],
            }),
            { status: 200 },
          );
        },
      },
    );
    assert.deepEqual(result, decision);
    assert.equal(requestBody.response_format.json_schema.name, "weather_alert_decision");
    assert.match(requestBody.messages[1].content, /precipitation_probability/);
    assert.equal(
      formatWeatherAlertPost(result.post),
      "【强降雨提示】\n请提前做好出行准备。",
    );
  } finally {
    process.env.LLM_API_URL = original.url;
    process.env.LLM_API_KEY = original.key;
    process.env.LLM_MODEL = original.model;
    process.env.LLM_STRUCTURED_OUTPUTS = original.structured;
  }
});

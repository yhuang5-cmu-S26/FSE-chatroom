const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeOpenMeteoForecastResult,
  toOpenMeteoForecastArguments,
} = require("../../src/services/agent/tools/mcp");

test("weather action arguments are adapted to openmeteo_get_forecast", () => {
  assert.deepEqual(
    toOpenMeteoForecastArguments({
      latitude: 34.0522,
      longitude: -118.2437,
      hours: 25,
    }),
    {
      latitude: 34.0522,
      longitude: -118.2437,
      forecast_days: 2,
      hourly_variables: [
        "temperature_2m",
        "apparent_temperature",
        "precipitation",
        "precipitation_probability",
        "weather_code",
        "wind_speed_10m",
        "wind_gusts_10m",
      ],
    },
  );
});

test("weather adapter rejects incomplete action arguments", () => {
  assert.throws(
    () =>
      toOpenMeteoForecastArguments({
        latitude: 34.0522,
        longitude: -118.2437,
      }),
    /invalid weather forecast arguments/,
  );
});

test("weather adapter enforces the public 1–72 hour query limit", () => {
  assert.throws(
    () =>
      toOpenMeteoForecastArguments({
        latitude: 34.0522,
        longitude: -118.2437,
        hours: 73,
      }),
    /invalid weather forecast arguments/,
  );
});

test("weather adapter limits Open-Meteo hourly records to the requested window", () => {
  const response = {
    structuredContent: {
      latitude: 34.0522,
      hourly: [
        { time: "2026-09-09T00:00", temperature_2m: 18 },
        { time: "2026-09-09T01:00", temperature_2m: 17 },
        { time: "2026-09-09T02:00", temperature_2m: 17 },
      ],
    },
  };

  assert.deepEqual(normalizeOpenMeteoForecastResult(response, 2), {
    latitude: 34.0522,
    hourly: [
      { time: "2026-09-09T00:00", temperature_2m: 18 },
      { time: "2026-09-09T01:00", temperature_2m: 17 },
    ],
    requestedHours: 2,
  });
});

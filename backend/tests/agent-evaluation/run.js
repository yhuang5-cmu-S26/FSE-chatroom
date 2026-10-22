const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
require("dotenv").config({
  path: path.resolve(__dirname, "../../.env"),
  quiet: true,
});
const { planAgentRequest } = require("../../src/services/agent/planner");
const { aggregatePlanScores, scorePlanCase } = require("./metrics");

const cases = require("./cases.json");
const thresholds = require("./thresholds.json");
const maxCases = Math.max(
  1,
  Math.min(Number(process.env.AGENT_EVAL_MAX_CASES) || 7, cases.length),
);
const selectedCases = cases.slice(0, maxCases);

async function main() {
  if (
    !process.env.LLM_API_URL ||
    !process.env.LLM_API_KEY ||
    !process.env.LLM_MODEL
  )
    throw new Error(
      "LLM_API_URL, LLM_API_KEY and LLM_MODEL are required for the live eval",
    );

  const scores = [];
  for (const testCase of selectedCases) {
    const started = performance.now();
    try {
      const plan = await planAgentRequest(testCase.input, testCase.actor);
      scores.push(
        scorePlanCase(testCase, plan, {
          latencyMs: Math.round(performance.now() - started),
          totalTokens: plan.usage?.totalTokens,
        }),
      );
    } catch (error) {
      scores.push(
        scorePlanCase(
          testCase,
          {},
          {
            latencyMs: Math.round(performance.now() - started),
            error: error.message,
          },
        ),
      );
    }
  }

  const summary = aggregatePlanScores(scores);
  const budgets = {
    passRate: summary.passRate >= thresholds.minimumPassRate,
    toolF1: summary.toolF1 >= thresholds.minimumToolF1,
    argumentExactMatch:
      summary.argumentExactMatch >= thresholds.minimumArgumentExactMatch,
    safetyComplianceRate:
      summary.safetyComplianceRate >= thresholds.minimumSafetyComplianceRate,
    p95LatencyMs: summary.latencyMs.p95 <= thresholds.maximumP95LatencyMs,
    totalTokens: summary.tokenUsage.total <= thresholds.maximumTotalTokens,
  };
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "live-planner",
    model: process.env.LLM_MODEL,
    callBudget: {
      configuredMaximum: maxCases,
      callsMade: selectedCases.length,
    },
    thresholds,
    budgets,
    summary,
    cases: scores,
  };
  const resultsDir = path.resolve(__dirname, "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, "live-latest.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report.summary, null, 2));
  if (
    scores.some((score) => score.observed.error) ||
    Object.values(budgets).includes(false)
  )
    process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

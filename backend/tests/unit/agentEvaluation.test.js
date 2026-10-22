const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAgentMessages } = require('../../src/services/agent/evaluation');

test('agent evaluation aggregates workflow outcomes, tools, timing, and errors', () => {
  const messages = [
    { role: 'assistant', planner: {
      intent: 'command', approvalStatus: 'executed', requestedAt: '2026-09-05T20:00:00.000Z',
      planningLatencyMs: 400, usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      todo: [{ id: 'a' }, { id: 'b' }], execution: { completedAt: '2026-09-05T20:00:02.000Z', steps: [{ status: 'executed' }, { status: 'executed' }] },
    } },
    { role: 'assistant', planner: {
      intent: 'command', approvalStatus: 'failed', requestedAt: '2026-09-05T20:01:00.000Z', handoff: { requestedAt: '2026-09-05T20:01:03.000Z' },
      planningLatencyMs: 900, usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
      todo: [{ id: 'c' }], execution: { completedAt: '2026-09-05T20:01:03.000Z', steps: [{ status: 'failed', errorType: 'not_found' }] },
    } },
    { role: 'assistant', planner: { intent: 'conversation' } },
  ];
  const report = evaluateAgentMessages(messages);
  assert.deepEqual(report.sample, { commandPlans: 2, terminalPlans: 2, executedSteps: 2, attemptedSteps: 3 });
  assert.equal(report.metrics.taskSuccessRate, 0.5);
  assert.equal(report.metrics.toolSuccessRate, 0.6667);
  assert.equal(report.metrics.humanTakeoverRate, 0.5);
  assert.equal(report.metrics.humanInterventionRequiredRate, 0.5);
  assert.equal(report.metrics.averageSteps, 1.5);
  assert.equal(report.metrics.averageEndToEndMs, 2500);
  assert.deepEqual(report.metrics.latencyMs.planning, { samples: 2, average: 650, p50: 400, p95: 900, p99: 900 });
  assert.deepEqual(report.metrics.latencyMs.endToEnd, { samples: 2, average: 2500, p50: 2000, p95: 3000, p99: 3000 });
  assert.deepEqual(report.metrics.tokenUsage, { sampledPlans: 2, promptTokens: 180, completionTokens: 50, totalTokens: 230, averageTotalTokens: 115 });
  assert.equal(report.metrics.errorTypes.not_found, 1);
});

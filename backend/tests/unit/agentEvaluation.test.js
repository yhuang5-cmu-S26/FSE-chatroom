const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAgentMessages } = require('../../src/services/agent/evaluation');

test('agent evaluation aggregates workflow outcomes, tools, timing, and errors', () => {
  const messages = [
    { role: 'assistant', planner: {
      intent: 'command', approvalStatus: 'executed', requestedAt: '2026-09-05T20:00:00.000Z',
      todo: [{ id: 'a' }, { id: 'b' }], execution: { completedAt: '2026-09-05T20:00:02.000Z', steps: [{ status: 'executed' }, { status: 'executed' }] },
    } },
    { role: 'assistant', planner: {
      intent: 'command', approvalStatus: 'failed', requestedAt: '2026-09-05T20:01:00.000Z', handoff: { requestedAt: '2026-09-05T20:01:03.000Z' },
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
  assert.equal(report.metrics.errorTypes.not_found, 1);
});

/** Normalizes persisted timestamps before Agent observability metrics are calculated. */
function asDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/** Maps execution failures to stable categories for the Agent evaluation dashboard. */
function classifyError(error = '') {
  const text = String(error).toLowerCase();
  if (/forbidden|permission|权限|admin/.test(text)) return 'authorization';
  if (/invalid|schema|参数/.test(text)) return 'validation';
  if (/not found|不存在/.test(text)) return 'not_found';
  return 'tool_failure';
}

/** Produces a safe, rounded metric ratio for Agent workflow reporting. */
function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

/** Uses nearest-rank percentiles so dashboard values are easy to reproduce. */
function percentile(values, percentage) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1);
  return sorted[rank];
}

function average(values) {
  const samples = values.filter(Number.isFinite);
  return samples.length
    ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length)
    : null;
}

/** Aggregates plan, execution, handoff, latency, and error metrics. Feature: Agent reliability evaluation. */
function evaluateAgentMessages(messages) {
  const plans = (Array.isArray(messages) ? messages : [])
    .map((message) => message.toObject?.() || message)
    .filter((message) => message?.role === 'assistant' && message?.planner?.intent === 'command');
  const terminalPlans = plans.filter((message) => ['executed', 'failed', 'rejected', 'handed_off'].includes(message.planner.approvalStatus));
  const succeeded = plans.filter((message) => message.planner.approvalStatus === 'executed');
  const handedOff = plans.filter((message) => message.planner.handoff?.requestedAt);
  const interventionRequired = plans.filter((message) => ['failed', 'rejected', 'handed_off'].includes(message.planner.approvalStatus));
  const steps = plans.flatMap((message) => message.planner.execution?.steps || []);
  const successfulSteps = steps.filter((step) => step.status === 'executed');
  const errorTypes = {};
  for (const message of plans) {
    if (message.planner.approvalStatus === 'rejected') {
      const reason = (message.planner.todo || []).map((step) => step.rejectionReason).filter(Boolean).join(' ');
      const type = classifyError(reason || 'unsupported plan');
      errorTypes[type] = (errorTypes[type] || 0) + 1;
    }
    for (const step of message.planner.execution?.steps || []) {
      if (step.status === 'failed') {
        const type = step.errorType || classifyError(step.error);
        errorTypes[type] = (errorTypes[type] || 0) + 1;
      }
    }
  }
  const durations = plans.flatMap((message) => {
    const requestedAt = asDate(message.planner.requestedAt);
    const completedAt = asDate(message.planner.execution?.completedAt);
    return requestedAt && completedAt ? [completedAt.getTime() - requestedAt.getTime()] : [];
  }).filter((value) => value >= 0);
  const planningDurations = plans
    .map((message) => Number(message.planner.planningLatencyMs))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const usageSamples = plans
    .map((message) => message.planner.usage)
    .filter((usage) =>
      [usage?.promptTokens, usage?.completionTokens, usage?.totalTokens].every(
        (value) => Number.isFinite(Number(value)) && Number(value) >= 0,
      ),
    );
  const tokenUsage = usageSamples.reduce(
    (totals, usage) => ({
      promptTokens: totals.promptTokens + Number(usage.promptTokens),
      completionTokens:
        totals.completionTokens + Number(usage.completionTokens),
      totalTokens: totals.totalTokens + Number(usage.totalTokens),
    }),
    { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  );
  const totalSteps = plans.reduce((total, message) => total + (message.planner.todo || []).length, 0);
  return {
    generatedAt: new Date().toISOString(),
    sample: { commandPlans: plans.length, terminalPlans: terminalPlans.length, executedSteps: successfulSteps.length, attemptedSteps: steps.length },
    metrics: {
      taskSuccessRate: ratio(succeeded.length, terminalPlans.length),
      toolSuccessRate: ratio(successfulSteps.length, steps.length),
      humanTakeoverRate: ratio(handedOff.length, plans.length),
      humanInterventionRequiredRate: ratio(interventionRequired.length, plans.length),
      averageSteps: plans.length ? Number((totalSteps / plans.length).toFixed(2)) : null,
      averageEndToEndMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
      latencyMs: {
        planning: {
          samples: planningDurations.length,
          average: average(planningDurations),
          p50: percentile(planningDurations, 50),
          p95: percentile(planningDurations, 95),
          p99: percentile(planningDurations, 99),
        },
        endToEnd: {
          samples: durations.length,
          average: average(durations),
          p50: percentile(durations, 50),
          p95: percentile(durations, 95),
          p99: percentile(durations, 99),
        },
      },
      tokenUsage: {
        sampledPlans: usageSamples.length,
        ...tokenUsage,
        averageTotalTokens: usageSamples.length
          ? Math.round(tokenUsage.totalTokens / usageSamples.length)
          : null,
      },
      errorTypes,
    },
  };
}

module.exports = { evaluateAgentMessages, classifyError, percentile };

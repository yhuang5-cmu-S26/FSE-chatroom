function asDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function classifyError(error = '') {
  const text = String(error).toLowerCase();
  if (/forbidden|permission|权限|admin/.test(text)) return 'authorization';
  if (/invalid|schema|参数/.test(text)) return 'validation';
  if (/not found|不存在/.test(text)) return 'not_found';
  return 'tool_failure';
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

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
      errorTypes,
    },
  };
}

module.exports = { evaluateAgentMessages, classifyError };

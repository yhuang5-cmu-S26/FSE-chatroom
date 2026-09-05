// Reserved boundary for a future conversational agent. It must submit a
// structured action and passes through the same RBAC policy as a human user.
const actionDefinitions = {
  'post.missing-checkins': { requiredRole: 'admin', input: ['checkinId'] },
};
function describeActions() { return actionDefinitions; }
async function executeAgentAction() { throw new Error('Agent action execution is not enabled yet'); }
module.exports = { describeActions, executeAgentAction };

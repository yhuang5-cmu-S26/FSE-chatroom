const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer, login } = require('../helpers/testServer');

let app;
test.before(async () => { app = await startTestServer(); });
test.after(async () => { await app.close(); fs.rmSync(app.dataDir, { recursive: true, force: true }); });

async function request(pathname, token, options = {}) {
  return fetch(`${app.baseUrl}${pathname}`, { ...options, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
}

test('unified auth logs in existing users and creates all default relationships', async () => {
  const existing = await login(app.baseUrl, 'Demo User', 'user1234');
  assert.equal(existing.created, false);
  const existingWithIgnoredEmail = await request('/api/auth/enter', '', { method: 'POST', body: JSON.stringify({ name: 'Demo User', email: 'ignored@example.com', password: 'user1234' }) });
  assert.equal(existingWithIgnoredEmail.status, 200);
  assert.equal((await existingWithIgnoredEmail.json()).created, false);
  const missingEmail = await request('/api/auth/enter', '', { method: 'POST', body: JSON.stringify({ name: 'Needs Email', password: 'newpass1' }) });
  assert.equal(missingEmail.status, 400);
  const response = await request('/api/auth/enter', '', { method: 'POST', body: JSON.stringify({ name: 'New User', email: 'new@example.com', password: 'newpass1' }) });
  assert.equal(response.status, 201);
  const relationships = JSON.parse(fs.readFileSync(path.join(app.dataDir, 'relationships.json')));
  assert.equal(relationships.length, 3);
});

test('RBAC blocks users and allows admins to publish check-in tasks', async () => {
  const user = await login(app.baseUrl, 'Demo User', 'user1234');
  const admin = await login(app.baseUrl, 'Admin', 'admin123');
  const body = JSON.stringify({ title: 'Assembly check', assigneeIds: [user.user.id] });
  assert.equal((await request('/api/checkins', user.token, { method: 'POST', body })).status, 403);
  assert.equal((await request('/api/checkins', admin.token, { method: 'POST', body })).status, 201);
});

test('authenticated users can create posts', async () => {
  const user = await login(app.baseUrl, 'Demo User', 'user1234');
  const response = await request('/api/posts', user.token, { method: 'POST', body: JSON.stringify({ content: 'status update' }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).authorName, 'Demo User');
});

test('agent conversations persist by user and return server-owned history', async () => {
  const user = await login(app.baseUrl, 'Demo User', 'user1234');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${user.token}` };
  const initial = await fetch(`${app.baseUrl}/api/agent/chat`, { method: 'POST', headers, body: JSON.stringify({ message: '' }) });
  const initialBody = await initial.json();
  assert.equal(initial.status, 200);
  assert.equal(initialBody.messages.length, 1);
  const followUp = await fetch(`${app.baseUrl}/api/agent/chat`, { method: 'POST', headers, body: JSON.stringify({ sessionId: initialBody.session.id, message: '总结当前状态' }) });
  assert.equal(followUp.status, 200);
  const history = await fetch(`${app.baseUrl}/api/agent/sessions/${initialBody.session.id}/messages`, { headers });
  assert.equal((await history.json()).messages.length, 3);
});

test('owners can delete an agent session and all completed workflow records', async () => {
  const user = await login(app.baseUrl, 'Demo User', 'user1234');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${user.token}` };
  const initial = await fetch(`${app.baseUrl}/api/agent/chat`, { method: 'POST', headers, body: JSON.stringify({ message: '' }) });
  const { session } = await initial.json();
  const AgentMessage = require('../../src/models/AgentMessage');
  const WorkflowRun = require('../../src/models/WorkflowRun');
  const WorkflowStep = require('../../src/models/WorkflowStep');
  const ToolCall = require('../../src/models/ToolCall');
  const Approval = require('../../src/models/Approval');
  const WorkflowEvent = require('../../src/models/WorkflowEvent');
  const message = await AgentMessage.create({ sessionId: session.id, userId: user.user.id, role: 'assistant', content: '已完成。' });
  const run = await WorkflowRun.create({ sessionId: session.id, userId: user.user.id, messageId: message.id, state: 'succeeded', requestedAt: new Date(), completedAt: new Date(), stepCount: 1 });
  const step = await WorkflowStep.create({ runId: run.id, userId: user.user.id, sequence: 0, title: '测试步骤', action: { type: 'post.draft', arguments: {} }, state: 'succeeded' });
  await Promise.all([
    ToolCall.create({ runId: run.id, stepId: step.id, userId: user.user.id, actionType: 'post.draft', input: {}, state: 'succeeded', startedAt: new Date() }),
    Approval.create({ runId: run.id, messageId: message.id, userId: user.user.id, decision: 'approved', decidedAt: new Date() }),
    WorkflowEvent.create({ runId: run.id, userId: user.user.id, type: 'run.succeeded', payload: {}, occurredAt: new Date() }),
  ]);
  const deleted = await fetch(`${app.baseUrl}/api/agent/sessions/${session.id}`, { method: 'DELETE', headers });
  assert.equal(deleted.status, 204);
  assert.equal((await fetch(`${app.baseUrl}/api/agent/sessions/${session.id}/messages`, { headers })).status, 404);
  assert.equal((await WorkflowRun.find({ sessionId: session.id }).lean()).length, 0);
  assert.equal((await WorkflowStep.find({ runId: run.id }).lean()).length, 0);
  assert.equal((await ToolCall.find({ runId: run.id }).lean()).length, 0);
  assert.equal((await Approval.find({ runId: run.id }).lean()).length, 0);
  assert.equal((await WorkflowEvent.find({ runId: run.id }).lean()).length, 0);
});

test('agent command plans execute only after their owner approves them', async () => {
  const user = await login(app.baseUrl, 'Demo User', 'user1234');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${user.token}` };
  const initial = await fetch(`${app.baseUrl}/api/agent/chat`, { method: 'POST', headers, body: JSON.stringify({ message: '' }) });
  const initialBody = await initial.json();
  // Persist a validated planner result, so this test covers the approval boundary
  // without relying on an external LLM provider.
  const AgentMessage = require('../../src/models/AgentMessage');
  const plan = await AgentMessage.create({
    sessionId: initialBody.session.id,
    userId: user.user.id,
    role: 'assistant',
    content: '我可以先生成一份寻人帖草稿。',
    planner: {
      mode: 'llm-plan', intent: 'command',
      todo: [{ id: 'draft', title: '生成寻人帖草稿', action: { type: 'post.draft', arguments: { topic: '失联人员' } }, status: 'planned', requiresConfirmation: false }],
      coverage: { canCover: true, reason: '能力可覆盖。', unsupported: [] },
      requiresConfirmation: false, approvalStatus: 'pending',
    },
  });
  const response = await fetch(`${app.baseUrl}/api/agent/sessions/${initialBody.session.id}/approve`, {
    method: 'POST', headers, body: JSON.stringify({ messageId: plan.id }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.message.planner.approvalStatus, 'executed');
  assert.equal(body.message.planner.execution.steps[0].status, 'executed');
  const workflow = await fetch(`${app.baseUrl}/api/agent/runs/${body.message.planner.runId}`, { headers });
  const workflowBody = await workflow.json();
  assert.equal(workflow.status, 200);
  assert.equal(workflowBody.run.state, 'succeeded');
  assert.equal(workflowBody.steps[0].state, 'succeeded');
  assert.equal(workflowBody.toolCalls[0].state, 'succeeded');
  assert.equal(workflowBody.approvals[0].decision, 'approved');
  assert.ok(workflowBody.events.some((event) => event.type === 'run.succeeded'));
  const duplicate = await fetch(`${app.baseUrl}/api/agent/sessions/${initialBody.session.id}/approve`, {
    method: 'POST', headers, body: JSON.stringify({ messageId: plan.id }),
  });
  assert.equal(duplicate.status, 409);
});

test('post publishing pauses for human review and resumes with edited content', async () => {
  const admin = await login(app.baseUrl, 'Admin', 'admin123');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${admin.token}` };
  const initial = await fetch(`${app.baseUrl}/api/agent/chat`, {
    method: 'POST', headers, body: JSON.stringify({ message: '' }),
  });
  const { session } = await initial.json();
  const AgentMessage = require('../../src/models/AgentMessage');
  const Post = require('../../src/models/Post');
  const plan = await AgentMessage.create({
    sessionId: session.id,
    userId: admin.user.id,
    role: 'assistant',
    content: '发布前将暂停并等待最终正文确认。',
    planner: {
      mode: 'llm-plan', intent: 'command',
      todo: [{ id: 'publish', title: '发布通知', action: { type: 'post.publish', arguments: { content: '原文：南门集合。' } }, status: 'planned', requiresConfirmation: true }],
      coverage: { canCover: true, reason: '管理员可以发布。', unsupported: [] },
      requiresConfirmation: true, approvalStatus: 'pending',
    },
  });

  const approval = await fetch(`${app.baseUrl}/api/agent/sessions/${session.id}/approve`, {
    method: 'POST', headers, body: JSON.stringify({ messageId: plan.id }),
  });
  const paused = await approval.json();
  assert.equal(approval.status, 200);
  assert.equal(paused.message.planner.approvalStatus, 'awaiting_input');
  assert.equal(paused.interrupt.value.kind, 'tool_approval');
  assert.equal(paused.interrupt.value.actionType, 'post.publish');
  assert.equal(paused.interrupt.value.riskLevel, 'high');
  assert.equal((await Post.find({ content: '原文：南门集合。' }).lean()).length, 0);

  const resumedResponse = await fetch(
    `${app.baseUrl}/api/agent/sessions/${session.id}/runs/${paused.message.planner.runId}/resume`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        interruptId: paused.interrupt.id,
        reply: '修改后：北门集合。',
      }),
    },
  );
  const resumed = await resumedResponse.json();
  assert.equal(resumedResponse.status, 200);
  assert.equal(resumed.interrupt, null);
  assert.equal(resumed.message.planner.approvalStatus, 'executed');
  assert.equal((await Post.find({ content: '修改后：北门集合。' }).lean()).length, 1);
});

test('approved check-in lookup reports a persisted failure when the task does not exist', async () => {
  const user = await login(app.baseUrl, 'Demo User', 'user1234');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${user.token}` };
  const initial = await fetch(`${app.baseUrl}/api/agent/chat`, { method: 'POST', headers, body: JSON.stringify({ message: '' }) });
  const { session } = await initial.json();
  const AgentMessage = require('../../src/models/AgentMessage');
  const plan = await AgentMessage.create({
    sessionId: session.id, userId: user.user.id, role: 'assistant', content: '我会查询任务 A。',
    planner: {
      mode: 'llm-plan', intent: 'command', approvalStatus: 'pending',
      todo: [{ id: 'lookup', title: '查询任务 A 未签到人员', action: { type: 'checkin.list_absentees', arguments: { checkinId: 'A' } }, status: 'planned' }],
      coverage: { canCover: true, reason: '能力可覆盖。', unsupported: [] },
    },
  });
  const response = await fetch(`${app.baseUrl}/api/agent/sessions/${session.id}/approve`, {
    method: 'POST', headers, body: JSON.stringify({ messageId: plan.id }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.message.planner.approvalStatus, 'failed');
  assert.equal(body.message.planner.execution.steps[0].status, 'failed');
  assert.match(body.message.planner.execution.steps[0].error, /签到任务“A”不存在/);
});

test('agent eval is admin-only and records an explicit human handoff', async () => {
  const user = await login(app.baseUrl, 'Demo User', 'user1234');
  const admin = await login(app.baseUrl, 'Admin', 'admin123');
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${user.token}` };
  const initial = await fetch(`${app.baseUrl}/api/agent/chat`, { method: 'POST', headers, body: JSON.stringify({ message: '' }) });
  const initialBody = await initial.json();
  const AgentMessage = require('../../src/models/AgentMessage');
  const plan = await AgentMessage.create({
    sessionId: initialBody.session.id, userId: user.user.id, role: 'assistant', content: '需要人工确认。',
    planner: {
      mode: 'llm-plan', intent: 'command', requestedAt: new Date(), approvalStatus: 'pending',
      todo: [{ id: 'publish', title: '发布通知', action: { type: 'post.publish', arguments: { content: '公告' } }, status: 'planned' }],
      coverage: { canCover: true, reason: '能力可覆盖。', unsupported: [] },
    },
  });
  const handoff = await fetch(`${app.baseUrl}/api/agent/sessions/${initialBody.session.id}/handoff`, {
    method: 'POST', headers, body: JSON.stringify({ messageId: plan.id, reason: '由现场调度员接手' }),
  });
  assert.equal(handoff.status, 200);
  assert.equal((await handoff.json()).message.planner.approvalStatus, 'handed_off');
  assert.equal((await request('/api/agent/evals/summary', user.token)).status, 403);
  const reportResponse = await request('/api/agent/evals/summary', admin.token);
  const report = await reportResponse.json();
  assert.equal(reportResponse.status, 200);
  assert.ok(report.metrics.humanTakeoverRate > 0);
});

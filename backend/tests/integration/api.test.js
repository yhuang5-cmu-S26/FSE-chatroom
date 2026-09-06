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
  const duplicate = await fetch(`${app.baseUrl}/api/agent/sessions/${initialBody.session.id}/approve`, {
    method: 'POST', headers, body: JSON.stringify({ messageId: plan.id }),
  });
  assert.equal(duplicate.status, 409);
});

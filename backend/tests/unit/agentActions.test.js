const test = require('node:test');
const assert = require('node:assert/strict');
const { describeActions, planAgentRequest, executeAgentAction } = require('../../src/services/agentActions');
const { getAgentPrompts } = require('../../src/services/promptRegistry');
const { execute: executeTool } = require('../../src/services/agentTools');

test('agent action contract loads action permissions from the Markdown manifest', async () => {
  const actions = await describeActions();
  assert.equal(actions.find((action) => action.action === 'post.publish').requiredRole, 'admin');
});

test('capability manifest, tool contract, and runtime handlers stay in sync', async () => {
  const config = await getAgentPrompts();
  assert.deepEqual([...config.capabilityByAction.keys()].sort(), [...config.toolByAction.keys()].sort());
});

test('validated read-only agent actions can execute through the tool registry', async () => {
  const result = await executeAgentAction({ type: 'post.draft', arguments: { topic: '寻人通知' } }, { role: 'user' });
  assert.match(result.data.draft, /寻人通知/);
});

test('post publishing is idempotent across a retried workflow step', async () => {
  const posts = [];
  const postModel = {
    findOne: async ({ agentIdempotencyKey }) => posts.find((post) => post.agentIdempotencyKey === agentIdempotencyKey) || null,
    create: async (input) => {
      const post = { ...input, id: `post-${posts.length + 1}`, toObject: () => ({ ...post }) };
      posts.push(post);
      return post;
    },
  };
  let broadcasts = 0;
  const action = { type: 'post.publish', arguments: { content: '寻人通知' } };
  const context = { idempotencyKey: 'run-1:step-2', postModel, io: { emit: () => { broadcasts += 1; } } };
  await executeTool(action, { id: 'admin', name: 'Admin' }, context);
  const retry = await executeTool(action, { id: 'admin', name: 'Admin' }, context);
  assert.equal(posts.length, 1);
  assert.equal(broadcasts, 1);
  assert.equal(retry.data.idempotent, true);
});

test('streaming planner forwards reply deltas then validates the final plan', async () => {
  const { planAgentRequestStream } = require('../../src/services/agentActions');
  const original = { url: process.env.LLM_API_URL, key: process.env.LLM_API_KEY, model: process.env.LLM_MODEL };
  process.env.LLM_API_URL = 'https://llm.example.test/chat/completions'; process.env.LLM_API_KEY = 'test-key'; process.env.LLM_MODEL = 'test-model';
  const payload = JSON.stringify({ intent: 'conversation', reply: '你好，已收到。', todo: [], coverage: { canCover: true, reason: '普通对话。', unsupported: [] } });
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: payload.slice(0, 35) } }] })}\n\n`));
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: payload.slice(35) } }] })}\n\ndata: [DONE]\n\n`));
    controller.close();
  } });
  const deltas = [];
  const result = await planAgentRequestStream('你好', { role: 'user' }, { fetchImpl: async () => new Response(stream, { status: 200 }), onDelta: (text) => deltas.push(text) });
  process.env.LLM_API_URL = original.url; process.env.LLM_API_KEY = original.key; process.env.LLM_MODEL = original.model;
  assert.equal(result.intent, 'conversation');
  assert.equal(deltas.join(''), '你好，已收到。');
});

test('empty agent input returns the capability overview without calling an LLM', async () => {
  const plan = await planAgentRequest('', { name: 'Admin', role: 'admin' }, { fetchImpl: async () => { throw new Error('should not call LLM'); } });
  assert.equal(plan.mode, 'capability-overview');
  assert.equal(plan.capabilities.length, 4);
});

test('agent planner validates remote LLM todo output before returning it', async () => {
  const original = { url: process.env.LLM_API_URL, key: process.env.LLM_API_KEY, model: process.env.LLM_MODEL };
  process.env.LLM_API_URL = 'https://llm.example.test/chat/completions';
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_MODEL = 'test-model';
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    intent: 'command', reply: '我会先查询未签到人员，再准备帖子。',
    todo: [
      { id: 'one', title: '查询任务 A 未签到人员', action: { type: 'checkin.list_absentees', arguments: { checkinId: 'A' } } },
      { id: 'two', title: '生成寻人帖草稿', action: { type: 'post.draft', arguments: { topic: '寻找未签到人员' } } },
      { id: 'three', title: '发布寻人帖', action: { type: 'post.publish', arguments: { content: '请联系调度员。' } } },
    ],
    coverage: { canCover: true, reason: '所有步骤都有对应能力。', unsupported: [] },
  }) } }] }), { status: 200 });
  const plan = await planAgentRequest('根据未签到人员发布寻人帖', { role: 'admin' }, { fetchImpl });
  process.env.LLM_API_URL = original.url;
  process.env.LLM_API_KEY = original.key;
  process.env.LLM_MODEL = original.model;
  assert.equal(plan.requiresConfirmation, true);
  assert.equal(plan.coverage.canCover, true);
  assert.deepEqual(plan.todo.map((step) => step.action.type), ['checkin.list_absentees', 'post.draft', 'post.publish']);
});

test('restricted actions are rejected even if the LLM claims they are covered', async () => {
  const original = { url: process.env.LLM_API_URL, key: process.env.LLM_API_KEY, model: process.env.LLM_MODEL };
  process.env.LLM_API_URL = 'https://llm.example.test/chat/completions'; process.env.LLM_API_KEY = 'test-key'; process.env.LLM_MODEL = 'test-model';
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    intent: 'command', reply: '计划如下。', todo: [{ id: 'one', title: '发布帖子', action: { type: 'post.publish', arguments: { content: '公告' } } }],
    coverage: { canCover: true, reason: '模型声称可以执行。', unsupported: [] },
  }) } }] }), { status: 200 });
  const plan = await planAgentRequest('发布公告', { role: 'user' }, { fetchImpl });
  process.env.LLM_API_URL = original.url; process.env.LLM_API_KEY = original.key; process.env.LLM_MODEL = original.model;
  assert.equal(plan.coverage.canCover, false);
  assert.equal(plan.todo[0].status, 'rejected');
  assert.match(plan.todo[0].rejectionReason, /admin/);
});

test('invalid JSON Action protocol is rejected before action authorization', async () => {
  const original = { url: process.env.LLM_API_URL, key: process.env.LLM_API_KEY, model: process.env.LLM_MODEL };
  process.env.LLM_API_URL = 'https://llm.example.test/chat/completions'; process.env.LLM_API_KEY = 'test-key'; process.env.LLM_MODEL = 'test-model';
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    intent: 'command', reply: '无效计划。', todo: [{ id: 'one', title: '缺少 arguments', action: { type: 'post.draft' } }],
    coverage: { canCover: true, reason: '无效。', unsupported: [] },
  }) } }] }), { status: 200 });
  await assert.rejects(planAgentRequest('写帖子', { role: 'admin' }, { fetchImpl }), /JSON Action protocol/);
  process.env.LLM_API_URL = original.url; process.env.LLM_API_KEY = original.key; process.env.LLM_MODEL = original.model;
});

test('conversation intent returns an answer without approval or actions', async () => {
  const original = { url: process.env.LLM_API_URL, key: process.env.LLM_API_KEY, model: process.env.LLM_MODEL };
  process.env.LLM_API_URL = 'https://llm.example.test/chat/completions'; process.env.LLM_API_KEY = 'test-key'; process.env.LLM_MODEL = 'test-model';
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    intent: 'conversation', reply: '你好，有什么可以协助？', todo: [], coverage: { canCover: true, reason: '这是普通对话。', unsupported: [] },
  }) } }] }), { status: 200 });
  const result = await planAgentRequest('你好', { role: 'user' }, { fetchImpl });
  process.env.LLM_API_URL = original.url; process.env.LLM_API_KEY = original.key; process.env.LLM_MODEL = original.model;
  assert.equal(result.intent, 'conversation');
  assert.equal(result.todo.length, 0);
  assert.equal(result.requiresConfirmation, false);
});

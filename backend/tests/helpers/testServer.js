const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const USERS = [
  { _id: '000000000000000000000001', name: 'Admin', usernameKey: 'admin', email: 'admin@example.com', passwordHash: '$2a$10$rrOv6iAzWt9yexR3zIaMIus0Ve0yWqHSalHG.WKV3PzbEXQm/LU2.', role: 'admin', active: true },
  { _id: '000000000000000000000002', name: 'Demo User', usernameKey: 'demo user', email: 'user@example.com', passwordHash: '$2a$10$uyl5bK8J438poC9WXHR7hOacqB12YPKlB2xTwthVecvaPtlpgEhHm', role: 'user', active: true },
];

function seedStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fse-chatroom-test-'));
  const now = new Date().toISOString();
  const users = USERS.map((user) => ({ ...user, createdAt: now, updatedAt: now }));
  const relationship = { _id: '000000000000000000000101', userLow: USERS[0]._id, userHigh: USERS[1]._id, status: 'accepted', createdAt: now, updatedAt: now };
  const collections = { users, relationships: [relationship], messages: [], groups: [], posts: [], checkins: [], 'speed-tests': [] };
  for (const [name, rows] of Object.entries(collections)) fs.writeFileSync(path.join(directory, `${name}.json`), `${JSON.stringify(rows)}\n`);
  return directory;
}

async function startTestServer() {
  process.env.DB_DRIVER = 'json';
  process.env.JSON_DATA_DIR = seedStore();
  process.env.LLM_SESSION_DATA_DIR = path.join(process.env.JSON_DATA_DIR, 'llm-session');
  process.env.AGENT_SESSION_DATA_DIR = process.env.LLM_SESSION_DATA_DIR;
  process.env.WORKFLOW_DATA_DIR = path.join(process.env.JSON_DATA_DIR, 'workflow-data');
  process.env.JWT_SECRET = 'test-secret-at-least-32-characters';
  const { startServer } = require('../../src/server');
  const instance = await startServer({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${instance.server.address().port}`;
  return { ...instance, baseUrl, dataDir: process.env.JSON_DATA_DIR, close: () => new Promise((resolve) => instance.io.close(resolve)) };
}

async function login(baseUrl, name, password) {
  const response = await fetch(`${baseUrl}/api/auth/enter`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, password }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'login failed');
  return body;
}

module.exports = { startTestServer, login };

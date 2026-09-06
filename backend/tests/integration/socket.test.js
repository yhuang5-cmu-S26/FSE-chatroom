const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { io } = require('socket.io-client');
const { startTestServer, login } = require('../helpers/testServer');

let app;
test.before(async () => { app = await startTestServer(); });
test.after(async () => { await app.close(); fs.rmSync(app.dataDir, { recursive: true, force: true }); });

const connect = async (token) => new Promise((resolve, reject) => {
  const socket = io(app.baseUrl, { transports: ['websocket'], auth: { token }, forceNew: true });
  socket.once('app:bootstrap', () => resolve(socket));
  socket.once('connect_error', reject);
});
const ack = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));

test('public and related private chats persist and broadcast server-owned identity', async () => {
  const adminAuth = await login(app.baseUrl, 'Admin', 'admin123');
  const userAuth = await login(app.baseUrl, 'Demo User', 'user1234');
  const admin = await connect(adminAuth.token); const user = await connect(userAuth.token);
  assert.equal((await ack(admin, 'chat:open', { mode: 'private', targetId: userAuth.user.id })).ok, true);
  assert.equal((await ack(user, 'chat:open', { mode: 'private', targetId: adminAuth.user.id })).ok, true);
  const delivered = new Promise((resolve) => user.once('chat:message', resolve));
  const sent = await ack(admin, 'chat:send', { mode: 'private', targetId: userAuth.user.id, message: 'hello', sender: 'forged' });
  assert.equal(sent.ok, true);
  assert.equal((await delivered).sender, 'Admin');
  admin.close(); user.close();
});

test('private chat rejects users without a relationship', async () => {
  const response = await fetch(`${app.baseUrl}/api/auth/enter`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Third', email: 'third@example.com', password: 'thirdpass' }) });
  const thirdAuth = await response.json();
  const rows = JSON.parse(fs.readFileSync(`${app.dataDir}/relationships.json`));
  fs.writeFileSync(`${app.dataDir}/relationships.json`, JSON.stringify(rows.filter((row) => ![row.userLow, row.userHigh].includes(thirdAuth.user.id))));
  const third = await connect(thirdAuth.token);
  assert.equal((await ack(third, 'chat:open', { mode: 'private', targetId: '000000000000000000000001' })).ok, false);
  third.close();
});

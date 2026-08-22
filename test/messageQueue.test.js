const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageQueue } = require('../src/messaging/messageQueue');

test('MessageQueue processes tasks asynchronously', async () => {
  const queue = new MessageQueue({ maxQueueSize: 2 });
  const executed = [];

  await queue.enqueue(async () => executed.push('a'));
  await queue.enqueue(async () => executed.push('b'));

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(executed, ['a', 'b']);
});

test('MessageQueue applies backpressure when queue is full', async () => {
  const queue = new MessageQueue({ maxQueueSize: 1 });
  const blocker = () => new Promise(() => {});

  const first = await queue.enqueue(blocker);
  const second = await queue.enqueue(async () => {});

  assert.equal(first, true);
  assert.equal(second, false);
});

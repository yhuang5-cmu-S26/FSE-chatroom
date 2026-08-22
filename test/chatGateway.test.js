const test = require('node:test');
const assert = require('node:assert/strict');
const { bindChatGateway } = require('../src/messaging/chatGateway');

function buildSocket() {
  const handlers = new Map();
  return {
    handlers,
    join: () => {},
    on(event, handler) {
      handlers.set(event, handler);
    },
  };
}

test('bindChatGateway routes pubsub payloads to the proper room', () => {
  let emitted;
  let routedRoom;
  const io = {
    to(room) {
      routedRoom = room;
      return {
        emit(event, payload) {
          emitted = { event, payload };
        },
      };
    },
    on() {},
  };
  const pubsub = {
    subscribe(_channel, handler) {
      handler({ room: 'alpha', payload: { x: 1 } });
    },
  };

  bindChatGateway(io, { pubsub, queue: { enqueue: async () => true } });

  assert.equal(routedRoom, 'alpha');
  assert.deepEqual(emitted, { event: 'chat:message', payload: { x: 1 } });
});

test('bindChatGateway sends backpressure error when enqueue fails', async () => {
  let connectHandler;
  const io = {
    to() {
      return { emit() {} };
    },
    on(event, handler) {
      if (event === 'connection') {
        connectHandler = handler;
      }
    },
  };

  const queue = { enqueue: async () => false };
  const pubsub = { subscribe() {} };
  const socket = buildSocket();
  bindChatGateway(io, { pubsub, queue });

  connectHandler(socket);

  let callbackPayload;
  await socket.handlers.get('chat:group')(
    { roomId: 'r1', from: 'u1', content: 'need water' },
    (payload) => {
      callbackPayload = payload;
    },
  );

  assert.deepEqual(callbackPayload, { ok: false, error: 'backpressure' });
});

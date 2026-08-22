const { randomUUID } = require('node:crypto');

const CHANNEL = 'chat.dispatch';

function bindChatGateway(io, { pubsub, queue }) {
  pubsub.subscribe(CHANNEL, ({ room, payload }) => {
    io.to(room).emit('chat:message', payload);
  });

  io.on('connection', (socket) => {
    socket.on('room:join', (roomId) => {
      socket.join(roomId);
    });

    socket.on('chat:group', async (message, callback = () => {}) => {
      const accepted = await queue.enqueue(async () => {
        pubsub.publish(CHANNEL, {
          room: message.roomId,
          payload: {
            id: randomUUID(),
            type: 'group',
            from: message.from,
            roomId: message.roomId,
            content: message.content,
            ts: new Date().toISOString(),
          },
        });
      });

      callback(accepted ? { ok: true } : { ok: false, error: 'backpressure' });
    });

    socket.on('chat:private', async (message, callback = () => {}) => {
      const accepted = await queue.enqueue(async () => {
        const room = [message.from, message.to].sort().join(':');
        pubsub.publish(CHANNEL, {
          room,
          payload: {
            id: randomUUID(),
            type: 'private',
            from: message.from,
            to: message.to,
            content: message.content,
            ts: new Date().toISOString(),
          },
        });
      });

      callback(accepted ? { ok: true } : { ok: false, error: 'backpressure' });
    });
  });
}

module.exports = { bindChatGateway, CHANNEL };

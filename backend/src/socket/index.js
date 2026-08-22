const ChatMessage = require('../models/ChatMessage');

function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    io.emit('system:message', {
      message: `${socket.id} connected`,
      timestamp: new Date().toISOString(),
    });

    socket.on('chat:send', async (payload = {}) => {
      try {
        const sender = typeof payload.sender === 'string' ? payload.sender.trim() : '';
        const message = typeof payload.message === 'string' ? payload.message.trim() : '';

        if (!sender || !message) {
          socket.emit('chat:error', { error: 'sender and message are required' });
          return;
        }

        const saved = await ChatMessage.create({ sender, message });
        io.emit('chat:broadcast', {
          id: saved.id,
          sender: saved.sender,
          message: saved.message,
          createdAt: saved.createdAt,
        });
      } catch (_error) {
        socket.emit('chat:error', { error: 'failed to deliver message' });
      }
    });

    socket.on('disconnect', () => {
      io.emit('system:message', {
        message: `${socket.id} disconnected`,
        timestamp: new Date().toISOString(),
      });
    });
  });
}

module.exports = registerSocketHandlers;

const { randomUUID } = require('node:crypto');
const ChatMessage = require('../models/ChatMessage');
const User = require('../models/User');
const { verifyToken } = require('../utils/jwt');

const onlineUsers = new Map();
const rateState = new Map();
const dedupeState = new Map();

const SEND_LIMIT = Number(process.env.SOCKET_SEND_LIMIT) || 20;
const SEND_WINDOW_MS = Number(process.env.SOCKET_SEND_WINDOW_MS) || 10000;
const DEDUPE_TTL_MS = Number(process.env.SOCKET_DEDUPE_TTL_MS) || 120000;

function makeId(length = 16) {
  return randomUUID().replace(/-/g, '').slice(0, length);
}

function safeText(value, maxLength = 120) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function normalizePublicRoom(room) {
  const name = safeText(room, 48).replace(/[^a-zA-Z0-9_-]/g, '');
  return `public:${name || 'lobby'}`;
}

function makePrivateRoom(userA, userB) {
  const ids = [safeText(userA, 48), safeText(userB, 48)].filter(Boolean).sort();
  return ids.length === 2 ? `private:${ids[0]}::${ids[1]}` : '';
}

function serializeOnlineUsers() {
  return Array.from(onlineUsers.values())
    .map((item) => ({
      userId: item.userId,
      displayName: item.displayName,
      role: item.role,
      sockets: item.socketIds.size,
      onlineAt: item.onlineAt,
      lastSeenAt: item.lastSeenAt,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function emitPresence(io) {
  io.emit('presence:update', { users: serializeOnlineUsers() });
}

function markOnline(io, socket) {
  const key = socket.data.userId;
  const now = new Date().toISOString();
  const existing = onlineUsers.get(key);

  if (existing) {
    existing.socketIds.add(socket.id);
    existing.lastSeenAt = now;
    existing.displayName = socket.data.displayName;
    existing.role = socket.data.role;
  } else {
    onlineUsers.set(key, {
      userId: key,
      displayName: socket.data.displayName,
      role: socket.data.role,
      socketIds: new Set([socket.id]),
      onlineAt: now,
      lastSeenAt: now,
    });
  }

  emitPresence(io);
}

function markOffline(io, socket) {
  const existing = onlineUsers.get(socket.data.userId);
  if (!existing) return;

  existing.socketIds.delete(socket.id);
  existing.lastSeenAt = new Date().toISOString();
  if (existing.socketIds.size === 0) {
    onlineUsers.delete(socket.data.userId);
  }

  emitPresence(io);
}

function checkRateLimit(socket) {
  const now = Date.now();
  const state = rateState.get(socket.id) || { count: 0, windowStart: now };

  if (now - state.windowStart >= SEND_WINDOW_MS) {
    state.count = 0;
    state.windowStart = now;
  }

  state.count += 1;
  rateState.set(socket.id, state);

  if (state.count > SEND_LIMIT) {
    return { ok: false, retryAfterMs: SEND_WINDOW_MS - (now - state.windowStart) };
  }

  return { ok: true, retryAfterMs: 0 };
}

function dedupeKey(socket, clientMessageId) {
  const cleaned = safeText(clientMessageId, 80);
  return cleaned ? `${socket.data.userId}:${cleaned}` : '';
}

function readDedupe(socket, clientMessageId) {
  const key = dedupeKey(socket, clientMessageId);
  if (!key) return null;

  const entry = dedupeState.get(key);
  if (!entry) return null;

  if (Date.now() - entry.createdAt > DEDUPE_TTL_MS) {
    dedupeState.delete(key);
    return null;
  }

  return entry;
}

function writeDedupe(socket, clientMessageId, value) {
  const key = dedupeKey(socket, clientMessageId);
  if (!key) return;
  dedupeState.set(key, { ...value, createdAt: Date.now() });
}

async function resolveSocketUser(socket) {
  const token = safeText(socket.handshake.auth?.token, 4096);
  if (!token) throw new Error('authentication required');

  const payload = verifyToken(token);
  const user = await User.findById(payload.sub);
  if (!user || !user.active) throw new Error('invalid user');

  return user;
}

async function sendMessage(io, job) {
  const saved = await ChatMessage.create({
    room: job.room,
    sender: job.sender,
    message: job.message,
    recipientId: job.recipientId || null,
    clientMessageId: job.clientMessageId || null,
  });

  io.to(job.room).emit('chat:broadcast', {
    id: saved.id,
    room: saved.room,
    sender: saved.sender,
    message: saved.message,
    recipientId: saved.recipientId,
    clientMessageId: saved.clientMessageId,
    createdAt: saved.createdAt,
  });

  if (job.fromSocketId) {
    io.to(job.fromSocketId).emit('chat:delivered', {
      room: saved.room,
      clientMessageId: saved.clientMessageId,
      serverMessageId: saved.id,
      createdAt: saved.createdAt,
    });
  }

  return saved;
}

function ackDuplicate(ack, duplicate, room, clientMessageId) {
  if (typeof ack !== 'function') return;
  ack({
    ok: true,
    duplicate: true,
    room,
    clientMessageId,
    serverMessageId: duplicate.serverMessageId,
  });
}

function ackRateLimited(socket, ack, limited, clientMessageId) {
  socket.emit('chat:error', {
    error: 'rate limit exceeded',
    retryAfterMs: limited.retryAfterMs,
    clientMessageId,
  });

  if (typeof ack === 'function') {
    ack({ ok: false, error: 'rate limit exceeded', retryAfterMs: limited.retryAfterMs });
  }
}

function registerSocketHandlers(io) {
  io.use(async (socket, next) => {
    try {
      const user = await resolveSocketUser(socket);
      socket.data.userId = user.id;
      socket.data.displayName = user.name;
      socket.data.role = user.role;
      socket.data.sessionId =
        safeText(socket.handshake.auth?.sessionId, 64) || `session:${user.id}:${socket.id}`;
      return next();
    } catch (_error) {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`session:${socket.data.sessionId}`);
    socket.join(`user:${socket.data.userId}`);
    socket.join('public:lobby');

    markOnline(io, socket);
    socket.emit('presence:update', { users: serializeOnlineUsers() });

    io.emit('system:message', {
      message: `${socket.data.displayName} connected`,
      timestamp: new Date().toISOString(),
    });

    socket.on('presence:list', (ack) => {
      if (typeof ack === 'function') ack({ ok: true, users: serializeOnlineUsers() });
    });

    socket.on('chat:join-room', async (payload = {}) => {
      try {
        const room = normalizePublicRoom(payload.room);
        socket.join(room);

        const limit = Number(payload.limit) > 0 ? Math.min(Number(payload.limit), 100) : 30;
        const history = await ChatMessage.find({ room }).sort({ createdAt: -1 }).limit(limit).lean();

        socket.emit('chat:room-joined', { room });
        socket.emit('chat:history', { room, messages: history.reverse() });
      } catch (_error) {
        socket.emit('chat:error', { error: 'failed to join room' });
      }
    });

    socket.on('chat:open-private', async (payload = {}) => {
      try {
        const peerId = safeText(payload.peerId, 64);
        const room = makePrivateRoom(socket.data.userId, peerId);
        if (!room) {
          socket.emit('chat:error', { error: 'valid peerId is required' });
          return;
        }

        socket.join(room);
        socket.emit('chat:private-room', { room, peerId });
        io.to(`user:${peerId}`).emit('chat:private-room', {
          room,
          peerId: socket.data.userId,
          from: socket.data.userId,
        });

        const history = await ChatMessage.find({ room }).sort({ createdAt: -1 }).limit(50).lean();
        socket.emit('chat:history', { room, messages: history.reverse() });
      } catch (_error) {
        socket.emit('chat:error', { error: 'failed to create private room' });
      }
    });

    socket.on('chat:history', async (payload = {}) => {
      try {
        const room = safeText(payload.room, 96);
        if (!room) {
          socket.emit('chat:error', { error: 'room is required' });
          return;
        }

        const limit = Number(payload.limit) > 0 ? Math.min(Number(payload.limit), 100) : 30;
        const history = await ChatMessage.find({ room }).sort({ createdAt: -1 }).limit(limit).lean();
        socket.emit('chat:history', { room, messages: history.reverse() });
      } catch (_error) {
        socket.emit('chat:error', { error: 'failed to load history' });
      }
    });

    socket.on('chat:send-room', async (payload = {}, ack) => {
      const message = safeText(payload.message, 400);
      const sender = safeText(payload.sender, 64) || socket.data.displayName;
      const room = normalizePublicRoom(payload.room);
      const clientMessageId = safeText(payload.clientMessageId, 80) || makeId(12);

      if (!message) {
        socket.emit('chat:error', { error: 'message is required' });
        if (typeof ack === 'function') ack({ ok: false, error: 'message is required' });
        return;
      }

      const limited = checkRateLimit(socket);
      if (!limited.ok) {
        ackRateLimited(socket, ack, limited, clientMessageId);
        return;
      }

      const duplicate = readDedupe(socket, clientMessageId);
      if (duplicate) {
        ackDuplicate(ack, duplicate, room, clientMessageId);
        return;
      }

      socket.join(room);
      const serverMessageId = makeId(16);
      writeDedupe(socket, clientMessageId, { serverMessageId, room });

      try {
        await sendMessage(io, {
          room,
          sender,
          message,
          fromSocketId: socket.id,
          clientMessageId,
        });

        if (typeof ack === 'function') {
          ack({ ok: true, queued: true, room, clientMessageId, serverMessageId });
        }
      } catch (_error) {
        socket.emit('chat:error', {
          error: 'failed to deliver message',
          clientMessageId,
        });
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'failed to deliver message' });
        }
      }
    });

    socket.on('chat:send-private', async (payload = {}, ack) => {
      const peerId = safeText(payload.peerId, 64);
      const message = safeText(payload.message, 400);
      const sender = safeText(payload.sender, 64) || socket.data.displayName;
      const room = makePrivateRoom(socket.data.userId, peerId);
      const clientMessageId = safeText(payload.clientMessageId, 80) || makeId(12);

      if (!room || !message) {
        socket.emit('chat:error', { error: 'peerId and message are required' });
        if (typeof ack === 'function') ack({ ok: false, error: 'peerId and message are required' });
        return;
      }

      const limited = checkRateLimit(socket);
      if (!limited.ok) {
        ackRateLimited(socket, ack, limited, clientMessageId);
        return;
      }

      const duplicate = readDedupe(socket, clientMessageId);
      if (duplicate) {
        ackDuplicate(ack, duplicate, room, clientMessageId);
        return;
      }

      socket.join(room);
      io.to(`user:${peerId}`).emit('chat:private-room', {
        room,
        peerId: socket.data.userId,
        from: socket.data.userId,
      });

      const serverMessageId = makeId(16);
      writeDedupe(socket, clientMessageId, { serverMessageId, room });

      try {
        await sendMessage(io, {
          room,
          sender,
          message,
          recipientId: peerId,
          fromSocketId: socket.id,
          clientMessageId,
        });

        if (typeof ack === 'function') {
          ack({ ok: true, queued: true, room, clientMessageId, serverMessageId });
        }
      } catch (_error) {
        socket.emit('chat:error', {
          error: 'failed to deliver message',
          clientMessageId,
        });
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'failed to deliver message' });
        }
      }
    });

    socket.on('disconnect', () => {
      markOffline(io, socket);
      rateState.delete(socket.id);
      io.emit('system:message', {
        message: `${socket.data.displayName} disconnected`,
        timestamp: new Date().toISOString(),
      });
    });
  });
}

module.exports = registerSocketHandlers;

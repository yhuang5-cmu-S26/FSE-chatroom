const ChatMessage = require('../models/ChatMessage');
const ChatGroup = require('../models/ChatGroup');
const Post = require('../models/Post');
const User = require('../models/User');
const UserCheckin = require('../models/UserCheckin');
const Relationship = require('../models/Relationship');
const { verifyToken } = require('../utils/jwt');
const online = new Map();
const clean = (v, max = 400) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const privateRoom = (a, b) => `private:${[a, b].sort().join(':')}`;
const groupRoom = (id) => `group:${id}`;
const publicRoom = 'public:lobby';
const usersPayload = () => [...online.values()];
const publishPresence = (io) => io.emit('presence:update', { users: usersPayload() });
async function canAccess(userId, mode, targetId) {
  if (mode === 'public') return { room: publicRoom };
  if (mode === 'private') {
    if (!targetId || targetId === userId) return null;
    const [low, high] = [userId, targetId].sort();
    if (!await Relationship.exists({ userLow: low, userHigh: high, status: 'accepted' })) return null;
    return { room: privateRoom(userId, targetId), recipientId: targetId };
  }
  if (mode === 'group' && await ChatGroup.exists({ _id: targetId, members: userId })) return { room: groupRoom(targetId) };
  return null;
}
function registerSocketHandlers(io) {
  io.use(async (socket, next) => {
    try { const token = clean(socket.handshake.auth?.token, 4096); const user = await User.findById(verifyToken(token).sub); if (!user?.active) throw Error(); socket.data.user = user; next(); }
    catch { next(new Error('unauthorized')); }
  });
  io.on('connection', async (socket) => {
    const user = socket.data.user; const id = String(user.id);
    online.set(id, { id, name: user.name, role: user.role, online: true }); socket.join(`user:${id}`); socket.join(publicRoom); publishPresence(io);
    const [relationships, allUsers, groups, posts, checkins] = await Promise.all([
      Relationship.find({ status: 'accepted' }).lean(),
      User.find().select('name role active').lean(),
      ChatGroup.find({ members: id }).lean(),
      Post.find().sort({ createdAt: -1 }).limit(100).lean(),
      UserCheckin.find().sort({ createdAt: -1 }).limit(100).lean(),
    ]);
    const contactIds = new Set();
    for (const relationship of relationships) {
      if (String(relationship.userLow) === id) contactIds.add(String(relationship.userHigh));
      if (String(relationship.userHigh) === id) contactIds.add(String(relationship.userLow));
    }
    const contacts = allUsers
      .filter((candidate) => candidate.active && contactIds.has(String(candidate._id)))
      .map((candidate) => ({ id: String(candidate._id), name: candidate.name, role: candidate.role, online: online.has(String(candidate._id)) }));
    socket.emit('app:bootstrap', { contacts, groups, posts, checkins });
    socket.on('chat:open', async ({ mode, targetId } = {}, ack) => {
      try { const access = await canAccess(id, clean(mode, 20), clean(targetId, 64)); if (!access) throw Error('forbidden'); socket.join(access.room); const messages = await ChatMessage.find({ room: access.room }).sort({ createdAt: -1 }).limit(50).lean(); ack?.({ ok: true, room: access.room, messages: messages.reverse() }); } catch { ack?.({ ok: false, error: 'chat access denied' }); }
    });
    socket.on('chat:send', async ({ mode, targetId, message, clientMessageId } = {}, ack) => {
      try {
        const access = await canAccess(id, clean(mode, 20), clean(targetId, 64)); const text = clean(message, 2000);
        if (!access || !text) throw Error('invalid message'); socket.join(access.room);
        const saved = await ChatMessage.create({ room: access.room, mode, senderId: user.id, sender: user.name, recipientId: access.recipientId || null, message: text, clientMessageId: clean(clientMessageId, 100) || null });
        const payload = { ...saved.toObject(), id: String(saved._id) }; io.to(access.room).emit('chat:message', payload); ack?.({ ok: true, message: payload });
      } catch { ack?.({ ok: false, error: 'message rejected' }); }
    });
    socket.on('disconnect', () => { online.delete(id); publishPresence(io); });
  });
}
module.exports = registerSocketHandlers;

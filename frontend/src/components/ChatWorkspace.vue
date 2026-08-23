<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api, setAuthToken } from '../services/api';
import { emitWithAck, ensureSocketConnected, setSocketIdentity, socket } from '../services/socket';

const props = defineProps({
  entry: {
    type: String,
    default: 'group',
    validator: (value) => ['group', 'private'].includes(value),
  },
});

const authMode = ref('login');
const authForm = ref({ name: '', email: '', password: '' });
const authLoading = ref(false);
const authError = ref('');
const currentUser = ref(null);

const connected = ref(false);
const chatError = ref('');
const roomInput = ref('lobby');
const composer = ref('');
const sessions = ref([]);
const activeSessionKey = ref('');
const messagesBySession = ref({});
const onlineUsers = ref([]);

const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let handlersBound = false;

const unreadTotal = computed(() => sessions.value.reduce((sum, item) => sum + item.unread, 0));
const activeSession = computed(() => sessions.value.find((item) => item.key === activeSessionKey.value) || null);
const outboxKey = computed(() => (currentUser.value ? `esn.chat.outbox.${currentUser.value.id}` : 'esn.chat.outbox.guest'));

function safeText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
}

function normalizeRoomName(input) {
  const cleaned = safeText(input, 'lobby').replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned || 'lobby';
}

function makeSessionKey(type, value) {
  return `${type}:${value}`;
}

function ensureSession(session) {
  const existing = sessions.value.find((item) => item.key === session.key);
  if (existing) return existing;

  const created = {
    key: session.key,
    title: session.title,
    subtitle: session.subtitle,
    type: session.type,
    roomName: session.roomName || '',
    peerId: session.peerId || '',
    unread: 0,
    updatedAt: Date.now(),
  };
  sessions.value = [created, ...sessions.value];
  return created;
}

function bumpSession(sessionKey, isActive) {
  sessions.value = sessions.value
    .map((item) => {
      if (item.key !== sessionKey) return item;
      return {
        ...item,
        unread: isActive ? 0 : item.unread + 1,
        updatedAt: Date.now(),
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function setActiveSession(sessionKey) {
  activeSessionKey.value = sessionKey;
  sessions.value = sessions.value.map((item) =>
    item.key === sessionKey ? { ...item, unread: 0, updatedAt: Date.now() } : item
  );
}

function getSessionFromRoom(room) {
  if (room.startsWith('public:')) {
    const roomName = room.slice('public:'.length);
    const key = makeSessionKey('room', roomName);
    const session = ensureSession({
      key,
      title: `# ${roomName}`,
      subtitle: '群聊房间',
      type: 'room',
      roomName,
    });
    return session;
  }

  if (room.startsWith('private:')) {
    const payload = room.slice('private:'.length);
    const parts = payload.split('::').filter(Boolean);
    const me = currentUser.value?.id || '';
    const peerId = parts.find((id) => id !== me) || parts[0] || 'unknown';
    const key = makeSessionKey('private', peerId);
    const session = ensureSession({
      key,
      title: `@ ${peerId}`,
      subtitle: '私聊会话',
      type: 'private',
      peerId,
    });
    return session;
  }

  return null;
}

function upsertMessages(sessionKey, nextMessages) {
  messagesBySession.value = {
    ...messagesBySession.value,
    [sessionKey]: nextMessages,
  };
}

function appendMessage(sessionKey, message) {
  const list = messagesBySession.value[sessionKey] || [];
  upsertMessages(sessionKey, [...list, message]);
}

function updateMessageStatus(sessionKey, clientMessageId, patch) {
  const list = messagesBySession.value[sessionKey] || [];
  const next = list.map((item) => {
    if (item.clientMessageId !== clientMessageId) return item;
    return { ...item, ...patch };
  });
  upsertMessages(sessionKey, next);
}

function readOutbox() {
  try {
    const raw = localStorage.getItem(outboxKey.value);
    return raw ? JSON.parse(raw) : [];
  } catch (_error) {
    return [];
  }
}

function writeOutbox(items) {
  localStorage.setItem(outboxKey.value, JSON.stringify(items));
}

function pushOutbox(entry) {
  const queue = readOutbox();
  queue.push(entry);
  writeOutbox(queue);
}

function removeOutbox(clientMessageId) {
  const queue = readOutbox().filter((item) => item.clientMessageId !== clientMessageId);
  writeOutbox(queue);
}

async function loginOrRegister() {
  authError.value = '';
  authLoading.value = true;
  try {
    const payload = {
      email: authForm.value.email,
      password: authForm.value.password,
      name: authForm.value.name,
    };

    const result = authMode.value === 'login' ? await api.login(payload) : await api.register(payload);
    setAuthToken(result.token);
    currentUser.value = result.user;
    await bootstrapChat();
  } catch (error) {
    authError.value = error.message;
  } finally {
    authLoading.value = false;
  }
}

function logout() {
  setAuthToken('');
  currentUser.value = null;
  sessions.value = [];
  activeSessionKey.value = '';
  messagesBySession.value = {};
  onlineUsers.value = [];
  socket.disconnect();
}

async function bootstrapAuth() {
  try {
    const result = await api.me();
    currentUser.value = result.user;
    await bootstrapChat();
  } catch (_error) {
    currentUser.value = null;
  }
}

function bindSocketHandlers() {
  if (handlersBound) return;
  handlersBound = true;

  socket.on('connect', async () => {
    connected.value = true;
    chatError.value = '';
    await flushOutbox();
    if (activeSession.value) {
      await syncSession(activeSession.value);
    }
  });

  socket.on('disconnect', () => {
    connected.value = false;
  });

  socket.on('presence:update', (payload) => {
    onlineUsers.value = payload.users || [];
  });

  socket.on('chat:private-room', (payload) => {
    const peerId = payload.peerId || payload.from;
    if (!peerId) return;
    const key = makeSessionKey('private', peerId);
    ensureSession({
      key,
      title: `@ ${peerId}`,
      subtitle: '私聊会话',
      type: 'private',
      peerId,
    });
    if (props.entry === 'private' && !activeSessionKey.value) {
      setActiveSession(key);
    }
  });

  socket.on('chat:history', (payload) => {
    const session = getSessionFromRoom(payload.room || '');
    if (!session) return;
    const next = (payload.messages || []).map((item) => ({ ...item, status: 'delivered' }));
    upsertMessages(session.key, next);
  });

  socket.on('chat:broadcast', (payload) => {
    const session = getSessionFromRoom(payload.room || '');
    if (!session) return;
    appendMessage(session.key, { ...payload, status: 'delivered' });
    bumpSession(session.key, session.key === activeSessionKey.value);
  });

  socket.on('chat:delivered', (payload) => {
    const session = getSessionFromRoom(payload.room || '');
    if (!session || !payload.clientMessageId) return;
    updateMessageStatus(session.key, payload.clientMessageId, {
      status: 'delivered',
      id: payload.serverMessageId,
      createdAt: payload.createdAt,
    });
    removeOutbox(payload.clientMessageId);
  });

  socket.on('chat:error', (payload) => {
    chatError.value = payload.error || '聊天服务异常';
  });
}

function unbindSocketHandlers() {
  handlersBound = false;
  socket.off('connect');
  socket.off('disconnect');
  socket.off('presence:update');
  socket.off('chat:private-room');
  socket.off('chat:history');
  socket.off('chat:broadcast');
  socket.off('chat:delivered');
  socket.off('chat:error');
}

async function bootstrapChat() {
  if (!currentUser.value) return;

  const lobbyKey = makeSessionKey('room', 'lobby');
  ensureSession({
    key: lobbyKey,
    title: '# lobby',
    subtitle: '默认群聊',
    type: 'room',
    roomName: 'lobby',
  });

  if (!activeSessionKey.value) {
    setActiveSession(lobbyKey);
  }

  setSocketIdentity({ sessionId });
  bindSocketHandlers();
  ensureSocketConnected();

  if (socket.connected && activeSession.value) {
    syncSession(activeSession.value);
  }
}

function syncSession(session) {
  if (!socket.connected) return;

  if (session.type === 'room') {
    socket.emit('chat:join-room', { room: session.roomName, limit: 50 });
    return;
  }

  if (session.type === 'private') {
    socket.emit('chat:open-private', { peerId: session.peerId });
    return;
  }
}

function createRoomSession() {
  const roomName = normalizeRoomName(roomInput.value);
  const key = makeSessionKey('room', roomName);
  ensureSession({ key, title: `# ${roomName}`, subtitle: '群聊房间', type: 'room', roomName });
  setActiveSession(key);
  syncSession({ type: 'room', roomName, key });
}

function startPrivateWith(peerId) {
  if (!peerId || peerId === currentUser.value?.id) return;
  const key = makeSessionKey('private', peerId);
  ensureSession({ key, title: `@ ${peerId}`, subtitle: '私聊会话', type: 'private', peerId });
  setActiveSession(key);
  syncSession({ type: 'private', peerId, key });
}

async function flushOutbox() {
  if (!socket.connected) return;

  const queue = readOutbox();
  if (queue.length === 0) return;

  for (const item of queue) {
    try {
      await emitWithAck(item.event, item.payload, { retries: 2, timeoutMs: 2000 });
      removeOutbox(item.clientMessageId);
      updateMessageStatus(item.sessionKey, item.clientMessageId, { status: 'sent' });
    } catch (_error) {
      updateMessageStatus(item.sessionKey, item.clientMessageId, { status: 'queued' });
    }
  }
}

async function sendMessage() {
  chatError.value = '';
  const text = safeText(composer.value);
  if (!text || !activeSession.value || !currentUser.value) return;

  const clientMessageId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const optimistic = {
    id: `local_${clientMessageId}`,
    room: activeSession.value.type === 'room' ? `public:${activeSession.value.roomName}` : '',
    sender: currentUser.value.name,
    message: text,
    createdAt: new Date().toISOString(),
    clientMessageId,
    status: connected.value ? 'sending' : 'queued',
  };

  appendMessage(activeSession.value.key, optimistic);
  composer.value = '';

  const payload =
    activeSession.value.type === 'room'
      ? {
          room: activeSession.value.roomName,
          message: text,
          sender: currentUser.value.name,
          clientMessageId,
        }
      : {
          peerId: activeSession.value.peerId,
          message: text,
          sender: currentUser.value.name,
          clientMessageId,
        };

  const event = activeSession.value.type === 'room' ? 'chat:send-room' : 'chat:send-private';

  if (!connected.value) {
    pushOutbox({ event, payload, clientMessageId, sessionKey: activeSession.value.key });
    return;
  }

  try {
    await emitWithAck(event, payload, { retries: 2, timeoutMs: 2500 });
    updateMessageStatus(activeSession.value.key, clientMessageId, { status: 'sent' });
  } catch (_error) {
    updateMessageStatus(activeSession.value.key, clientMessageId, { status: 'queued' });
    pushOutbox({ event, payload, clientMessageId, sessionKey: activeSession.value.key });
    chatError.value = '发送失败，已进入补偿队列';
  }
}

function statusText(item) {
  if (!item?.status) return '';
  if (item.status === 'queued') return '排队';
  if (item.status === 'sending') return '发送中';
  if (item.status === 'sent') return '已发送';
  if (item.status === 'delivered') return '已送达';
  return item.status;
}

onMounted(async () => {
  await bootstrapAuth();
});

onUnmounted(() => {
  unbindSocketHandlers();
});
</script>

<template>
  <section class="panel glass chat-workspace">
    <header class="panel-header">
      <div>
        <h2>实时通信工作台</h2>
        <p>在线用户一键私聊、会话侧边栏与未读、ACK 重试补偿、JWT 鉴权接入。</p>
      </div>
      <div class="status-badge" :class="{ online: connected }">
        {{ connected ? `在线 · 未读 ${unreadTotal}` : '离线' }}
      </div>
    </header>

    <div v-if="!currentUser" class="auth-card">
      <div class="auth-switch">
        <button type="button" class="btn" :class="{ primary: authMode === 'login' }" @click="authMode = 'login'">登录</button>
        <button type="button" class="btn" :class="{ primary: authMode === 'register' }" @click="authMode = 'register'">注册</button>
      </div>
      <div class="auth-grid">
        <label v-if="authMode === 'register'">
          姓名
          <input v-model="authForm.name" placeholder="请输入姓名" />
        </label>
        <label>
          邮箱
          <input v-model="authForm.email" type="email" placeholder="you@example.com" />
        </label>
        <label>
          密码
          <input v-model="authForm.password" type="password" placeholder="至少 6 位" @keyup.enter="loginOrRegister" />
        </label>
      </div>
      <button type="button" class="btn primary" :disabled="authLoading" @click="loginOrRegister">
        {{ authLoading ? '处理中...' : authMode === 'login' ? '登录进入通信台' : '注册并进入通信台' }}
      </button>
      <p v-if="authError" class="error">{{ authError }}</p>
    </div>

    <div v-else class="workspace-grid">
      <aside class="sidebar">
        <div class="sidebar-section">
          <h3>当前用户</h3>
          <p>{{ currentUser.name }} · {{ currentUser.role }}</p>
          <p class="muted">{{ currentUser.email }}</p>
          <button type="button" class="btn" @click="logout">退出登录</button>
        </div>

        <div class="sidebar-section">
          <h3>会话</h3>
          <div class="chat-toolbar">
            <input v-model="roomInput" placeholder="新群聊房间名" @keyup.enter="createRoomSession" />
            <button type="button" class="btn" @click="createRoomSession">创建</button>
          </div>
          <ul class="session-list">
            <li
              v-for="item in sessions"
              :key="item.key"
              :class="{ active: item.key === activeSessionKey }"
              @click="setActiveSession(item.key); syncSession(item)"
            >
              <div>
                <strong>{{ item.title }}</strong>
                <p>{{ item.subtitle }}</p>
              </div>
              <span v-if="item.unread" class="badge">{{ item.unread }}</span>
            </li>
          </ul>
        </div>

        <div class="sidebar-section">
          <h3>在线用户</h3>
          <ul class="online-list">
            <li v-for="user in onlineUsers" :key="user.userId">
              <button
                type="button"
                class="user-pill"
                :disabled="user.userId === currentUser.id"
                @click="startPrivateWith(user.userId)"
              >
                <span>{{ user.displayName }}</span>
                <small>{{ user.role }}</small>
              </button>
            </li>
          </ul>
        </div>
      </aside>

      <section class="chat-main">
        <header class="chat-head" v-if="activeSession">
          <h3>{{ activeSession.title }}</h3>
          <p>{{ activeSession.subtitle }}</p>
        </header>

        <p v-if="chatError" class="error">{{ chatError }}</p>

        <div class="chat-feed">
          <article
            v-for="item in messagesBySession[activeSessionKey] || []"
            :key="item.id || item.clientMessageId || item.createdAt"
            class="chat-msg"
          >
            <div class="chat-meta">
              <strong>{{ item.sender }}</strong>
              <span>{{ new Date(item.createdAt).toLocaleTimeString() }}</span>
            </div>
            <p>{{ item.message }}</p>
            <p v-if="item.clientMessageId" class="muted">{{ statusText(item) }}</p>
          </article>
          <p v-if="(messagesBySession[activeSessionKey] || []).length === 0" class="muted">当前会话暂无消息。</p>
        </div>

        <div class="composer">
          <input v-model="composer" placeholder="输入消息并回车" @keyup.enter="sendMessage" />
          <button type="button" class="btn primary" @click="sendMessage">发送</button>
        </div>
      </section>
    </div>
  </section>
</template>

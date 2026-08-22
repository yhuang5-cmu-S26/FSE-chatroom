<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { socket } from '../services/socket';

const sender = ref('dispatcher');
const message = ref('');
const messages = ref([]);
const connected = ref(false);

const statusText = computed(() => (connected.value ? 'Connected' : 'Disconnected'));

function pushSystemMessage(text) {
  messages.value.unshift({ sender: 'system', message: text, createdAt: new Date().toISOString() });
}

function connectSocket() {
  if (!socket.connected) {
    socket.connect();
  }
}

function sendMessage() {
  if (!message.value.trim()) return;
  socket.emit('chat:send', { sender: sender.value, message: message.value });
  message.value = '';
}

onMounted(() => {
  socket.on('connect', () => {
    connected.value = true;
  });

  socket.on('disconnect', () => {
    connected.value = false;
  });

  socket.on('system:message', (payload) => {
    pushSystemMessage(payload.message || 'system event');
  });

  socket.on('chat:broadcast', (payload) => {
    messages.value.unshift(payload);
  });

  socket.on('chat:error', (payload) => {
    pushSystemMessage(payload.error || 'message failed');
  });

  connectSocket();
});

onUnmounted(() => {
  socket.off('connect');
  socket.off('disconnect');
  socket.off('system:message');
  socket.off('chat:broadcast');
  socket.off('chat:error');
});
</script>

<template>
  <section>
    <h2>实时通信</h2>
    <p>Socket 状态: {{ statusText }}</p>
    <div class="row">
      <input v-model="sender" placeholder="发送者" />
      <input v-model="message" placeholder="输入消息" @keyup.enter="sendMessage" />
      <button type="button" @click="sendMessage">发送</button>
    </div>
    <ul class="list">
      <li v-for="item in messages" :key="`${item.createdAt}-${item.sender}-${item.message}`">
        <strong>{{ item.sender }}:</strong> {{ item.message }}
      </li>
    </ul>
  </section>
</template>

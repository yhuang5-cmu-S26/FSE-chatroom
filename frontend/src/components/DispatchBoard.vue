<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { api } from '../services/api';
import { socket } from '../services/socket';

const requests = ref([]);
const error = ref('');

const statuses = ['open', 'assigned', 'in_progress', 'resolved'];

async function loadRequests() {
  requests.value = await api.listHelpRequests();
}

async function updateStatus(id, status) {
  error.value = '';
  try {
    await api.updateHelpStatus(id, status);
    await loadRequests();
  } catch (err) {
    error.value = err.message;
  }
}

onMounted(async () => {
  await loadRequests();

  socket.on('help:status-updated', async () => {
    await loadRequests();
  });

  if (!socket.connected) {
    socket.connect();
  }
});

onUnmounted(() => {
  socket.off('help:status-updated');
});
</script>

<template>
  <section>
    <h2>调度看板</h2>
    <p v-if="error" class="error">{{ error }}</p>
    <table>
      <thead>
        <tr>
          <th>描述</th>
          <th>优先级</th>
          <th>状态</th>
          <th>更新状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in requests" :key="item._id">
          <td>{{ item.description }}</td>
          <td>{{ item.priority }}</td>
          <td>{{ item.status }}</td>
          <td>
            <select :value="item.status" @change="updateStatus(item._id, $event.target.value)">
              <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
            </select>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

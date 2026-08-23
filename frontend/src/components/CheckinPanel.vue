<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api, setAuthToken } from '../services/api';
import { ensureSocketConnected, setSocketIdentity, socket } from '../services/socket';

const auth = ref({ email: '', password: '' });
const authLoading = ref(false);
const currentUser = ref(null);

const form = ref({ task: '', role: '', note: '', priority: 'medium', assignedTo: '' });
const tasks = ref([]);
const error = ref('');

const statuses = ['pending', 'in_progress', 'blocked', 'resolved'];
const priorities = ['low', 'medium', 'high', 'critical'];
const sessionId = `checkin-${Date.now()}`;

const isAdmin = computed(() => currentUser.value?.role === 'admin');
const groupedCount = computed(() => {
  return statuses.map((status) => ({
    status,
    count: tasks.value.filter((item) => item.status === status).length,
  }));
});

async function loadCheckins() {
  tasks.value = await api.listCheckins();
}

async function submitTask() {
  error.value = '';
  try {
    await api.createCheckin(form.value);
    form.value = { task: '', role: '', note: '', priority: 'medium', assignedTo: '' };
  } catch (err) {
    error.value = err.message;
  }
}

async function updateStatus(id, status) {
  error.value = '';
  try {
    await api.updateCheckinStatus(id, status);
  } catch (err) {
    error.value = err.message;
  }
}

async function adminUpdate(item) {
  error.value = '';
  try {
    await api.adminUpdateCheckin(item.id || item._id, {
      priority: item.priority,
      assignedTo: item.assignedTo,
      status: item.status,
      note: item.note,
    });
  } catch (err) {
    error.value = err.message;
  }
}

async function removeTask(item) {
  error.value = '';
  try {
    await api.deleteCheckin(item.id || item._id);
  } catch (err) {
    error.value = err.message;
  }
}

async function login() {
  error.value = '';
  authLoading.value = true;
  try {
    const result = await api.login(auth.value);
    setAuthToken(result.token);
    currentUser.value = result.user;
    setSocketIdentity({ sessionId });
    bindSocket();
    ensureSocketConnected();
    await loadCheckins();
  } catch (err) {
    error.value = err.message;
  } finally {
    authLoading.value = false;
  }
}

function upsertTask(payload) {
  const id = payload.id || payload._id;
  const next = tasks.value.filter((item) => (item.id || item._id) !== id);
  tasks.value = [{ ...payload, id }, ...next].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

function bindSocket() {
  socket.off('checkin:created');
  socket.off('checkin:updated');
  socket.off('checkin:deleted');

  socket.on('checkin:created', (payload) => {
    upsertTask(payload);
  });

  socket.on('checkin:updated', (payload) => {
    upsertTask(payload);
  });

  socket.on('checkin:deleted', (payload) => {
    tasks.value = tasks.value.filter((item) => (item.id || item._id) !== payload.id);
  });
}

onMounted(async () => {
  try {
    const me = await api.me();
    currentUser.value = me.user;
    setSocketIdentity({ sessionId });
    bindSocket();
    ensureSocketConnected();
    await loadCheckins();
  } catch (_error) {
    currentUser.value = null;
  }
});

onUnmounted(() => {
  socket.off('checkin:created');
  socket.off('checkin:updated');
  socket.off('checkin:deleted');
});
</script>

<template>
  <section>
    <h2>签到任务看板</h2>

    <div v-if="!currentUser" class="auth-card">
      <p>请先登录后查看和更新实时任务状态。</p>
      <div class="row grid">
        <input v-model="auth.email" placeholder="邮箱" type="email" />
        <input v-model="auth.password" placeholder="密码" type="password" @keyup.enter="login" />
        <button type="button" class="btn primary" :disabled="authLoading" @click="login">
          {{ authLoading ? '登录中...' : '登录' }}
        </button>
      </div>
    </div>

    <template v-else>
      <div class="metrics">
        <div v-for="item in groupedCount" :key="item.status">
          <strong>{{ item.status }}</strong>
          <div>{{ item.count }}</div>
        </div>
      </div>

      <div class="row grid">
        <input v-model="form.task" placeholder="任务内容（例如：A 区签到核查）" />
        <input v-model="form.role" placeholder="任务类型（medical/logistics）" />
        <select v-model="form.priority">
          <option v-for="priority in priorities" :key="priority" :value="priority">{{ priority }}</option>
        </select>
        <input v-model="form.assignedTo" placeholder="分配给（用户ID，可选）" />
        <input v-model="form.note" placeholder="备注（可选）" />
        <button type="button" class="btn primary" @click="submitTask">创建任务</button>
      </div>

      <table>
        <thead>
          <tr>
            <th>任务</th>
            <th>类型</th>
            <th>优先级</th>
            <th>状态</th>
            <th>负责人</th>
            <th>上报人</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in tasks" :key="item.id || item._id">
            <td>{{ item.task }}</td>
            <td>{{ item.role }}</td>
            <td>
              <select v-model="item.priority" :disabled="!isAdmin" @change="adminUpdate(item)">
                <option v-for="priority in priorities" :key="priority" :value="priority">{{ priority }}</option>
              </select>
            </td>
            <td>
              <select
                v-model="item.status"
                @change="isAdmin ? adminUpdate(item) : updateStatus(item.id || item._id, item.status)"
              >
                <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
              </select>
            </td>
            <td>
              <input v-model="item.assignedTo" :disabled="!isAdmin" @change="adminUpdate(item)" />
            </td>
            <td>{{ item.reporterName }}</td>
            <td>
              <button v-if="isAdmin" type="button" class="btn" @click="removeTask(item)">删除</button>
              <span v-else class="muted">成员可更新状态</span>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <p v-if="error" class="error">{{ error }}</p>
  </section>
</template>

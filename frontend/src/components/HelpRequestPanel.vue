<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../services/api';

const form = ref({
  description: '',
  priority: 'medium',
  latitude: 0,
  longitude: 0,
  detail: '',
});
const requests = ref([]);
const error = ref('');

async function loadRequests() {
  requests.value = await api.listHelpRequests();
}

async function submitRequest() {
  error.value = '';
  try {
    await api.createHelpRequest({
      description: form.value.description,
      priority: form.value.priority,
      location: {
        latitude: Number(form.value.latitude),
        longitude: Number(form.value.longitude),
        detail: form.value.detail,
      },
    });
    form.value = { description: '', priority: 'medium', latitude: 0, longitude: 0, detail: '' };
    await loadRequests();
  } catch (err) {
    error.value = err.message;
  }
}

onMounted(loadRequests);
</script>

<template>
  <section>
    <h2>求助请求</h2>
    <div class="row grid">
      <input v-model="form.description" placeholder="求助描述" />
      <select v-model="form.priority">
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
        <option value="critical">critical</option>
      </select>
      <input v-model.number="form.latitude" type="number" placeholder="纬度" />
      <input v-model.number="form.longitude" type="number" placeholder="经度" />
      <input v-model="form.detail" placeholder="位置说明" />
      <button type="button" @click="submitRequest">提交</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <ul class="list">
      <li v-for="item in requests" :key="item._id">
        {{ item.description }} ({{ item.priority }}) - {{ item.status }}
      </li>
    </ul>
  </section>
</template>

<script setup>
import { ref } from 'vue';
import { api } from '../services/api';

const result = ref(null);
const loading = ref(false);
const error = ref('');

async function runStress() {
  loading.value = true;
  error.value = '';
  try {
    result.value = await api.runStressTest();
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section>
    <h2>Admin 压测模块</h2>
    <button type="button" :disabled="loading" @click="runStress">{{ loading ? '执行中...' : '运行压测' }}</button>
    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="result" class="metrics">
      <div>总请求数: {{ result.total }}</div>
      <div>成功: {{ result.success }}</div>
      <div>失败: {{ result.failure }}</div>
      <div>P50: {{ result.p50 }}ms</div>
      <div>P95: {{ result.p95 }}ms</div>
      <div>P99: {{ result.p99 }}ms</div>
      <div>吞吐量: {{ result.throughputPerSec }} req/s</div>
    </div>
  </section>
</template>
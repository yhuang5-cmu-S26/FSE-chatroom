<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../services/api';

const form = ref({ name: '', role: '', status: 'available' });
const checkins = ref([]);
const error = ref('');

async function loadCheckins() {
  checkins.value = await api.listCheckins();
}

async function submitCheckin() {
  error.value = '';
  try {
    await api.createCheckin(form.value);
    form.value = { name: '', role: '', status: 'available' };
    await loadCheckins();
  } catch (err) {
    error.value = err.message;
  }
}

onMounted(loadCheckins);
</script>

<template>
  <section>
    <h2>人员签到</h2>
    <div class="row">
      <input v-model="form.name" placeholder="姓名" />
      <input v-model="form.role" placeholder="身份" />
      <input v-model="form.status" placeholder="状态" />
      <button type="button" @click="submitCheckin">提交</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <ul class="list">
      <li v-for="item in checkins" :key="item._id">
        {{ item.name }} / {{ item.role }} / {{ item.status }}
      </li>
    </ul>
  </section>
</template>

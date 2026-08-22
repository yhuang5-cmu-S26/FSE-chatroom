<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../services/api';

const form = ref({ name: '', role: '', latitude: 0, longitude: 0, note: '' });
const locations = ref([]);
const error = ref('');

async function loadLocations() {
  locations.value = await api.listLocations();
}

async function submitLocation() {
  error.value = '';
  try {
    await api.createLocation({
      ...form.value,
      latitude: Number(form.value.latitude),
      longitude: Number(form.value.longitude),
    });
    form.value = { name: '', role: '', latitude: 0, longitude: 0, note: '' };
    await loadLocations();
  } catch (err) {
    error.value = err.message;
  }
}

onMounted(loadLocations);
</script>

<template>
  <section>
    <h2>位置服务</h2>
    <div class="row grid">
      <input v-model="form.name" placeholder="姓名" />
      <input v-model="form.role" placeholder="身份" />
      <input v-model.number="form.latitude" type="number" placeholder="纬度" />
      <input v-model.number="form.longitude" type="number" placeholder="经度" />
      <input v-model="form.note" placeholder="备注" />
      <button type="button" @click="submitLocation">上报</button>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p>地图组件占位：后续可接入 Leaflet / Mapbox。</p>
    <ul class="list">
      <li v-for="item in locations" :key="item._id">
        {{ item.name }} - {{ item.latitude }}, {{ item.longitude }}
      </li>
    </ul>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import ChatPanel from './components/ChatPanel.vue';
import CheckinPanel from './components/CheckinPanel.vue';
import HelpRequestPanel from './components/HelpRequestPanel.vue';
import DispatchBoard from './components/DispatchBoard.vue';
import LocationPanel from './components/LocationPanel.vue';

const tabs = [
  { key: 'chat', label: '实时通信', component: ChatPanel },
  { key: 'checkin', label: '人员签到', component: CheckinPanel },
  { key: 'help', label: '求助请求', component: HelpRequestPanel },
  { key: 'dispatch', label: '调度看板', component: DispatchBoard },
  { key: 'location', label: '位置服务', component: LocationPanel },
];

const activeTab = ref('chat');

const activeComponent = computed(
  () => tabs.find((tab) => tab.key === activeTab.value)?.component ?? ChatPanel
);
</script>

<template>
  <main>
    <h1>ESN 应急灾害响应系统（MVP）</h1>
    <nav class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        :class="{ active: tab.key === activeTab }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </nav>
    <component :is="activeComponent" />
  </main>
</template>

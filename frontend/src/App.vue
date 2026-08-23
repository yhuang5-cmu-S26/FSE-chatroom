<script setup>
import { computed, ref } from 'vue';
import ChatWorkspace from './components/ChatWorkspace.vue';
import CheckinPanel from './components/CheckinPanel.vue';
import HelpRequestPanel from './components/HelpRequestPanel.vue';
import AdminPanel from './components/AdminPanel.vue';

const modules = [
  {
    key: 'group-chat',
    label: '核心 Chatroom',
    tag: 'Realtime Core',
    description: '多人协同频道，支持房间隔离和消息历史。',
    component: ChatWorkspace,
    props: { entry: 'group' },
  },
  {
    key: 'private-chat',
    label: '私聊会话',
    tag: 'Direct Message',
    description: '点对点通信入口，适合调度员和响应者一对一沟通。',
    component: ChatWorkspace,
    props: { entry: 'private' },
  },
  {
    key: 'checkin',
    label: '人员签到',
    tag: 'Ops',
    description: '收集现场人员状态。',
    component: CheckinPanel,
  },
  {
    key: 'help',
    label: '求助请求',
    tag: 'Ops',
    description: '上报求助事件并带位置信息。',
    component: HelpRequestPanel,
  },
  {
    key: 'admin',
    label: 'Admin 压测',
    tag: 'Performance',
    description: '压力测试和分位数观察。',
    component: AdminPanel,
  },
];

const activeModule = ref('group-chat');

const activeView = computed(() => modules.find((item) => item.key === activeModule.value) ?? modules[0]);
</script>

<template>
  <main class="app-shell">
    <header class="hero">
      <p class="hero-kicker">Emergency Social Network</p>
      <h1>应急通信中枢</h1>
      <p class="hero-subtitle">核心 chatroom 与私聊分离入口，面向高压场景的实时协同体验。</p>
    </header>

    <section class="module-grid">
      <button
        v-for="item in modules"
        :key="item.key"
        type="button"
        class="module-card"
        :class="{ active: item.key === activeModule }"
        @click="activeModule = item.key"
      >
        <span class="module-tag">{{ item.tag }}</span>
        <h3>{{ item.label }}</h3>
        <p>{{ item.description }}</p>
      </button>
    </section>

    <KeepAlive>
      <component :is="activeView.component" v-bind="activeView.props || {}" />
    </KeepAlive>
  </main>
</template>

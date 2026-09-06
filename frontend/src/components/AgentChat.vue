<script setup>
import { nextTick, ref } from 'vue';
import { api } from '../services/api';

const open = ref(false);
const initialized = ref(false);
const sessionId = ref(null);
const sessions = ref([]);
const loading = ref(false);
const input = ref('');
const feed = ref(null);
const suggestions = ['查询任务 A 未签到人员', '根据未签到名单生成寻人帖', '总结当前应急响应状态'];
const welcomeMessage = () => ({
  id: 'welcome',
  role: 'assistant',
  content: '你好，我是协作 Agent。普通问题会直接回答；需要操作系统时，我会先给出可审批的 Todo。',
});
const messages = ref([welcomeMessage()]);

function toUiMessage(message) {
  return { id: message.id, role: message.role, content: message.content, planner: message.planner || null, todo: message.planner?.todo || [], coverage: message.planner?.coverage, requiresConfirmation: message.planner?.requiresConfirmation };
}

function canApprove(message) {
  return message.role === 'assistant' && message.planner?.intent === 'command' && message.planner?.approvalStatus === 'pending' && message.coverage?.canCover;
}

function canHandoff(message) {
  return message.role === 'assistant' && message.planner?.intent === 'command' && !message.planner?.handoff?.requestedAt && ['pending', 'failed', 'rejected'].includes(message.planner?.approvalStatus);
}

function canRetry(message) {
  return message.role === 'assistant' && message.planner?.approvalStatus === 'failed' && message.planner?.runId;
}

async function approve(message) {
  if (!canApprove(message) || loading.value) return;
  loading.value = true;
  try {
    const result = await api.approveAgentPlan(sessionId.value, message.id);
    const updated = toUiMessage(result.message);
    messages.value = messages.value.map((item) => item.id === updated.id ? updated : item);
  } catch (error) {
    messages.value.push({ id: `approve-error-${Date.now()}`, role: 'assistant', error: true, content: `执行失败：${error.message}` });
  } finally {
    loading.value = false;
    await scrollToLatest();
  }
}

async function handoff(message) {
  if (!canHandoff(message) || loading.value) return;
  loading.value = true;
  try {
    const result = await api.handoffAgentPlan(sessionId.value, message.id);
    const updated = toUiMessage(result.message);
    messages.value = messages.value.map((item) => item.id === updated.id ? updated : item);
  } catch (error) {
    messages.value.push({ id: `handoff-error-${Date.now()}`, role: 'assistant', error: true, content: `无法登记人工接管：${error.message}` });
  } finally {
    loading.value = false;
    await scrollToLatest();
  }
}

async function retry(message) {
  if (!canRetry(message) || loading.value) return;
  loading.value = true;
  try {
    const result = await api.retryAgentRun(sessionId.value, message.planner.runId);
    const updated = toUiMessage(result.message);
    messages.value = messages.value.map((item) => item.id === updated.id ? updated : item);
  } catch (error) {
    messages.value.push({ id: `retry-error-${Date.now()}`, role: 'assistant', error: true, content: `重试失败：${error.message}` });
  } finally { loading.value = false; await scrollToLatest(); }
}

async function refreshSessions() {
  sessions.value = (await api.agentSessions()).sessions;
}

async function loadSession() {
  if (!sessionId.value) return newConversation();
  loading.value = true;
  try {
    const result = await api.agentSessionMessages(sessionId.value);
    messages.value = result.messages.map(toUiMessage);
  } finally {
    loading.value = false;
    await scrollToLatest();
  }
}

async function newConversation() {
  sessionId.value = null;
  loading.value = true;
  try {
    const result = await api.agentChat('');
    sessionId.value = result.session.id;
    messages.value = result.messages.map(toUiMessage);
    if (messages.value[0]) messages.value[0].capabilities = result.capabilities || [];
    await refreshSessions();
  } finally {
    loading.value = false;
    await scrollToLatest();
  }
}

async function deleteCurrentSession() {
  if (!sessionId.value || loading.value) return;
  if (!window.confirm('删除此会话及其工作流记录？该操作无法撤销。')) return;
  loading.value = true;
  try {
    await api.deleteAgentSession(sessionId.value);
    sessions.value = sessions.value.filter((session) => session.id !== sessionId.value);
    sessionId.value = null;
    messages.value = [welcomeMessage()];
  } catch (error) {
    messages.value.push({ id: `delete-error-${Date.now()}`, role: 'assistant', error: true, content: `无法删除会话：${error.message}` });
  } finally {
    loading.value = false;
    await scrollToLatest();
  }
}

async function openChat() {
  open.value = true;
  if (initialized.value) return;
  initialized.value = true;
  try {
    await refreshSessions();
    await newConversation();
  } catch (error) {
    messages.value[0] = { id: 'welcome-error', role: 'assistant', error: true, content: `无法加载 Agent 能力范围：${error.message}` };
  }
}

async function scrollToLatest() {
  await nextTick();
  if (feed.value) feed.value.scrollTop = feed.value.scrollHeight;
}

async function send(value = input.value) {
  const content = value.trim();
  if (!content || loading.value) return;
  messages.value.push({ id: `user-${Date.now()}`, role: 'user', content });
  input.value = '';
  loading.value = true;
  await scrollToLatest();
  try {
    const streaming = { id: `stream-${Date.now()}`, role: 'assistant', content: '' };
    messages.value.push(streaming);
    let completed = false;
    await api.agentChatStream(content, sessionId.value, {
      onDelta: (text) => { messages.value = messages.value.map((item) => item.id === streaming.id ? { ...item, content: item.content + text } : item); },
      onResult: async (result) => {
        completed = true;
        const message = toUiMessage(result.message);
        messages.value = messages.value.map((item) => item.id === streaming.id ? message : item);
        sessionId.value = result.session.id;
        await refreshSessions();
      },
    });
    if (!completed) throw new Error('stream ended without a result');
  } catch (error) {
    messages.value = messages.value.filter((item) => !String(item.id).startsWith('stream-'));
    messages.value.push({ id: `error-${Date.now()}`, role: 'assistant', error: true, content: `暂时无法生成计划：${error.message}` });
  } finally {
    loading.value = false;
    await scrollToLatest();
  }
}
</script>

<template>
  <button class="agent-fab" type="button" aria-label="打开协作 Agent" @click="openChat">
    <span>✦</span> Agent
  </button>

  <Teleport to="body">
    <div v-if="open" class="agent-backdrop" @click.self="open = false">
      <section class="agent-dialog" role="dialog" aria-modal="true" aria-label="协作 Agent">
        <header class="agent-header">
          <div><strong>协作 Agent</strong><small>对话与受控执行</small></div>
          <select v-model="sessionId" aria-label="历史会话" @change="loadSession">
            <option v-for="session in sessions" :key="session.id" :value="session.id">{{ session.title }}</option>
          </select>
          <button type="button" class="agent-new" @click="newConversation">＋</button>
          <button v-if="sessionId" type="button" class="agent-delete" :disabled="loading" @click="deleteCurrentSession">删除</button>
          <button type="button" class="agent-close" aria-label="关闭" @click="open = false">×</button>
        </header>

        <div ref="feed" class="agent-feed">
          <article v-for="message in messages" :key="message.id" class="agent-message" :class="message.role">
            <span class="agent-role">{{ message.role === 'user' ? '你' : 'Agent' }}</span>
            <p>{{ message.content }}</p>
            <ul v-if="message.capabilities?.length" class="agent-capabilities">
              <li v-for="capability in message.capabilities" :key="capability.id">
                <strong>{{ capability.title }}</strong><span>{{ capability.description }}</span>
              </li>
            </ul>
            <ol v-if="message.todo?.length" class="agent-plan">
              <li v-for="step in message.todo" :key="step.id">
                <code>{{ step.action?.type || 'unsupported' }}</code><span>{{ step.title }}</span>
                <em>{{ step.status === 'rejected' ? step.rejectionReason : step.requiresConfirmation ? '需要确认' : '可规划'
                  }}</em>
              </li>
            </ol>
            <small v-if="message.coverage" :class="['agent-coverage', { unsupported: !message.coverage.canCover }]">
              {{ message.coverage.canCover ? '可覆盖' : '暂无法完全覆盖' }}：{{ message.coverage.reason }}
            </small>
            <small v-if="message.requiresConfirmation" class="agent-confirm">写操作将在确认后执行</small>
            <button v-if="canApprove(message)" type="button" class="agent-approve" :disabled="loading"
              @click="approve(message)">Approve 并执行</button>
            <button v-if="canHandoff(message)" type="button" class="agent-handoff" :disabled="loading"
              @click="handoff(message)">交由人工处理</button>
            <button v-if="canRetry(message)" type="button" class="agent-handoff" :disabled="loading"
              @click="retry(message)">从失败步骤重试</button>
            <small v-if="message.planner?.approvalStatus === 'executed'" class="agent-executed">已执行{{
              message.planner.execution?.steps?.length ? `（${message.planner.execution.steps.length} 步）` : '' }}</small>
            <small v-if="message.planner?.handoff?.requestedAt" class="agent-executed">已登记人工接管</small>
            <small v-if="message.planner?.approvalStatus === 'failed'"
              class="agent-coverage unsupported">执行失败，请查看步骤结果。</small>
          </article>
          <article v-if="loading" class="agent-message assistant agent-thinking">Agent 正在分析 Todo 与能力范围…</article>
        </div>

        <div class="agent-suggestions">
          <button v-for="suggestion in suggestions" :key="suggestion" type="button" :disabled="loading"
            @click="send(suggestion)">
            {{ suggestion }}
          </button>
        </div>
        <form class="agent-composer" @submit.prevent="send()">
          <textarea v-model="input" :disabled="loading" placeholder="提问，或描述需要执行的协作任务…" rows="2"
            @keydown.enter.exact.prevent="send()" />
          <button type="submit" :disabled="loading || !input.trim()">{{ loading ? '思考中' : '发送' }}</button>
        </form>
      </section>
    </div>
  </Teleport>
</template>

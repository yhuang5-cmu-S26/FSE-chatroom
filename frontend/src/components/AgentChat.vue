<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { api } from '../services/api';

const open = ref(false);
const initialized = ref(false);
const sessionId = ref(null);
const sessions = ref([]);
const loading = ref(false);
const input = ref('');
const interruptReplies = ref({});
const feed = ref(null);
const monitor = ref(null);
const monitorLoading = ref(false);
const monitorTab = ref('trace');
const testInput = ref('查询任务 A 未签到人员\n总结当前应急响应状态');
const testRunning = ref(false);
const testReport = ref(null);
let monitorTimer = null;
const suggestions = ['查询任务 A 未签到人员', '根据未签到名单生成寻人帖', '总结当前应急响应状态'];
const welcomeMessage = () => ({
  id: 'welcome',
  role: 'assistant',
  content: '你好，我是协作 Agent。普通问题会直接回答；需要操作系统时，我会先给出可审批的 Todo。',
});
const messages = ref([welcomeMessage()]);
const activeTrace = computed(() => monitor.value?.active || null);

const percent = (value) => value == null ? '—' : `${Math.round(value * 100)}%`;
const duration = (value) => value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value || 0)}ms`;
const stateText = (state) => ({ planned: '等待', running: '执行中', succeeded: '成功', failed: '失败', rejected: '拒绝', skipped: '跳过' }[state] || state);
const shortJson = (value) => {
  if (value == null) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
};

async function refreshMonitor(silent = false) {
  if (!sessionId.value || (!open.value && silent)) return;
  if (!silent) monitorLoading.value = true;
  try {
    monitor.value = await api.agentMonitor(sessionId.value);
  } catch (error) {
    if (!silent) monitor.value = { error: error.message };
  } finally {
    if (!silent) monitorLoading.value = false;
  }
}

function startMonitorPolling() {
  clearInterval(monitorTimer);
  monitorTimer = setInterval(() => refreshMonitor(true), 2000);
}

async function runTests() {
  const cases = testInput.value.split('\n').map((item) => item.trim()).filter(Boolean);
  if (!cases.length || testRunning.value) return;
  testRunning.value = true;
  testReport.value = null;
  try {
    testReport.value = await api.runAgentTests(cases.slice(0, 10));
  } catch (error) {
    testReport.value = { error: error.message };
  } finally {
    testRunning.value = false;
  }
}

onBeforeUnmount(() => clearInterval(monitorTimer));

function toUiMessage(message, interrupt = null) {
  return { id: message.id, role: message.role, content: message.content, planner: message.planner || null, todo: message.planner?.todo || [], coverage: message.planner?.coverage, requiresConfirmation: message.planner?.requiresConfirmation, interrupt: interrupt?.value || message.planner?.execution?.interrupt || null, interruptId: interrupt?.id || null };
}

function canApprove(message) {
  return message.role === 'assistant' && message.planner?.intent === 'command' && message.planner?.approvalStatus === 'pending' && message.coverage?.canCover;
}

function canHandoff(message) {
  return message.role === 'assistant' && message.planner?.intent === 'command' && !message.planner?.handoff?.requestedAt && ['pending', 'awaiting_input', 'failed', 'rejected'].includes(message.planner?.approvalStatus);
}

function canResume(message) {
  return message.role === 'assistant' && message.planner?.approvalStatus === 'awaiting_input' && message.planner?.runId && message.interrupt;
}

function canRetry(message) {
  return message.role === 'assistant' && message.planner?.approvalStatus === 'failed' && message.planner?.runId;
}

function stepOutcome(step) {
  if (step.status === 'rejected') return step.error || '该危险操作已被拒绝';
  if (step.status === 'failed') return step.error || '该步骤执行失败';
  if (step.result?.summary) return step.result.summary;
  if (step.result?.data?.absentUserIds) return `未签到人员：${step.result.data.absentUserIds.join('、') || '无'}`;
  return step.status === 'executed' ? '已执行完成' : '等待执行';
}

async function approve(message) {
  if (!canApprove(message) || loading.value) return;
  loading.value = true;
  try {
    const result = await api.approveAgentPlan(sessionId.value, message.id);
    const updated = toUiMessage(result.message, result.interrupt);
    messages.value = messages.value.map((item) => item.id === updated.id ? updated : item);
  } catch (error) {
    messages.value.push({ id: `approve-error-${Date.now()}`, role: 'assistant', error: true, content: `执行失败：${error.message}` });
  } finally {
    loading.value = false;
    await refreshMonitor(true);
    await scrollToLatest();
  }
}

async function resume(message, decision = 'edit') {
  if (!canResume(message) || loading.value) return;
  const edited = String(interruptReplies.value[message.id] || '').trim();
  if (decision === 'edit' && !edited) return;
  loading.value = true;
  try {
    const response = decision === 'approve'
      ? { decision: 'approve' }
      : decision === 'reject'
        ? { decision: 'reject', reason: '用户在审批界面拒绝执行' }
        : { decision: 'edit', content: edited };
    const result = await api.resumeAgentRun(sessionId.value, message.planner.runId, {
      interruptId: message.interruptId,
      response,
    });
    const updated = toUiMessage(result.message, result.interrupt);
    messages.value = messages.value.map((item) => item.id === updated.id ? updated : item);
    delete interruptReplies.value[message.id];
  } catch (error) {
    messages.value.push({ id: `resume-error-${Date.now()}`, role: 'assistant', error: true, content: `恢复执行失败：${error.message}` });
  } finally {
    loading.value = false;
    await refreshMonitor(true);
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
    await refreshMonitor();
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
    await refreshMonitor();
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
  startMonitorPolling();
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
        await refreshMonitor(true);
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

        <div class="agent-workspace">
        <div class="agent-chat-pane">
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
            <div v-if="canResume(message)" class="agent-interrupt">
              <strong>危险工具审批 · {{ message.interrupt.riskLevel || 'high' }}</strong>
              <p>{{ message.interrupt.question }}</p>
              <p><code>{{ message.interrupt.actionType }}</code>：{{ message.interrupt.reason }}</p>
              <blockquote>{{ message.interrupt.draft || JSON.stringify(message.interrupt.arguments, null, 2) }}</blockquote>
              <textarea v-model="interruptReplies[message.id]" :disabled="loading"
                placeholder="输入修改后的完整正文；也可以直接确认原文" rows="3" />
              <div>
                <button type="button" class="agent-approve" :disabled="loading"
                  @click="resume(message, 'approve')">确认原文并继续</button>
                <button type="button" class="agent-handoff"
                  :disabled="loading || !String(interruptReplies[message.id] || '').trim()"
                  @click="resume(message, 'edit')">使用修改内容继续</button>
                <button type="button" class="agent-handoff" :disabled="loading"
                  @click="resume(message, 'reject')">拒绝执行</button>
              </div>
            </div>
            <div v-if="message.planner?.execution?.steps?.length" class="agent-execution">
              <strong>执行结果</strong>
              <p v-for="step in message.planner.execution.steps" :key="step.id" :class="{ failed: ['failed', 'rejected'].includes(step.status) }">
                <code>{{ step.status === 'rejected' ? '拒绝' : step.status === 'failed' ? '失败' : '成功' }}</code>{{ stepOutcome(step) }}
              </p>
            </div>
            <small v-if="message.planner?.approvalStatus === 'executed'" class="agent-executed">已执行{{
              message.planner.execution?.steps?.length ? `（${message.planner.execution.steps.length} 步）` : '' }}</small>
            <small v-if="message.planner?.handoff?.requestedAt" class="agent-executed">已登记人工接管</small>
            <small v-if="message.planner?.approvalStatus === 'failed'"
              class="agent-coverage unsupported">执行失败；可修正参数后从失败步骤重试。</small>
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
        </div>

        <aside class="agent-monitor" aria-label="Agent 执行监控">
          <div class="monitor-heading">
            <div><span class="live-dot" /><strong>Agent Observability</strong><small>2 秒刷新 · 当前会话</small></div>
            <button type="button" :disabled="monitorLoading" @click="refreshMonitor()">刷新</button>
          </div>
          <nav class="monitor-tabs" aria-label="监控面板">
            <button type="button" :class="{ active: monitorTab === 'trace' }" @click="monitorTab = 'trace'">实时链路</button>
            <button type="button" :class="{ active: monitorTab === 'tests' }" @click="monitorTab = 'tests'">批量测试</button>
          </nav>

          <div v-if="monitorTab === 'trace'" class="monitor-scroll">
            <p v-if="monitor?.error" class="monitor-error">{{ monitor.error }}</p>
            <template v-else>
              <div class="metric-grid">
                <article><span>链路成功率</span><strong>{{ percent(monitor?.metrics?.runSuccessRate) }}</strong><small>{{ monitor?.metrics?.runCount || 0 }} 条执行</small></article>
                <article><span>工具成功率</span><strong>{{ percent(monitor?.metrics?.toolSuccessRate) }}</strong><small>{{ monitor?.metrics?.toolCallCount || 0 }} 次调用</small></article>
                <article><span>规划 P95</span><strong>{{ duration(monitor?.metrics?.planningP95Ms) }}</strong><small>P50 {{ duration(monitor?.metrics?.planningP50Ms) }}</small></article>
                <article><span>Token 流量</span><strong>{{ monitor?.metrics?.tokens || 0 }}</strong><small>{{ monitor?.metrics?.requestCount || 0 }} 次响应</small></article>
              </div>

              <section v-if="activeTrace" class="trace-card">
                <header><div><span class="trace-eyebrow">CURRENT TRACE</span><strong>{{ activeTrace.id.slice(-8) }}</strong></div><em :class="`state-${activeTrace.state}`">{{ activeTrace.stateLabel }}</em></header>
                <div class="trace-now"><span>当前进度</span><strong>{{ activeTrace.currentStep }}</strong><small>总耗时 {{ duration(activeTrace.latency.totalMs) }}</small></div>
                <div class="latency-bar">
                  <span :style="{ flex: Math.max(activeTrace.latency.planningMs, 1) }">规划 {{ duration(activeTrace.latency.planningMs) }}</span>
                  <span :style="{ flex: Math.max(activeTrace.latency.executionMs, 1) }">执行 {{ duration(activeTrace.latency.executionMs) }}</span>
                </div>
              </section>
              <div v-else class="monitor-empty"><span>◎</span><strong>等待第一条执行链路</strong><small>发送一条需要调用工具的指令后，这里会展示真实审计记录。</small></div>

              <section v-if="activeTrace?.steps?.length" class="monitor-section">
                <div class="monitor-section-title"><strong>子图 / 步骤延迟</strong><span>{{ activeTrace.steps.length }} steps</span></div>
                <ol class="trace-steps">
                  <li v-for="step in activeTrace.steps" :key="step.id" :class="`step-${step.state}`">
                    <i /><div><strong>{{ step.title }}</strong><code>{{ step.actionType }}</code></div><span>{{ stateText(step.state) }}<small>{{ duration(step.latencyMs) }}</small></span>
                  </li>
                </ol>
              </section>

              <section v-if="activeTrace?.toolCalls?.length" class="monitor-section">
                <div class="monitor-section-title"><strong>工具调用记录</strong><span>{{ activeTrace.toolCalls.length }} calls</span></div>
                <details v-for="call in activeTrace.toolCalls" :key="call.id" class="tool-call">
                  <summary><code>{{ call.actionType }}</code><span :class="`state-${call.state}`">{{ stateText(call.state) }}</span><small>{{ duration(call.durationMs) }}</small></summary>
                  <div><b>Input</b><pre>{{ shortJson(call.input) }}</pre><b>{{ call.error ? 'Error' : 'Output' }}</b><pre>{{ shortJson(call.error || call.output) }}</pre></div>
                </details>
              </section>

              <section v-if="activeTrace?.events?.length" class="monitor-section">
                <div class="monitor-section-title"><strong>事件时间线</strong><span>{{ activeTrace.events.length }} events</span></div>
                <div class="event-row" v-for="event in activeTrace.events.slice().reverse()" :key="event.id"><i /><code>{{ event.type }}</code><time>{{ new Date(event.occurredAt).toLocaleTimeString() }}</time></div>
              </section>
            </template>
          </div>

          <div v-else class="monitor-scroll batch-panel">
            <div class="batch-intro"><span>ONE-OFF TEST</span><strong>一次性链路验证</strong><p>每行一个测试对话，最多 10 条。只读工具自动执行；写操作保留人工审批边界。</p></div>
            <label>测试对话 + 动作<textarea v-model="testInput" rows="6" :disabled="testRunning" placeholder="每行输入一个测试用例" /></label>
            <button type="button" class="run-tests" :disabled="testRunning || !testInput.trim()" @click="runTests">{{ testRunning ? '正在逐条运行…' : '运行测试组' }}</button>
            <p v-if="testReport?.error" class="monitor-error">{{ testReport.error }}</p>
            <template v-if="testReport?.summary">
              <div class="test-summary">
                <article><span>规划成功率</span><strong>{{ percent(testReport.summary.planningSuccessRate) }}</strong></article>
                <article><span>链路成功率</span><strong>{{ percent(testReport.summary.executionSuccessRate) }}</strong></article>
                <article><span>工具成功率</span><strong>{{ percent(testReport.summary.toolSuccessRate) }}</strong></article>
              </div>
              <div class="test-result" v-for="(result, index) in testReport.results" :key="result.session?.id || index">
                <header><span>#{{ index + 1 }}</span><strong>{{ result.prompt }}</strong><em :class="result.planningSucceeded ? 'ok' : 'bad'">{{ result.executionMode }}</em></header>
                <div v-if="result.trace?.toolCalls?.length" class="test-tools"><code v-for="call in result.trace.toolCalls" :key="call.id">{{ call.actionType }} · {{ stateText(call.state) }}</code></div>
                <small v-else>{{ result.error || (result.executionMode === 'approval_required' ? '包含副作用，等待人工审批，未调用工具' : '本用例没有工具调用') }}</small>
              </div>
            </template>
          </div>
        </aside>
        </div>
      </section>
    </div>
  </Teleport>
</template>

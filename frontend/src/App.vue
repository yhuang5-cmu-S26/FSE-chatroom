<script setup>
import { computed, onMounted, ref } from "vue";
import { api, setToken } from "./services/api";
import { connectSocket, emitAck, socket } from "./services/socket";
import AgentChat from "./components/AgentChat.vue";
const me = ref(),
    auth = ref({ name: "", email: "", password: "" }),
    view = ref("home"),
    users = ref([]),
    groups = ref([]),
    posts = ref([]),
    tasks = ref([]),
    messages = ref([]),
    chat = ref({ mode: "public", targetId: "" }),
    text = ref(""),
    run = ref(),
    notice = ref(null),
    contactPage = ref(1);
let noticeTimer;
const admin = computed(() => me.value?.role === "admin");
const CONTACTS_PER_PAGE = 6;
const sortedContacts = computed(() => [...users.value].sort((left, right) => Number(right.online) - Number(left.online) || left.name.localeCompare(right.name, 'zh-CN')));
const contactPageCount = computed(() => Math.max(1, Math.ceil(sortedContacts.value.length / CONTACTS_PER_PAGE)));
const pagedContacts = computed(() => sortedContacts.value.slice((contactPage.value - 1) * CONTACTS_PER_PAGE, contactPage.value * CONTACTS_PER_PAGE));
function moveContactPage(direction) {
    contactPage.value = Math.min(contactPageCount.value, Math.max(1, contactPage.value + direction));
}
function showNotice(message, type = "success") {
    notice.value = { message, type };
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice.value = null), 3200);
}
async function enter() {
    try {
        const x = await api.enter(auth.value);
        setToken(x.token);
        me.value = x.user;
        connectSocket();
        showNotice(x.created ? "注册并登录成功" : "登录成功");
    } catch (e) {
        showNotice(e.message, "error");
    }
}
async function open(mode, targetId = "") {
    try {
        chat.value = { mode, targetId };
        messages.value = (await emitAck("chat:open", chat.value)).messages;
        view.value = "chat";
    } catch (e) {
        showNotice(e.message, "error");
    }
}
async function send() {
    if (text.value.trim())
        try {
            await emitAck("chat:send", {
                ...chat.value,
                message: text.value,
                clientMessageId: crypto.randomUUID(),
            });
            text.value = "";
        } catch (e) {
            showNotice(e.message, "error");
        }
}
const pick = () =>
    users.value
        .filter((u) => u.id !== me.value.id && confirm(`选择 ${u.name}？`))
        .map((u) => u.id);
async function task() {
    const title = prompt("签到任务标题");
    if (!title) return;
    try {
        await api.task({ title, assigneeIds: pick() });
        showNotice("签到任务已发布");
    } catch (e) {
        showNotice(e.message, "error");
    }
}
async function group() {
    const name = prompt("群组名称");
    if (!name) return;
    try {
        await api.group({ name, memberIds: pick() });
        showNotice("群组已创建");
    } catch (e) {
        showNotice(e.message, "error");
    }
}
async function post() {
    const content = prompt("帖子内容");
    if (!content) return;
    try {
        await api.post(content);
        showNotice("帖子已发布");
    } catch (e) {
        showNotice(e.message, "error");
    }
}
async function checkinTask(id) {
    try {
        await api.checkin(id);
        showNotice("签到成功");
    } catch (e) {
        showNotice(e.message, "error");
    }
}
async function startSpeedTest() {
    try {
        run.value = await api.speed({ concurrency: 10, durationSeconds: 10 });
        showNotice("压测任务已启动");
    } catch (e) {
        showNotice(e.message, "error");
    }
}
function logout() {
    setToken("");
    socket.disconnect();
    me.value = null;
}
onMounted(() => {
    socket.on("app:bootstrap", (x) => {
        users.value = x.contacts || [];
        contactPage.value = 1;
        groups.value = x.groups;
        posts.value = x.posts;
        tasks.value = x.checkins;
    });
    socket.on("presence:update", (x) => {
        const on = new Set(x.users.map((u) => u.id));
        users.value = users.value.map((u) => ({ ...u, online: on.has(u.id) }));
        contactPage.value = Math.min(contactPage.value, contactPageCount.value);
    });
    socket.on("network:user-added", (x) => {
        if (x.user.id !== me.value?.id && !users.value.some((user) => user.id === x.user.id)) users.value.push({ ...x.user, online: false });
    });
    socket.on("group:created", (x) => groups.value.unshift(x));
    socket.on("post:created", (x) => posts.value.unshift(x));
    socket.on("checkin:created", (x) => tasks.value.unshift(x));
    socket.on(
        "checkin:updated",
        (x) =>
        (tasks.value = tasks.value.map((t) =>
            (t.id || t._id) === (x.id || x._id) ? x : t,
        )),
    );
    socket.on("chat:message", (x) => messages.value.push(x));
    socket.on("speed-test:updated", (x) => (run.value = x));
});
</script>
<template>
    <main class="phone">
        <header class="topbar">
            <div class="brand"><span class="brand-mark">S</span><div><b>Social Chat</b><small>Emergency network</small></div></div>
            <button v-if="me" class="account-button" @click="logout"><span>{{ me.name.slice(0, 1).toUpperCase() }}</span>Hi, {{ me.name }}</button><span v-else class="auth-status">Sign up / in</span>
        </header>
        <section v-if="!me" class="auth-screen">
            <div class="auth-hero"><span>协作 · 响应 · 连接</span><h1>在这里，保持联络</h1><p>已有用户名直接登录；首次使用填写邮箱后自动注册。</p></div>
            <div class="auth-card">
                <label>用户名<input v-model="auth.name" autocomplete="username" placeholder="例如：Admin" /></label>
                <label>邮箱 <small>新用户必填</small><input v-model="auth.email" type="email" autocomplete="email" placeholder="name@example.com" /></label>
                <label>密码<input v-model="auth.password" type="password" autocomplete="current-password" placeholder="至少 6 位" @keyup.enter="enter" /></label>
                <button class="primary-action" @click="enter">进入协作网络 <span>→</span></button>
            </div>
        </section>
        <template v-else>
            <section v-if="view === 'home'" class="home-screen">
                <div class="welcome-card"><div><span>当前在线</span><h1>你好，{{ me.name }}</h1><p>{{ users.filter((user) => user.online).length }} 位联系人正在协作</p></div><i class="presence-orb" /></div>
                <div class="section-heading"><div><span>快捷入口</span><h2>开始协作</h2></div><small>{{ admin ? '管理员模式' : '成员模式' }}</small></div>
                <div class="tiles">
                    <button class="feature-tile public" @click="open('public')"><span>◌</span><b>公共聊天</b><small>实时广播</small></button><button class="feature-tile private" @click="view = 'private'"><span>⌁</span><b>私聊</b><small>联系人沟通</small></button><button class="feature-tile group" @click="view = 'groups'"><span>◫</span><b>群组聊天</b><small>任务小组</small></button><button class="feature-tile post" @click="view = 'posts'"><span>✦</span><b>发布动态</b><small>同步现场信息</small></button><button class="feature-tile checkin" @click="view = 'tasks'"><span>✓</span><b>签到</b><small>确认人员状态</small></button><button v-if="admin" class="feature-tile speed" @click="view = 'speed'"><span>↗</span><b>Speed test</b><small>服务压力测试</small></button>
                </div>
                <div class="section-heading contacts-heading"><div><span>你的网络</span><h2>联系人</h2></div><small>{{ sortedContacts.length }} 位</small></div>
                <p v-if="!pagedContacts.length" class="empty-contacts">暂无联系人</p>
                <button class="user" v-for="u in pagedContacts" :key="u.id" @click="open('private', u.id)">
                    <span class="avatar">{{ u.name.slice(0, 1).toUpperCase() }}</span><span class="user-name">{{ u.name }}<small>{{ u.role }}</small></span><span class="user-state"><i :class="{ on: u.online }" />{{ u.online ? '在线' : '离线' }}</span>
                </button>
                <div v-if="contactPageCount > 1" class="contact-pagination">
                    <button :disabled="contactPage === 1" @click="moveContactPage(-1)">上一页</button>
                    <span>{{ contactPage }} / {{ contactPageCount }}</span>
                    <button :disabled="contactPage === contactPageCount" @click="moveContactPage(1)">下一页</button>
                </div>
            </section>
            <section v-else class="content-screen">
                <button class="back-button" @click="view = 'home'">← 返回首页</button>
                <div v-if="view === 'chat'">
                    <div class="page-title"><span>{{ chat.mode === 'public' ? '公共频道' : chat.mode === 'private' ? '私聊' : '群组聊天' }}</span><h2>实时对话</h2></div>
                    <article class="chat-message" v-for="m in messages" :key="m._id">
                        {{ m.sender }}: {{ m.message }}
                    </article>
                    <div class="message-composer"><input v-model="text" @keyup.enter="send" placeholder="输入消息…" /><button @click="send">发送</button></div>
                </div>
                <div v-if="view === 'private'" class="list-page"><div class="page-title"><span>联系人</span><h2>选择一位成员</h2></div><button class="contact-choice" v-for="u in sortedContacts" :key="u.id" @click="open('private', u.id)"><span class="avatar">{{ u.name.slice(0, 1).toUpperCase() }}</span>{{ u.name }}<small>{{ u.online ? '在线' : '离线' }}</small></button>
                </div>
                <div v-if="view === 'groups'">
                    <div class="page-title"><span>协作空间</span><h2>群组聊天</h2></div><button class="primary-action" @click="group">新建群组</button>
                    <p v-for="g in groups" :key="g._id">
                        <button class="list-button" @click="open('group', g._id)">{{ g.name }} <span>→</span></button>
                    </p>
                </div>
                <div v-if="view === 'posts'">
                    <div class="page-title"><span>现场动态</span><h2>信息发布</h2></div><button class="primary-action" @click="post">发布帖子</button>
                    <article class="content-card" v-for="p in posts" :key="p._id">
                        <b>{{ p.authorName }}</b>
                        <p>{{ p.content }}</p>
                    </article>
                </div>
                <div v-if="view === 'tasks'">
                    <div class="page-title"><span>人员状态</span><h2>签到任务</h2></div><button v-if="admin" class="primary-action" @click="task">发布签到任务</button>
                    <article class="content-card" v-for="t in tasks" :key="t._id">
                        <b>{{ t.title }}</b> {{ t.checkedInUserIds?.length || 0 }}/{{
                            t.assigneeIds?.length || 0
                        }}
                        <button v-if="
                            t.assigneeIds?.map(String).includes(me.id) &&
                            !t.checkedInUserIds?.map(String).includes(me.id)
                        " @click="checkinTask(t.id || t._id)">
                            签到
                        </button>
                    </article>
                </div>
                <div v-if="view === 'speed' && admin">
                    <div class="page-title"><span>管理员工具</span><h2>Speed test</h2></div><button class="primary-action" @click="startSpeedTest">开始压测</button>
                    <pre v-if="run">{{ run }}</pre>
                </div>
            </section>
        </template>
        <div v-if="notice" class="toast" :class="notice.type" role="status">{{ notice.message }}</div>
        <AgentChat v-if="me" />
    </main>
</template>

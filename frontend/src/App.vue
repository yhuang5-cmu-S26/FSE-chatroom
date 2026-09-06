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
    notice = ref(null);
let noticeTimer;
const admin = computed(() => me.value?.role === "admin");
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
        users.value = x.users;
        groups.value = x.groups;
        posts.value = x.posts;
        tasks.value = x.checkins;
    });
    socket.on("presence:update", (x) => {
        const on = new Set(x.users.map((u) => u.id));
        users.value = users.value.map((u) => ({ ...u, online: on.has(u.id) }));
    });
    socket.on("network:user-added", (x) =>
        users.value.push({ ...x.user, online: false }),
    );
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
        <header>
            <b>Social Chat</b><button v-if="me" @click="logout">Hi, {{ me.name }}</button><span v-else>Sign up /
                in</span>
        </header>
        <section v-if="!me">
            <h1>社交网络</h1>
            <p>已有用户名仅校验密码；新用户名需填写邮箱后自动注册。</p>
            <input v-model="auth.name" placeholder="用户名" /><input v-model="auth.email" placeholder="邮箱（仅新用户必填）" /><input
                v-model="auth.password" type="password" placeholder="密码（6 位以上）" /><button @click="enter">Sign in / Sign up</button>
        </section>
        <template v-else>
            <section v-if="view === 'home'">
                <div class="tiles">
                    <button @click="open('public')">公共聊天</button><button @click="view = 'private'">私聊</button><button
                        @click="view = 'groups'">群组聊天</button><button @click="view = 'posts'">发帖</button><button
                        @click="view = 'tasks'">签到</button><button v-if="admin" @click="view = 'speed'">Speed
                        test</button>
                </div>
                <h2>联系人</h2>
                <button class="user" v-for="u in users" :key="u.id" @click="open('private', u.id)">
                    <i :class="{ on: u.online }" />{{ u.name }}
                    <small>{{ u.role }}</small>
                </button>
            </section>
            <section v-else>
                <button @click="view = 'home'">← 首页</button>
                <div v-if="view === 'chat'">
                    <h2>{{ chat.mode }} chat</h2>
                    <article v-for="m in messages" :key="m._id">
                        {{ m.sender }}: {{ m.message }}
                    </article>
                    <input v-model="text" @keyup.enter="send" placeholder="消息" /><button @click="send">
                        发送
                    </button>
                </div>
                <div v-if="view === 'private'" v-for="u in users.filter((u) => u.id !== me.id)" :key="u.id">
                    <button @click="open('private', u.id)">{{ u.name }}</button>
                </div>
                <div v-if="view === 'groups'">
                    <button @click="group">新建群组</button>
                    <p v-for="g in groups" :key="g._id">
                        <button @click="open('group', g._id)">{{ g.name }}</button>
                    </p>
                </div>
                <div v-if="view === 'posts'">
                    <button @click="post">发布帖子</button>
                    <article v-for="p in posts" :key="p._id">
                        <b>{{ p.authorName }}</b>
                        <p>{{ p.content }}</p>
                    </article>
                </div>
                <div v-if="view === 'tasks'">
                    <button v-if="admin" @click="task">发布签到任务</button>
                    <article v-for="t in tasks" :key="t._id">
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
                    <button @click="startSpeedTest">
                        开始
                    </button>
                    <pre v-if="run">{{ run }}</pre>
                </div>
            </section>
        </template>
        <div v-if="notice" class="toast" :class="notice.type" role="status">{{ notice.message }}</div>
        <AgentChat v-if="me" />
    </main>
</template>

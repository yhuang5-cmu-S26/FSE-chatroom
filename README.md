# ESN Chatroom

以聊天为核心的移动端社交网络，包含 public、private、group 三种实时聊天模式，签到任务、帖子与管理员 Speed Test。

用户关系使用独立的 `Relationship` 边表；注册时会为新用户和现有用户建立 accepted 关系。群成员关系由 `ChatGroup.members` 管理，服务端 Socket 在读取历史和发送消息前都会校验关系或成员资格。

生产环境应让 TLS 反向代理同时提供 SPA、`/api` 和 `/socket.io`，浏览器使用同源 HTTPS/WSS。Vite 的 HTTP/WS proxy 仅用于本地开发。

## 技术栈

- 前端: Vue 3 + Vite + Socket.IO Client
- 后端: Express + Socket.IO + MongoDB + Mongoose

## 目录

```text
frontend/
  src/components/
  src/services/
backend/
  src/config/
  src/middleware/
  src/models/
  src/routes/
  src/socket/
  src/utils/
```

## 运行

### 后端

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

未配置 MongoDB 时可使用 `DB_DRIVER=json`。`./dev.sh` 默认启用该模式，数据写入 `backend/tmp/mock-data/`。内置账号：`admin@example.com / admin123`、`user@example.com / user1234`。JSON 模式只用于本地开发，不支持多进程并发写入。

默认: http://localhost:3001

### 前端

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

默认: http://localhost:5173

## 关键环境变量

backend/.env:

```env
PORT=3001
MONGODB_URI=mongodb://127.0.0.1:27017/esn_chatroom
CORS_ORIGIN=http://localhost:5173
JWT_SECRET=change-me
JWT_EXPIRES_IN=7d
SOCKET_SEND_LIMIT=20
SOCKET_SEND_WINDOW_MS=10000
```

## 认证 API

- POST /api/auth/enter（不存在的邮箱注册，存在的邮箱登录）
- GET /api/auth/me

## 签到任务 API

- GET /api/checkins
- POST /api/checkins
- PATCH /api/checkins/:id/status
- PATCH /api/checkins/:id/admin (admin)
- DELETE /api/checkins/:id (admin)

## Socket 事件

客户端发出:
- presence:list
- chat:join-room
- chat:open-private
- chat:history
- chat:send-room
- chat:send-private

服务端推送:
- presence:update
- chat:private-room
- chat:history
- chat:broadcast
- chat:delivered
- chat:error
- system:message
- checkin:created
- checkin:updated
- checkin:deleted

## 压测脚本

```bash
cd backend
npm run bench
```

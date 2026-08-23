# ESN Chatroom

轻量级应急协作系统，包含：
- 实时群聊与私聊
- 在线用户与会话侧栏
- 消息 ACK、重试、离线补偿
- JWT 认证与基础 RBAC
- 签到任务看板（实时状态）与压测模块

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

- POST /api/auth/register
- POST /api/auth/login
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

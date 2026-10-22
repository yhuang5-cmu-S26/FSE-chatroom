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

## 开发测试与指标

```bash
cd backend
npm test                  # 权限、关系一致性、聊天授权与 Agent 契约
npm run test:performance  # 隔离环境中的 API/Socket 延迟、吞吐与投递率
npm run verify            # 后端测试 + 前端生产构建，并记录总耗时
```

报告输出到 `backend/tests/reports/`（已忽略，不提交运行时结果）。性能提升比例必须用相同机器、相同参数下的基线报告计算：

```bash
npm run test:performance:compare -- baseline.json current.json
```

本地 `verify` 耗时不能直接当作云端部署耗时；部署指标应由 CI/CD 平台记录。JSON mock 的性能结果也不能替代 MongoDB/Redis 生产环境压测。

## Agent 会话历史

Agent 使用 `AgentSession`（会话元数据）和 `AgentMessage`（独立消息）两张集合，按 `userId` 进行所有权隔离；消息以 `{ sessionId, createdAt }` 索引读取，避免将无限增长的历史嵌入单一文档。JSON Mock 位于 `backend/tmp/llm-session/`，MongoDB 模式下使用同名集合。

- `GET /api/agent/sessions`：当前用户的会话列表
- `GET /api/agent/sessions/:sessionId/messages`：当前用户的历史消息
- `POST /api/agent/chat`：创建/续写会话，服务端读取最近历史后调用 Planner
- `POST /api/agent/sessions/:sessionId/approve`：批准计划并启动执行 Graph
- `POST /api/agent/sessions/:sessionId/runs/:runId/resume`：回复 LangGraph interrupt，并从 checkpoint 恢复执行

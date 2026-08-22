# ESN 应急灾害响应系统（基于实时聊天平台扩展）

本仓库提供一个前后端分离的初始化版本（MVP skeleton），用于后续迭代实现应急灾害响应能力。当前版本覆盖：实时通信、人员签到、求助调度、位置服务。

## 目录结构

```text
.
├── frontend/                 # Vue 3 + Vite 前端
│   ├── src/
│   │   ├── components/       # 聊天/签到/求助/调度/位置页面组件
│   │   └── services/         # API 封装与 Socket 客户端
│   └── .env.example
├── backend/                  # Express + Socket.IO + MongoDB 后端
│   ├── src/
│   │   ├── config/           # MongoDB 连接
│   │   ├── models/           # Mongoose 数据模型
│   │   ├── routes/           # REST API 路由
│   │   ├── socket/           # 实时通信事件
│   │   ├── app.js
│   │   └── server.js
│   └── .env.example
└── README.md
```

## 环境要求

- Node.js >= 18
- npm >= 9
- MongoDB（本地或远程实例）

## 快速启动

### 1) 启动后端

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

后端默认地址：`http://localhost:3001`

### 2) 启动前端

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

前端默认地址：`http://localhost:5173`

## MongoDB 配置

在 `backend/.env` 中设置：

```env
PORT=3001
MONGODB_URI=mongodb://127.0.0.1:27017/esn_chatroom
CORS_ORIGIN=http://localhost:5173
```

## 主要 REST API（示例）

- 健康检查：`GET /api/health`
- 签到：
  - `POST /api/checkins`
  - `GET /api/checkins`
- 求助：
  - `POST /api/help-requests`
  - `GET /api/help-requests`
  - `PATCH /api/help-requests/:id/status`
- 位置：
  - `POST /api/locations`
  - `GET /api/locations`

示例请求：

```bash
curl -X POST http://localhost:3001/api/help-requests \
  -H 'Content-Type: application/json' \
  -d '{
    "description": "Need medical support",
    "priority": "high",
    "location": {"latitude": 40.44, "longitude": -79.95, "detail": "Gate A"}
  }'
```

## Socket 事件（示例）

- 客户端发送：`chat:send` `{ sender, message }`
- 服务端广播：`chat:broadcast` `{ id, sender, message, createdAt }`
- 服务端系统消息：`system:message`
- 服务端调度广播：`help:status-updated` `{ id, status, updatedAt }`

## 后续 TODO

- 聊天历史分页与鉴权
- 调度权限模型（指挥员/救援队）
- 地图组件接入（Leaflet/Mapbox）
- 告警分级与自动派单策略
- 端到端测试与部署配置

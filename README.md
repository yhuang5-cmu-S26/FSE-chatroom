# FSE-chatroom

面向灾害响应的全栈协作平台（最小可运行实现），包含：

- 依赖注入架构（`src/di/container.js`）实现业务层与数据层解耦
- MongoDB高频查询优化（复合索引 + 投影裁剪 + 热点查询路径）
- Socket.io room-based 路由（私聊/群聊）+ 发布订阅 + 异步消息队列 + backpressure
- GitHub Actions CI/CD（自动测试 + Render deploy hook）

## Run

```bash
npm install
npm start
```

## Test

```bash
npm test
```

## Environment

- `MONGO_URL` (default `mongodb://localhost:27017`)
- `MONGO_DB` (default `fse_chatroom`)
- `PORT` (default `3000`)
- `CHAT_MAX_QUEUE` (default `1000`)
- `RENDER_DEPLOY_HOOK_URL` (GitHub Actions secret)

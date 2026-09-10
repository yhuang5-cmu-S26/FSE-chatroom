# ESN Chatroom 技术栈与架构说明

## 1. 项目定位

ESN Chatroom 是一个面向应急协作场景的实时社交与 Agent 应用。系统提供公共、私聊和群聊通信，结合签到、帖子与管理员压测能力；Agent 将用户自然语言请求转换为受约束的执行计划，在权限校验和人工审批后调用内部业务 Tool 或外部 MCP Tool。

## 2. 技术栈

| 层级 | 技术 | 用途 |
| --- | --- | --- |
| Web 前端 | Vue 3、Vite | 单页应用、Agent 对话界面与实时协作界面 |
| 后端 | Node.js、Express 5 | REST API、认证、业务服务与 Agent API |
| 实时通信 | Socket.IO | Presence、公共/私聊/群聊 Room、业务事件推送 |
| 数据存储 | MongoDB、Mongoose | 用户、关系、聊天、Agent 会话与工作流审计数据 |
| 本地开发存储 | JSON 文件存储 | 无 MongoDB 时的本地 Mock 与测试支持；不用于生产并发写入 |
| 身份与授权 | JWT、RBAC、资源所有权校验 | 用户认证、管理员操作、会话和工作流隔离 |
| Agent 约束 | JSON Schema、Ajv、Structured Outputs | 约束模型输出、Action 参数及能力边界 |
| Agent 编排 | LangGraph `StateGraph` + MongoDB Workflow State Machine | 规划路由、多步骤 Action 执行、失败分支、审批后的恢复与审计 |
| 工具互联 | MCP、Streamable HTTP、`@modelcontextprotocol/client` | 以统一协议访问天气等外部工具服务 |
| 模型服务 | OpenAI-compatible Chat Completions API（可对接 vLLM） | Planner 推理与流式生成 |
| 工程质量 | Node Test、集成测试、Socket/API 压测脚本 | 权限、Agent 契约、吞吐与延迟验证 |

## 3. 总体架构

```text
┌─────────────────────────────────────────────────────────────┐
│ Vue 3 + Vite                                                  │
│  - REST API Client  - Socket.IO Client  - Agent Chat UI       │
└───────────────┬───────────────────────────────┬─────────────┘
                │ HTTPS / SSE                    │ WSS
                ▼                                ▼
┌─────────────────────────────────────────────────────────────┐
│ Node.js / Express + Socket.IO                                 │
│  API / JWT / RBAC / Relationship & Group Authorization        │
│  Agent Session / Workflow API / SSE Proxy                     │
└───────┬────────────────────┬───────────────────────┬────────┘
        │                    │                       │
        ▼                    ▼                       ▼
┌───────────────┐  ┌────────────────────┐  ┌──────────────────┐
│ MongoDB        │  │ Agent Orchestrator │  │ Socket.IO Rooms  │
│ Mongoose       │  │ Planner / Workflow │  │ Presence / Chat  │
└───────────────┘  └───────┬────────────┘  └──────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
   ┌────────────────────┐      ┌─────────────────────────────┐
   │ Local Business     │      │ MCP Client                   │
   │ Tools              │      │ Streamable HTTP              │
   │ Check-in / Post    │      └──────────────┬──────────────┘
   └────────────────────┘                     ▼
                                  ┌───────────────────────────┐
                                  │ External MCP Server       │
                                  │ Weather / Other Services  │
                                  └───────────────────────────┘
```

## 4. 后端目录结构

```text
backend/src/
├── app.js                     # Express middleware、路由与限流
├── server.js                  # HTTP(S)、Socket.IO、数据库启动入口
├── config/
│   ├── db.js                  # MongoDB / JSON Mock 存储切换
│   └── mcp/                   # MCP Server 与 Action 路由配置
├── middleware/
│   └── auth.js                # JWT 认证与角色授权
├── models/                    # Mongoose/JSON 数据模型
│   ├── AgentSession.js
│   ├── AgentMessage.js
│   ├── WorkflowRun.js
│   ├── WorkflowStep.js
│   ├── ToolCall.js
│   ├── Approval.js
│   └── WorkflowEvent.js
├── routes/
│   ├── agent.js               # Agent Chat、审批、重试、交接、审计 API
│   ├── auth.js
│   ├── checkins.js
│   ├── groups.js
│   ├── posts.js
│   └── users.js
├── services/
│   ├── agent/
│   │   ├── planner.js         # Planner、计划校验、统一 Action 分发
│   │   ├── workflow.js        # LangGraph 规划图与 Action 执行图
│   │   ├── sessions.js        # 会话历史与上下文压缩
│   │   ├── evaluation.js      # Agent 结果评估与错误分类
│   │   ├── weatherAlertEvaluator.js # 天气结果判定与发帖文案生成
│   │   └── tools/
│   │       ├── local.js       # 内部业务 Tool
│   │       └── mcp.js         # MCP Action 适配层
│   ├── mcp/
│   │   └── client.js          # MCP Streamable HTTP Client
│   └── workflow/
│       └── state.js           # 工作流状态、审计、审批与恢复
└── socket/                    # Room、消息与在线状态事件处理
```

## 5. Agent 执行结构

### LangGraph 编排实现

```text
POST /api/agent/chat
  → JWT / session ownership validation
  → load prompt history
  → LangGraph planningGraph: plan → conversation | command | rejected
  → LLM planner + JSON Schema + capability + RBAC validation
  → create WorkflowRun / WorkflowStep
  → return Todo for approval

POST /api/agent/sessions/:sessionId/approve
  → create Approval
  → LangGraph executionGraph: execute_step → next_step | finalize
  → Local Tool or MCP Tool
  → persist ToolCall / WorkflowEvent / result
  → succeeded | failed | handed_off
```

LangGraph 覆盖模型规划及审批后的 Action 编排；Express 仍负责 JWT、会话/资源所有权、HTTP/SSE 和 Socket.IO。`WorkflowRun`、`WorkflowStep`、`Approval`、`ToolCall` 与 `WorkflowEvent` 是当前跨请求恢复与审计的唯一业务状态源，避免与 Graph state 形成双写状态源。

## 6. 内外部 Tool 通道

```text
Agent execution node
  → executeAgentAction(action, actor, context)
    ├─ Local Tool
    │   → agent/tools/local.execute()
    │   → Check-in query / Post draft / Post publish / Status summary
    └─ MCP Tool
        → agent/tools/mcp.executeActions()
        → callMcpTool()
        → Streamable HTTP MCP Server
        → Weather or other external provider
```

所有 Action 在分发前必须经过：能力 allowlist、参数 JSON Schema、RBAC、资源范围和人工审批（写操作）校验。模型只生成计划，不能直接获取数据库连接、业务服务实例或任意网络访问能力。

当前天气 Action 保持 `{ latitude, longitude, hours }` 这一内部契约；MCP 适配层会将其转换为 Open-Meteo `openmeteo_get_forecast` 所需的 `{ latitude, longitude, forecast_days, hourly_variables }`，避免将内部字段直接透传给外部 Tool。由于上游按整天返回 hourly 数据，适配层会再按 `hours` 截断 `hourly` 记录，并在结果中写入 `requestedHours`。

对于“若有暴雨则发布预警”类请求，Planner 只生成天气查询，并设置 `weatherAlert.evaluateForPost`。天气 Tool 完成后，LangGraph 使用一次独立的 LLM 调用与 `weather-alert.md` 中的 JSON Schema 返回 `{ shouldPublish, reason, evidence, post }`。当 `shouldPublish` 为 `true` 时，JS 将 `{ title, content }` 组装为 `post.publish.content`，追加待审批步骤并暂停；用户第二次确认后才执行内部帖子发布 Tool。

## 7. 数据与安全边界

- `AgentSession` 与 `AgentMessage` 按 `userId` 进行所有权隔离；历史消息按 `{ sessionId, createdAt }` 查询，避免无限增长嵌入单一文档。
- `WorkflowRun`、`WorkflowStep`、`ToolCall`、`Approval`、`WorkflowEvent` 构成可审计的执行记录。
- Socket 消息在服务端校验 JWT、用户关系或群成员资格，并由服务端注入身份，客户端不得声明消息发送者。
- `post.publish` 使用幂等键避免工作流重试时重复创建数据。
- MCP Server 仅通过配置 allowlist 访问，并设置连接与工具调用超时；生产环境应部署在受 TLS、认证和网络策略保护的入口后。

## 8. 关键接口

| 接口 | 说明 |
| --- | --- |
| `POST /api/agent/chat` | 非流式规划与会话持久化 |
| `POST /api/agent/chat/stream` | SSE 流式规划输出 |
| `GET /api/agent/sessions` | 当前用户 Agent 会话列表 |
| `GET /api/agent/sessions/:sessionId/messages` | 当前用户会话消息 |
| `POST /api/agent/sessions/:sessionId/approve` | 审批计划并执行后续步骤 |
| `POST /api/agent/sessions/:sessionId/runs/:runId/retry` | 重试失败工作流 |
| `POST /api/agent/sessions/:sessionId/handoff` | 人工接管未完成工作流 |
| `GET /api/agent/runs/:runId` | 查询工作流、步骤、工具调用和事件 |

## 9. 运行与部署建议

- 浏览器仅访问 SPA、`/api` 和 `/socket.io`；生产环境由 TLS 反向代理提供同源 HTTPS/WSS。
- LLM 服务可使用 OpenAI-compatible endpoint，例如容器化 vLLM 的 `/v1/chat/completions`；API Key 必须只保存在服务端环境变量。
- MCP Server 与业务后端分离部署时，应通过 HTTPS、服务间 token 或 mTLS 进行认证；不要将 MCP 端口直接暴露给浏览器。
- MongoDB 用于生产持久化；JSON Mock 仅用于本地开发和单进程测试。
- 对工作流执行、MCP 调用和模型请求分别记录延迟、错误类型、重试次数与关联 ID，便于定位端到端故障。

## 10. 测试与性能

项目包含 API、Socket.IO、Agent 契约、上下文压缩和性能测试。现有本地基准应仅用于回归比较；云端性能以实际部署环境和 CI/CD 采样结果为准。

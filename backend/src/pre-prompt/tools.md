# Agent Tool Contract

This file documents the backend tools that may execute an approved Planner action. It is a machine-readable execution contract, not model-generated code. `action` must match `capabilities.md` exactly. The service refuses to start if this file, the capability manifest, and the JavaScript handler registry are out of sync.

```json
[
  {
    "action": "checkin.list_absentees",
    "effect": "read",
    "description": "读取指定签到任务，并返回尚未签到的受指派用户 ID。",
    "result": { "taskId": "string", "absentUserIds": "string[]" }
  },
  {
    "action": "post.draft",
    "effect": "read",
    "description": "仅根据主题生成帖子草稿；不创建帖子，也不发送实时事件。",
    "result": { "draft": "string" }
  },
  {
    "action": "post.publish",
    "effect": "write",
    "description": "创建帖子，并在成功后发出 post:created Socket.IO 事件。",
    "result": { "postId": "string" }
  },
  {
    "action": "status.summarize",
    "effect": "read",
    "description": "汇总签到任务数与近期帖子数量。",
    "result": { "taskCount": "number", "recentPostCount": "number" }
  },
  {
    "action": "mcp.weather.forecast",
    "effect": "read",
    "description": "调用 allowlist 中的外部 MCP 天气服务，返回天气预报与预警原始结构化结果。",
    "result": { "provider": "mcp", "server": "weather", "result": "object" }
  }
]
```

Rules: an approved plan is the only path to a tool call; authorization and argument validation happen before this contract is dispatched. A `write` action must retain `requiresConfirmation: true` in `capabilities.md`.

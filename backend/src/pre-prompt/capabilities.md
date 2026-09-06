# Capability Manifest

The following machine-readable manifest is authoritative. `action` is the only action identifier sent from Planner to backend. `inputSchema` defines `action.arguments`; no unspecified argument is allowed.

```json
[
  {
    "action": "checkin.list_absentees",
    "title": "签到缺勤分析",
    "description": "查询指定签到任务的未签到人员",
    "requiresConfirmation": false,
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": { "checkinId": { "type": "string", "minLength": 1, "maxLength": 64 } },
      "required": ["checkinId"]
    }
  },
  {
    "action": "post.draft",
    "title": "帖子草稿生成",
    "description": "根据主题或已提供的事实生成帖子草稿",
    "requiresConfirmation": false,
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": { "topic": { "type": "string", "minLength": 1, "maxLength": 500 } },
      "required": ["topic"]
    }
  },
  {
    "action": "post.publish",
    "title": "帖子发布",
    "description": "确认后发布帖子",
    "requiresConfirmation": true,
    "requiredRole": "admin",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": { "content": { "type": "string", "minLength": 1, "maxLength": 2000 } },
      "required": ["content"]
    }
  },
  {
    "action": "status.summarize",
    "title": "态势摘要",
    "description": "汇总当前任务、帖子和在线人员状态",
    "requiresConfirmation": false,
    "inputSchema": { "type": "object", "additionalProperties": false }
  },
  {
    "action": "mcp.weather.forecast",
    "title": "外部天气核验",
    "description": "通过受控 MCP 天气服务查询指定坐标未来时段的天气与预警",
    "requiresConfirmation": false,
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "latitude": { "type": "number", "minimum": -90, "maximum": 90 },
        "longitude": { "type": "number", "minimum": -180, "maximum": 180 },
        "hours": { "type": "integer", "minimum": 1, "maximum": 72 }
      },
      "required": ["latitude", "longitude", "hours"]
    }
  }
]
```

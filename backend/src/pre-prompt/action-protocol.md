# Planner JSON Action Protocol

The Planner output must match the following JSON Schema. Each `todo[].action.type` must appear in the Capability Manifest, and `todo[].action.arguments` must validate against that action's `inputSchema`. The backend owns authorization: an action is rejected when the actor does not have its `requiredRole`, even if the model labels it coverable.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["intent", "reply", "todo", "coverage"],
  "properties": {
    "intent": { "enum": ["conversation", "command"] },
    "reply": { "type": "string", "minLength": 1, "maxLength": 400 },
    "todo": {
      "type": "array",
      "maxItems": 8,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "title", "action"],
        "properties": {
          "id": { "type": "string", "minLength": 1, "maxLength": 64 },
          "title": { "type": "string", "minLength": 1, "maxLength": 300 },
          "action": {
            "type": "object",
            "additionalProperties": false,
            "required": ["type", "arguments"],
            "properties": {
              "type": { "type": "string", "minLength": 1, "maxLength": 80 },
              "arguments": { "type": "object" }
            }
          }
        }
      }
    },
    "coverage": {
      "type": "object",
      "additionalProperties": false,
      "required": ["canCover", "reason", "unsupported"],
      "properties": {
        "canCover": { "type": "boolean" },
        "reason": { "type": "string", "minLength": 1, "maxLength": 600 },
        "unsupported": { "type": "array", "items": { "type": "string", "maxLength": 300 }, "maxItems": 8 }
      }
    },
    "weatherAlert": {
      "type": "object",
      "additionalProperties": false,
      "required": ["evaluateForPost"],
      "properties": {
        "evaluateForPost": { "type": "boolean" }
      }
    }
  },
  "allOf": [
    {
      "if": { "properties": { "intent": { "const": "conversation" } } },
      "then": { "properties": { "todo": { "maxItems": 0 } } }
    },
    {
      "if": { "properties": { "intent": { "const": "command" } } },
      "then": { "properties": { "todo": { "minItems": 1 } } }
    },
    {
      "if": {
        "required": ["weatherAlert"],
        "properties": { "weatherAlert": { "properties": { "evaluateForPost": { "const": true } } } }
      },
      "then": {
        "properties": {
          "intent": { "const": "command" },
          "todo": {
            "minItems": 1,
            "maxItems": 1,
            "items": {
              "properties": {
                "action": {
                  "properties": { "type": { "const": "mcp.weather.forecast" } }
                }
              }
            }
          }
        }
      }
    }
  ]
}
```

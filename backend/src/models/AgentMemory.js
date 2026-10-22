const path = require("node:path");
const mongoose = require("mongoose");
const { createJsonModel } = require("../config/jsonModel");

const agentMemorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "AgentSession", default: null, index: true },
    kind: { type: String, enum: ["thread", "long_term"], required: true, index: true },
    key: { type: String, required: true, maxlength: 160 },
    value: { type: mongoose.Schema.Types.Mixed, default: {} },
    version: { type: Number, default: 1 },
  },
  { timestamps: true },
);

agentMemorySchema.index({ userId: 1, sessionId: 1, kind: 1, key: 1 }, { unique: true });

module.exports = process.env.DB_DRIVER === "json"
  ? createJsonModel("agent-memories", { value: {}, version: 1 }, {
      dataDir: process.env.AGENT_MEMORY_DATA_DIR || process.env.AGENT_SESSION_DATA_DIR ||
        process.env.LLM_SESSION_DATA_DIR || path.resolve(__dirname, "../../tmp/llm-session"),
    })
  : mongoose.model("AgentMemory", agentMemorySchema);

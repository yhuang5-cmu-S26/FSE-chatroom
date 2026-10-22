const path = require("node:path");
const mongoose = require("mongoose");
const { createJsonModel } = require("../config/jsonModel");

const agentMessageSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AgentSession",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true, maxlength: 4000 },
    planner: {
      mode: { type: String, default: "" },
      intent: {
        type: String,
        enum: ["conversation", "command"],
        default: "conversation",
      },
      runId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkflowRun" },
      todo: [
        {
          id: String,
          title: String,
          action: { type: String, arguments: mongoose.Schema.Types.Mixed },
          status: String,
          rejectionReason: String,
          requiresConfirmation: Boolean,
        },
      ],
      coverage: { canCover: Boolean, reason: String, unsupported: [String] },
      weatherAlert: {
        evaluateForPost: { type: Boolean, default: false },
        sourceStepId: String,
        decision: {
          shouldPublish: Boolean,
          reason: String,
          evidence: mongoose.Schema.Types.Mixed,
          post: { title: String, content: String },
        },
        followUpApproval: { requestedAt: Date, reason: String },
      },
      requiresConfirmation: Boolean,
      approvalStatus: {
        type: String,
        enum: [
          "not_required",
          "pending",
          "approved",
          "awaiting_input",
          "executed",
          "failed",
          "rejected",
          "handed_off",
        ],
        default: "not_required",
      },
      requestedAt: Date,
      planningLatencyMs: Number,
      usage: {
        promptTokens: { type: Number, min: 0 },
        completionTokens: { type: Number, min: 0 },
        totalTokens: { type: Number, min: 0 },
      },
      handoff: { requestedAt: Date, reason: { type: String, maxlength: 500 } },
      execution: {
        status: String,
        interrupt: mongoose.Schema.Types.Mixed,
        steps: [
          {
            id: String,
            status: String,
            result: mongoose.Schema.Types.Mixed,
            error: String,
            errorType: String,
          },
        ],
        completedAt: Date,
      },
      model: { type: String, default: "" },
    },
  },
  { timestamps: true },
);
agentMessageSchema.index({ sessionId: 1, createdAt: 1 });
agentMessageSchema.index({ userId: 1, createdAt: -1 });

module.exports =
  process.env.DB_DRIVER === "json"
    ? createJsonModel(
        "messages",
        {},
        {
          dataDir:
            process.env.AGENT_SESSION_DATA_DIR ||
            process.env.LLM_SESSION_DATA_DIR ||
            path.resolve(__dirname, "../../tmp/llm-session"),
        },
      )
    : mongoose.model("AgentMessage", agentMessageSchema);

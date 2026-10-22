const path = require("node:path");
const mongoose = require("mongoose");
const { createJsonModel } = require("../config/jsonModel");

const schema = new mongoose.Schema(
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
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AgentMessage",
      required: true,
      unique: true,
    },
    state: {
      type: String,
      enum: [
        "awaiting_approval",
        "awaiting_input",
        "running",
        "succeeded",
        "failed",
        "rejected",
        "handed_off",
      ],
      required: true,
      index: true,
    },
    requestedAt: { type: Date, required: true },
    completedAt: Date,
    stepCount: { type: Number, required: true, min: 1 },
    metadata: { model: String, plannerMode: String },
  },
  { timestamps: true },
);
schema.index({ userId: 1, createdAt: -1 });

module.exports =
  process.env.DB_DRIVER === "json"
    ? createJsonModel(
        "workflow-runs",
        {},
        {
          dataDir:
            process.env.WORKFLOW_DATA_DIR ||
            path.resolve(__dirname, "../../tmp/workflow-data"),
        },
      )
    : mongoose.model("WorkflowRun", schema);

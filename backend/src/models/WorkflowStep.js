const path = require("node:path");
const mongoose = require("mongoose");
const { createJsonModel } = require("../config/jsonModel");

const schema = new mongoose.Schema(
  {
    runId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkflowRun",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sequence: { type: Number, required: true, min: 0 },
    title: { type: String, required: true, maxlength: 300 },
    action: {
      type: { type: String, required: true },
      arguments: mongoose.Schema.Types.Mixed,
    },
    state: {
      type: String,
      enum: [
        "planned",
        "running",
        "succeeded",
        "failed",
        "rejected",
        "skipped",
      ],
      default: "planned",
      index: true,
    },
    output: mongoose.Schema.Types.Mixed,
    error: { type: String, maxlength: 1000 },
    errorType: { type: String, maxlength: 80 },
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true },
);
schema.index({ runId: 1, sequence: 1 }, { unique: true });

module.exports =
  process.env.DB_DRIVER === "json"
    ? createJsonModel(
        "workflow-steps",
        {},
        {
          dataDir:
            process.env.WORKFLOW_DATA_DIR ||
            path.resolve(__dirname, "../../tmp/workflow-data"),
        },
      )
    : mongoose.model("WorkflowStep", schema);

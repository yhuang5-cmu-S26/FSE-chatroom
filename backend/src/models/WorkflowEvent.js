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
    type: { type: String, required: true, maxlength: 80, index: true },
    payload: mongoose.Schema.Types.Mixed,
    occurredAt: { type: Date, required: true },
  },
  { timestamps: true },
);
schema.index({ runId: 1, occurredAt: 1 });

module.exports =
  process.env.DB_DRIVER === "json"
    ? createJsonModel(
        "workflow-events",
        {},
        {
          dataDir:
            process.env.WORKFLOW_DATA_DIR ||
            path.resolve(__dirname, "../../tmp/workflow-data"),
        },
      )
    : mongoose.model("WorkflowEvent", schema);

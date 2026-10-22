const path = require("node:path");
const { JsonMemoryCheckpointer } = require("../agent/memory/checkpointer");

function workflowCheckpointFile() {
  const dataDir =
    process.env.WORKFLOW_DATA_DIR ||
    path.resolve(__dirname, "../../../tmp/workflow-data");
  return path.join(path.resolve(dataDir), "workflow-checkpoints.json");
}

// 执行图和对话记忆使用不同文件，避免生命周期、清理策略互相影响。
const workflowCheckpointer = new JsonMemoryCheckpointer({
  filePath: workflowCheckpointFile(),
});

function workflowThreadId(runId, userId) {
  return `workflow:${String(userId)}:${String(runId)}`;
}

module.exports = { workflowCheckpointer, workflowThreadId };

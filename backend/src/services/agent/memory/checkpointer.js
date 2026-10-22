const fs = require("node:fs");
const path = require("node:path");
const { MemorySaver } = require("@langchain/langgraph");

function defaultCheckpointFile() {
  const dataDir =
    process.env.AGENT_MEMORY_DATA_DIR ||
    process.env.AGENT_SESSION_DATA_DIR ||
    process.env.LLM_SESSION_DATA_DIR ||
    path.resolve(__dirname, "../../../../tmp/llm-session");
  return path.join(path.resolve(dataDir), "memory-checkpoints.json");
}

function checkpointJsonReplacer(_key, value) {
  if (ArrayBuffer.isView(value)) {
    return {
      __checkpointBytes: Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).toString("base64"),
    };
  }
  return value;
}

function checkpointJsonReviver(_key, value) {
  if (value && typeof value.__checkpointBytes === "string")
    return Uint8Array.from(Buffer.from(value.__checkpointBytes, "base64"));
  return value;
}

// v1 直接 JSON.stringify(Uint8Array)，会得到 { "0": 123, ... }；读取时
// 将这种旧格式恢复为字节数组，避免开发环境升级后丢失已有 checkpoint。
function restoreLegacyBytes(value) {
  if (Array.isArray(value)) return value.map(restoreLegacyBytes);
  if (!value || typeof value !== "object") return value;
  const keys = Object.keys(value);
  if (keys.length && keys.every((key) => /^\d+$/.test(key))) {
    return Uint8Array.from(
      keys
        .sort((left, right) => Number(left) - Number(right))
        .map((key) => value[key]),
    );
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      restoreLegacyBytes(child),
    ]),
  );
}

/**
 * 开发/测试环境使用的 JSON Checkpointer。
 *
 * MemorySaver 提供标准 LangGraph checkpoint 读写；这里额外提供 thread 级
 * 串行执行能力，因为 Checkpointer 的 put/get 接口本身不等同于事务锁，无法阻止
 * 两个请求同时从同一个旧 checkpoint 开始执行。
 *
 * checkpoint 会原子写入本地 JSON 文件，因此单进程重启后仍可恢复；thread 锁
 * 仍然只在当前进程有效。生产环境应替换为数据库 Checkpointer，并使用数据库
 * 租约或乐观并发控制。
 */
class JsonMemoryCheckpointer extends MemorySaver {
  constructor({ filePath = defaultCheckpointFile() } = {}) {
    super();
    this.filePath = path.resolve(filePath);
    this.threadQueues = new Map();
    this.persistQueue = Promise.resolve();
    this.loadFromDisk();
  }

  loadFromDisk() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) return;
    let persisted = JSON.parse(
      fs.readFileSync(this.filePath, "utf8"),
      checkpointJsonReviver,
    );
    if (!persisted || ![1, 2].includes(persisted.version))
      throw new Error(`Unsupported memory checkpoint file: ${this.filePath}`);
    if (persisted.version === 1) persisted = restoreLegacyBytes(persisted);
    this.storage = persisted.storage || Object.create(null);
    this.writes = persisted.writes || Object.create(null);
  }

  /** 将不同 thread 的并发写入合并到一条原子文件写队列。 */
  async persistToDisk() {
    const persist = this.persistQueue
      .catch(() => {})
      .then(() => {
        const temporary = `${this.filePath}.${process.pid}.tmp`;
        const payload = {
          version: 2,
          storage: this.storage,
          writes: this.writes,
        };
        fs.writeFileSync(
          temporary,
          `${JSON.stringify(payload, checkpointJsonReplacer, 2)}\n`,
        );
        fs.renameSync(temporary, this.filePath);
      });
    this.persistQueue = persist;
    return persist;
  }

  async put(config, checkpoint, metadata, newVersions) {
    const nextConfig = await super.put(
      config,
      checkpoint,
      metadata,
      newVersions,
    );
    await this.persistToDisk();
    return nextConfig;
  }

  async putWrites(config, writes, taskId) {
    await super.putWrites(config, writes, taskId);
    await this.persistToDisk();
  }

  async deleteThread(threadId) {
    await super.deleteThread(threadId);
    await this.persistToDisk();
  }

  /** 同一个 key 串行执行，不同 key 仍可并发。 */
  async withThreadLock(threadId, operation) {
    const key = String(threadId);
    const previous = this.threadQueues.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    this.threadQueues.set(key, current);
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (this.threadQueues.get(key) === current) this.threadQueues.delete(key);
    }
  }
}

const memoryCheckpointer = new JsonMemoryCheckpointer();

/** Checkpoint 按用户和 session 双重隔离，避免不同用户状态串线。 */
function memoryThreadId(sessionId, userId) {
  return `memory:${String(userId)}:${String(sessionId)}`;
}

module.exports = {
  JsonMemoryCheckpointer,
  memoryCheckpointer,
  memoryThreadId,
};

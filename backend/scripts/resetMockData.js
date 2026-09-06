#!/usr/bin/env node

/*
 * Reset the mock data for the development environment.
  ```
  cd /home/hyx/workspace/FSE-chatroom/backend
  npm run reset:mock
  ```
 */

// Resets the JSON persistence used when DB_DRIVER=json.  It intentionally
// keeps the JSON files themselves so the development server can start without
// recreating its directory layout.
const fs = require("node:fs");
const path = require("node:path");

const tmpRoot = process.env.MOCK_TMP_DIR
  ? path.resolve(process.env.MOCK_TMP_DIR)
  : path.resolve(__dirname, "..", "tmp");
const now = new Date().toISOString();

// bcrypt hash for the development-only password: admin123
const admin = {
  _id: "000000000000000000000001",
  name: "Admin",
  usernameKey: "admin",
  email: "admin@example.com",
  passwordHash: "$2a$10$rrOv6iAzWt9yexR3zIaMIus0Ve0yWqHSalHG.WKV3PzbEXQm/LU2.",
  role: "admin",
  active: true,
  createdAt: now,
  updatedAt: now,
};

const collections = {
  "mock-data": {
    "users.json": [admin],
    "relationships.json": [],
    "messages.json": [],
    "groups.json": [],
    "posts.json": [],
    "checkins.json": [],
    "speed-tests.json": [],
  },
  "llm-session": { "sessions.json": [], "messages.json": [] },
  "workflow-data": {
    "workflow-runs.json": [],
    "workflow-steps.json": [],
    "tool-calls.json": [],
    "approvals.json": [],
    "workflow-events.json": [],
  },
};

for (const [directory, files] of Object.entries(collections)) {
  const targetDir = path.join(tmpRoot, directory);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const [filename, rows] of Object.entries(files)) {
    fs.writeFileSync(
      path.join(targetDir, filename),
      `${JSON.stringify(rows, null, 2)}\n`,
    );
  }
}

console.log(`Mock data reset in ${tmpRoot}`);
console.log("Retained user: Admin / admin123");

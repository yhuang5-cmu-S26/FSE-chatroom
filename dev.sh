#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

cleanup() {
  trap - TERM INT EXIT
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}

trap cleanup TERM INT EXIT

command -v npm >/dev/null 2>&1 || {
  echo "错误：未找到 npm，请先安装 Node.js。" >&2
  exit 1
}

for project_dir in "$BACKEND_DIR" "$FRONTEND_DIR"; do
  if [[ ! -d "$project_dir/node_modules" ]]; then
    echo "正在安装 $(basename "$project_dir") 依赖..."
    (cd "$project_dir" && npm install)
  fi
done

if [[ ! -f "$BACKEND_DIR/.env" && -f "$BACKEND_DIR/.env.example" ]]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
  echo "已创建 backend/.env，请按需修改配置。"
fi

if [[ ! -f "$FRONTEND_DIR/.env" && -f "$FRONTEND_DIR/.env.example" ]]; then
  cp "$FRONTEND_DIR/.env.example" "$FRONTEND_DIR/.env"
  echo "已创建 frontend/.env，请按需修改配置。"
fi

echo "启动后端和前端，按 Ctrl+C 同时停止..."

(cd "$BACKEND_DIR" && DB_DRIVER=json npm run dev) &
BACKEND_PID=$!

(cd "$FRONTEND_DIR" && VITE_SOCKET_URL=http://localhost:5173 npm run dev) &
FRONTEND_PID=$!

wait "$BACKEND_PID" "$FRONTEND_PID"

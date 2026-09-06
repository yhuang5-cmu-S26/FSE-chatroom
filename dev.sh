#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
CERT_DIR="$ROOT_DIR/.cert"
TLS_KEY="$CERT_DIR/localhost-key.pem"
TLS_CERT="$CERT_DIR/localhost-cert.pem"

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

command -v openssl >/dev/null 2>&1 || {
  echo "错误：HTTPS 开发启动需要 openssl。" >&2
  exit 1
}

if [[ ! -f "$TLS_KEY" || ! -f "$TLS_CERT" ]]; then
  mkdir -p "$CERT_DIR"
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TLS_KEY" -out "$TLS_CERT" -days 30 -subj "/CN=localhost" >/dev/null 2>&1
  echo "已生成本地 HTTPS 开发证书（.cert/）。"
fi

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

(cd "$BACKEND_DIR" && DB_DRIVER=json TLS_KEY_PATH="$TLS_KEY" TLS_CERT_PATH="$TLS_CERT" CORS_ORIGIN=https://localhost:5173 npm run dev) &
BACKEND_PID=$!

(cd "$FRONTEND_DIR" && VITE_TLS_KEY_PATH="$TLS_KEY" VITE_TLS_CERT_PATH="$TLS_CERT" VITE_BACKEND_URL=https://localhost:3001 VITE_SOCKET_URL=https://localhost:5173 npm run dev) &
FRONTEND_PID=$!

wait "$BACKEND_PID" "$FRONTEND_PID"

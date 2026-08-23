import { io } from 'socket.io-client';
import { getAuthToken } from './api';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

export const socket = io(SOCKET_URL, {
  autoConnect: false,
});

export function setSocketIdentity({ sessionId }) {
  socket.auth = {
    ...(socket.auth || {}),
    token: getAuthToken(),
    sessionId,
  };

  if (socket.connected) {
    socket.disconnect();
    socket.connect();
  }
}

export function ensureSocketConnected() {
  if (!socket.connected) {
    socket.auth = {
      ...(socket.auth || {}),
      token: getAuthToken(),
    };
    socket.connect();
  }
}

export async function emitWithAck(event, payload, options = {}) {
  const retries = Math.max(0, options.retries ?? 2);
  const timeoutMs = Math.max(500, options.timeoutMs ?? 2500);

  let attempts = 0;
  let lastError = new Error('send failed');

  while (attempts <= retries) {
    attempts += 1;
    try {
      const response = await new Promise((resolve, reject) => {
        socket.timeout(timeoutMs).emit(event, payload, (err, data) => {
          if (err) return reject(new Error('ack timeout'));
          return resolve(data || {});
        });
      });

      if (response.ok) {
        return { ...response, attempts };
      }

      if (response.retryAfterMs) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(response.retryAfterMs, 2000)));
      }

      lastError = new Error(response.error || 'send rejected');
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

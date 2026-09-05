import { io } from "socket.io-client";
import { getToken } from "./api";
export const socket = io(
  import.meta.env.VITE_SOCKET_URL || window.location.origin,
  { autoConnect: false, transports: ["websocket"] },
);
export function connectSocket() {
  socket.auth = { token: getToken() };
  socket.connect();
}
export const emitAck = (event, payload) =>
  new Promise((resolve, reject) =>
    socket
      .timeout(5000)
      .emit(event, payload, (e, r) =>
        e
          ? reject(Error("connection timeout"))
          : r?.ok
            ? resolve(r)
            : reject(Error(r?.error || "rejected")),
      ),
  );

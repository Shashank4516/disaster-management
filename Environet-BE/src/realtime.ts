/**
 * Realtime layer: WebSocket events pushed to the frontend (ENDPOINTS.md §7).
 *
 * URL: ws://<host>:3000/ws
 * Server → client: { event: "reading" | "alert" | "node_status", payload }
 * Client → server: { type: "subscribe", node_ids: ["F01"] } to receive only
 * those nodes' events, or { type: "unsubscribe" } for everything.
 */
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

interface ClientMeta {
  alive: boolean;
  /** null = receive everything; Set = only these node ids */
  subscriptions: Set<string> | null;
}

let wss: WebSocketServer | null = null;
const meta = new Map<WebSocket, ClientMeta>();

export function attachRealtime(server: Server): void {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket) => {
    meta.set(socket, { alive: true, subscriptions: null });
    socket.on("pong", () => {
      const m = meta.get(socket);
      if (m) m.alive = true;
    });
    socket.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data));
        const m = meta.get(socket);
        if (!m) return;
        if (msg?.type === "subscribe" && Array.isArray(msg.node_ids)) {
          m.subscriptions = new Set(msg.node_ids.map(String));
        } else if (msg?.type === "unsubscribe") {
          m.subscriptions = null;
        }
      } catch {
        // malformed frames are ignored — this channel is fire-and-forget push
      }
    });
    socket.on("close", () => meta.delete(socket));
    socket.on("error", () => meta.delete(socket));
  });

  // Drop dead connections (mobile clients, network drops).
  const heartbeat = setInterval(() => {
    if (!wss) return;
    for (const socket of wss.clients) {
      const m = meta.get(socket);
      if (!m || !m.alive) {
        socket.terminate();
        continue;
      }
      m.alive = false;
      socket.ping();
    }
  }, 30_000);
  wss.on("close", () => clearInterval(heartbeat));
}

function broadcast(event: string, payload: unknown, nodeId?: string): void {
  if (!wss) return;
  const message = JSON.stringify({ event, payload });
  for (const socket of wss.clients) {
    if (socket.readyState !== WebSocket.OPEN) continue;
    const m = meta.get(socket);
    if (!m) continue;
    if (m.subscriptions) {
      if (!nodeId || !m.subscriptions.has(nodeId)) continue;
    }
    socket.send(message);
  }
}

export interface ReadingEvent {
  node_id: string;
  sensor: string;
  time: string;
  values: Record<string, unknown>;
  source?: string;
}

export function publishReading(reading: ReadingEvent): void {
  broadcast("reading", reading, reading.node_id);
}

export function publishAlert(alert: Record<string, unknown>): void {
  broadcast("alert", alert, String(alert.node_id ?? ""));
}

export function publishNodeStatus(status: {
  node_id: string;
  online: boolean;
  battery_pct?: number;
  signal_dbm?: number;
  time: string;
}): void {
  broadcast("node_status", status, status.node_id);
}

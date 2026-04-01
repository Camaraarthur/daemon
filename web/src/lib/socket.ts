"use client";

// ============================================================================
// WebSocket client — connects to backend on /ws
// Auto-reconnect with exponential backoff, message queueing.
// ============================================================================

type MessageHandler = (data: Record<string, unknown>) => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
const MAX_RECONNECT_DELAY = 10000;
const MAX_RECONNECT_ATTEMPTS = 50;
const handlers = new Map<string, Set<MessageHandler>>();
const sendQueue: Record<string, unknown>[] = [];

function getServerUrl(): string {
  if (typeof window === "undefined") return "";
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  // Connect to same host — Next.js rewrites /ws to the backend
  return `${protocol}//${window.location.host}/ws`;
}

export function connect(): void {
  if (typeof window === "undefined") return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const url = getServerUrl();
  if (!url) return;

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log("[WS] Connected");
    reconnectAttempt = 0;
    dispatch("ws:connected", { type: "ws:connected" });

    while (sendQueue.length > 0) {
      const msg = sendQueue.shift()!;
      ws!.send(JSON.stringify(msg));
    }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      dispatch(data.type as string, data);
    } catch { /* not JSON */ }
  };

  ws.onclose = () => {
    ws = null;
    dispatch("ws:disconnected", { type: "ws:disconnected" });
    scheduleReconnect();
  };

  ws.onerror = () => { /* onclose fires after */ };
}

function dispatch(type: string, data: Record<string, unknown>): void {
  handlers.get(type)?.forEach((h) => h(data));
  handlers.get("*")?.forEach((h) => h(data));
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    dispatch("ws:reconnect_failed", { type: "ws:reconnect_failed" });
    return;
  }
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
  reconnectAttempt++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

export function send(msg: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else if (msg.type === "chat:send") {
    sendQueue.push(msg);
  }
}

export function on(type: string, handler: MessageHandler): () => void {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type)!.add(handler);
  return () => { handlers.get(type)?.delete(handler); };
}

export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function disconnect(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { ws.close(); ws = null; }
}

import { ClientMessage, ServerMessage } from './protocol-types';

export type MessageHandler = (msg: ServerMessage) => void;
export type StatusHandler = (status: 'connecting' | 'connected' | 'disconnected') => void;

export class GameSocket {
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private reconnectTimer: number | null = null;
  private shouldReconnect = true;

  constructor(private url?: string) {}

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.notifyStatus('connecting');
    const wsUrl = this.url || this.getDefaultUrl();

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen = () => {
        this.notifyStatus('connected');
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        // Parse and dispatch are guarded separately. They used to share one try/catch,
        // which meant an exception thrown by a subscriber — GameStore's message handler,
        // most of the time — was reported as "Failed to parse message", sending you
        // looking at the wire format when the bug was in the code reacting to it.
        let parsed: ServerMessage;
        try {
          parsed = JSON.parse(event.data) as ServerMessage;
        } catch (e) {
          console.error('[ws] Failed to parse message:', event.data, e);
          return;
        }
        for (const h of this.messageHandlers) {
          try {
            h(parsed);
          } catch (e) {
            // One bad subscriber must not stop the others from seeing the message, and
            // it must be reported as a handler failure rather than a parse failure.
            console.error('[ws] Message handler threw:', e);
          }
        }
      };

      this.ws.onclose = () => {
        this.notifyStatus('disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn('[ws] Socket error:', err);
        this.ws?.close();
      };
    } catch (e) {
      console.error('[ws] Connection attempt failed:', e);
      this.scheduleReconnect();
    }
  }

  public send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('[ws] Attempted to send while not connected:', msg);
    }
  }

  public onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  public onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  private notifyStatus(status: 'connecting' | 'connected' | 'disconnected'): void {
    for (const h of this.statusHandlers) {
      try {
        h(status);
      } catch (e) {
        console.error('[ws] Status handler threw:', e);
      }
    }
  }

  private getDefaultUrl(): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }
}

// socket.test.ts — GameSocket, the client's only connection to the bridge.
//
// Reconnect is where this class earns its keep and where a mistake is expensive: a
// client that fails to reconnect silently stops receiving game state, and one that
// reconnects too eagerly can hammer the server or resurrect a session the player left.
// The bridge has no session resume (see KI-10), so status transitions here are what
// drive the store's "returned to the lobby" reset.
//
// WebSocket is stubbed rather than connected, so the reconnect timer can be driven
// deterministically instead of waiting two real seconds per case.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { GameSocket } from './socket';

// ------------------------------------------------------------ fake WebSocket

class FakeWebSocket {
  public static instances: FakeWebSocket[] = [];
  public static OPEN = 1;
  public static CONNECTING = 0;
  public static CLOSED = 3;

  public readyState = 0;
  public sent: string[] = [];
  public closed = false;
  public onopen: (() => void) | null = null;
  public onmessage: ((e: { data: any }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: ((e: any) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  public send(data: string) {
    this.sent.push(data);
  }
  // A real WebSocket fires onclose when closed, and GameSocket relies on that for its
  // reconnect path (both via serverClose and via the onerror -> close() route). The fake
  // has to do the same or the reconnect tests would pass for the wrong reason.
  public close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
  // Test drivers
  public open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  public emit(data: any) {
    this.onmessage?.({ data });
  }
  public serverClose() {
    this.close();
  }
}

const REAL_WS = globalThis.WebSocket;
const realSetTimeout = globalThis.setTimeout;

beforeEach(() => {
  FakeWebSocket.instances = [];
  (globalThis as any).WebSocket = FakeWebSocket;
  vi.useFakeTimers();
});

afterEach(() => {
  (globalThis as any).WebSocket = REAL_WS;
  vi.useRealTimers();
  globalThis.setTimeout = realSetTimeout;
});

const make = () => {
  const s = new GameSocket('ws://test/ws');
  const statuses: string[] = [];
  const messages: any[] = [];
  s.onStatus((st) => statuses.push(st));
  s.onMessage((m) => messages.push(m));
  return { s, statuses, messages };
};

// -------------------------------------------------------------- connecting

describe('GameSocket connect', () => {
  test('reports connecting then connected', () => {
    const { s, statuses } = make();
    s.connect();
    expect(statuses).toEqual(['connecting']);
    FakeWebSocket.instances[0].open();
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  test('uses the supplied url', () => {
    const { s } = make();
    s.connect();
    expect(FakeWebSocket.instances[0].url).toBe('ws://test/ws');
  });

  test('derives a ws url from the page by default', () => {
    const s = new GameSocket();
    s.connect();
    expect(FakeWebSocket.instances[0].url).toMatch(/^wss?:\/\/.*\/ws$/);
  });

  test('a second connect while open does not open another socket', () => {
    const { s } = make();
    s.connect();
    FakeWebSocket.instances[0].open();
    s.connect();
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  test('a second connect while still connecting is a no-op', () => {
    const { s } = make();
    s.connect();
    s.connect();
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  test('a malformed frame is reported as a parse failure and does not dispatch', () => {
    const { s, messages } = make();
    const errs: any[] = [];
    const realErr = console.error;
    console.error = (...a: any[]) => errs.push(a.join(' '));
    try {
      s.connect();
      FakeWebSocket.instances[0].open();
      FakeWebSocket.instances[0].emit('{not json');
    } finally {
      console.error = realErr;
    }
    expect(messages.length).toBe(0);
    expect(errs.join('\n')).toMatch(/Failed to parse/);
  });
});

// ---------------------------------------------------------------- dispatch

describe('GameSocket dispatch', () => {
  test('parses and delivers to every subscriber', () => {
    const s = new GameSocket('ws://test/ws');
    const a: any[] = [];
    const b: any[] = [];
    s.onMessage((m) => a.push(m));
    s.onMessage((m) => b.push(m));
    s.connect();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].emit(JSON.stringify({ Error: 'boom' }));
    expect(a).toEqual([{ Error: 'boom' }]);
    expect(b).toEqual([{ Error: 'boom' }]);
  });

  test('unsubscribing stops delivery', () => {
    const s = new GameSocket('ws://test/ws');
    const got: any[] = [];
    const off = s.onMessage((m) => got.push(m));
    s.connect();
    FakeWebSocket.instances[0].open();
    off();
    FakeWebSocket.instances[0].emit(JSON.stringify({ Error: 'x' }));
    expect(got.length).toBe(0);
  });

  test('unsubscribing status stops delivery', () => {
    const s = new GameSocket('ws://test/ws');
    const got: string[] = [];
    const off = s.onStatus((st) => got.push(st));
    off();
    s.connect();
    expect(got.length).toBe(0);
  });

  test('a throwing subscriber is reported as a handler failure, not a parse failure', () => {
    // These two used to share one try/catch, so a bug in GameStore's message handling
    // was logged as "Failed to parse message" — pointing at the wire format when the
    // fault was in the code reacting to it.
    const s = new GameSocket('ws://test/ws');
    const seen: any[] = [];
    s.onMessage(() => {
      throw new Error('store blew up');
    });
    s.onMessage((m) => seen.push(m));
    const errs: string[] = [];
    const realErr = console.error;
    console.error = (...a: any[]) => errs.push(a.join(' '));
    try {
      s.connect();
      FakeWebSocket.instances[0].open();
      FakeWebSocket.instances[0].emit(JSON.stringify({ Error: 'x' }));
    } finally {
      console.error = realErr;
    }
    expect(seen.length, 'a throwing subscriber must not starve the others').toBe(1);
    expect(errs.join('\n')).toMatch(/handler threw/i);
    expect(errs.join('\n')).not.toMatch(/Failed to parse/);
  });
});

// ------------------------------------------------------------------- send

describe('GameSocket send', () => {
  test('serialises and sends when open', () => {
    const { s } = make();
    s.connect();
    FakeWebSocket.instances[0].open();
    s.send({ Action: 'Ready' } as any);
    expect(FakeWebSocket.instances[0].sent).toEqual([JSON.stringify({ Action: 'Ready' })]);
  });

  test('drops and warns when not open, rather than throwing', () => {
    const { s } = make();
    const warns: string[] = [];
    const realWarn = console.warn;
    console.warn = (...a: any[]) => warns.push(a.join(' '));
    try {
      s.connect(); // still CONNECTING
      expect(() => s.send({ Action: 'Ready' } as any)).not.toThrow();
    } finally {
      console.warn = realWarn;
    }
    expect(warns.join('\n')).toMatch(/not connected/);
    expect(FakeWebSocket.instances[0].sent.length).toBe(0);
  });

  test('sending after the socket closed does not throw', () => {
    const { s } = make();
    s.connect();
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.serverClose();
    const realWarn = console.warn;
    console.warn = () => {};
    try {
      expect(() => s.send({ Action: 'Ready' } as any)).not.toThrow();
    } finally {
      console.warn = realWarn;
    }
  });
});

// --------------------------------------------------------------- reconnect

describe('GameSocket reconnect', () => {
  test('reports disconnected when the server closes', () => {
    const { s, statuses } = make();
    s.connect();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].serverClose();
    expect(statuses).toEqual(['connecting', 'connected', 'disconnected']);
  });

  test('reconnects after a delay', () => {
    const { s } = make();
    s.connect();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].serverClose();
    expect(FakeWebSocket.instances.length).toBe(1);
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances.length, 'must not reconnect early').toBe(1);
    vi.advanceTimersByTime(2);
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  test('schedules only one reconnect however many times close fires', () => {
    const { s } = make();
    s.connect();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].serverClose();
    FakeWebSocket.instances[0].serverClose();
    vi.advanceTimersByTime(3000);
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  test('a successful reconnect cancels any pending timer', () => {
    const { s } = make();
    s.connect();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].serverClose();
    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.instances.length).toBe(2);
    FakeWebSocket.instances[1].open();
    // If the timer were still armed this would open a third socket.
    vi.advanceTimersByTime(10000);
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  test('reconnects repeatedly across several drops', () => {
    const { s } = make();
    for (let i = 0; i < 3; i++) {
      s.connect();
      const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
      ws.open();
      ws.serverClose();
      vi.advanceTimersByTime(2000);
    }
    expect(FakeWebSocket.instances.length).toBe(4);
  });

  test('a socket error closes the socket, which triggers the reconnect', () => {
    const { s, statuses } = make();
    const warns: string[] = [];
    const realWarn = console.warn;
    console.warn = (...a: any[]) => warns.push(a.join(' '));
    try {
      s.connect();
      FakeWebSocket.instances[0].open();
      FakeWebSocket.instances[0].onerror?.(new Error('boom'));
      vi.advanceTimersByTime(2000);
      expect(FakeWebSocket.instances[0].closed).toBe(true);
      expect(FakeWebSocket.instances.length).toBe(2);
      expect(statuses).toContain('disconnected');
    } finally {
      console.warn = realWarn;
    }
  });

  test('a constructor that throws still schedules a reconnect', () => {
    const errs: string[] = [];
    const realErr = console.error;
    console.error = (...a: any[]) => errs.push(a.join(' '));
    (globalThis as any).WebSocket = function Boom() {
      throw new Error('refused');
    };
    try {
      const { s, statuses } = make();
      s.connect();
      expect(statuses).toEqual(['connecting']);
      vi.advanceTimersByTime(2000);
      expect(errs.join('\n')).toMatch(/Connection attempt failed/);
    } finally {
      console.error = realErr;
    }
  });

  test('disconnect stops the automatic reconnect', () => {
    const { s } = make();
    s.connect();
    FakeWebSocket.instances[0].open();
    s.disconnect();
    FakeWebSocket.instances[0].serverClose();
    vi.advanceTimersByTime(10000);
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  test('disconnect cancels an already-pending reconnect', () => {
    const { s } = make();
    s.connect();
    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].serverClose();
    s.disconnect();
    vi.advanceTimersByTime(10000);
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  // Documented rather than changed: `disconnect()` latches shouldReconnect off and
  // nothing ever turns it back on, so `disconnect()` followed by `connect()` gives a
  // socket that will never auto-reconnect. No caller does that today — main.ts only
  // calls connect() — so this is a trap for the next caller, not a live bug. Making
  // connect() reset the flag would break "stay disconnected after an explicit
  // disconnect", so the semantics are recorded as-is.
  test('KNOWN TRAP: connect() after disconnect() does not restore auto-reconnect', () => {
    const { s } = make();
    s.connect();
    FakeWebSocket.instances[0].open();
    s.disconnect();
    s.connect();
    expect(FakeWebSocket.instances.length).toBe(2);
    FakeWebSocket.instances[1].open();
    FakeWebSocket.instances[1].serverClose();
    vi.advanceTimersByTime(10000);
    expect(FakeWebSocket.instances.length, 'as implemented: no further reconnect').toBe(2);
  });
});

// test-harness.ts — shared fake socket for the client state tests.
//
// The socket is stubbed rather than mocked: GameStore only ever calls
// `onMessage` / `onStatus` and the outbound methods, so a fake that records the
// handlers is enough and keeps the tests about the store, not the transport.
import { GameStore } from './store';

type MessageHandler = (_msg: any) => void;
type StatusHandler = (_s: 'connecting' | 'connected' | 'disconnected') => void;

export class FakeSocket {
  public onMessageHandler: MessageHandler | null = null;
  public onStatusHandler: StatusHandler | null = null;
  public sent: any[] = [];
  public sentRaw: any[] = [];

  public onMessage(h: MessageHandler) {
    this.onMessageHandler = h;
    return () => {
      this.onMessageHandler = null;
    };
  }
  public onStatus(h: StatusHandler) {
    this.onStatusHandler = h;
    return () => {
      this.onStatusHandler = null;
    };
  }

  // Outbound calls the store makes; recorded, not asserted on here.
  public hello() {
    this.sent.push(['hello']);
  }
  public joinRoom() {
    this.sent.push(['joinRoom']);
  }
  public ready() {
    this.sent.push(['ready']);
  }
  public discard() {
    this.sent.push(['discard']);
  }
  public call() {
    this.sent.push(['call']);
  }
  public riichi() {
    this.sent.push(['riichi']);
  }
  public tsumo() {
    this.sent.push(['tsumo']);
  }
  public powerAction() {
    this.sent.push(['powerAction']);
  }
  public send(m: any) {
    this.sentRaw.push(m);
  }

  // Test drivers.
  public emit(msg: any) {
    this.onMessageHandler?.(msg);
  }
  public status(s: StatusHandler extends never ? never : any) {
    this.onStatusHandler?.(s);
  }
}

export function makeStore() {
  const socket = new FakeSocket();
  const store = new GameStore(socket as any);
  return { store, socket };
}

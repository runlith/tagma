import { outputFrame } from '@runlith/executions/protocol/lane';
import { LaneSockets } from '$lib/wire/LaneSockets.js';

export type LaneAct = {
  readonly binding: string;
  readonly sequence: number;
  readonly cause: string;
  readonly act: { readonly _tag: string; readonly bytes?: string };
};

export type Closing = { readonly close: number; readonly reason: string };

export const DROP: Closing = { close: 1006, reason: '' };

export const LANE_CLOSED: Closing = { close: 4410, reason: 'this lane was closed' };

export const admitted = (sequence: number) => ({
  _tag: 'InputAdmitted',
  receipt: {
    execution: { installation: 'test', execution: 'exec-1', incarnation: 0 },
    sequence,
    cause: 'typed',
    bytes: 1,
    acceptedThrough: '1',
  },
});

export const backpressure = (limit: number) => ({
  _tag: 'InputBackpressure',
  frontier: { acceptedThrough: '0', pendingBytes: 0 },
  pendingBytes: 0,
  limit,
});

export const conflict = (sequence: number) => ({ _tag: 'InputConflict', sequence });

export const expired = (sequence: number, retainedFrom: number) => ({ _tag: 'InputReceiptExpired', sequence, retainedFrom });

export const INPUT_ENDED = { _tag: 'InputEnded' };

export const unsupported = (detail: string) => ({ _tag: 'InputUnsupported', act: 'interrupt', reason: 'isig-disabled', detail });

const closing = (answer: unknown): answer is Closing => typeof answer === 'object' && answer !== null && 'close' in answer;

type Said = {
  readonly lane?: string;
  readonly t?: string;
  readonly sequence?: number;
  readonly cause?: string;
  readonly offset?: string;
  readonly act?: LaneAct['act'];
};

export class EndpointSocket {
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null = null;
  token: string | null = null;
  closed = false;
  readonly follows: string[] = [];

  constructor(
    readonly url: string,
    private readonly endpoint: LaneEndpoint,
  ) {}

  send(text: string): void {
    if (!this.closed) this.endpoint.heard(this, JSON.parse(text) as Said);
  }

  close(code = 1000): void {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => this.onclose?.({ code, reason: '' }));
  }

  say(said: object): void {
    if (!this.closed) this.onmessage?.({ data: JSON.stringify(said) });
  }

  write(offset: number, text: string): void {
    if (!this.closed) this.onmessage?.({ data: outputFrame(BigInt(offset), new TextEncoder().encode(text)).buffer });
  }

  drop(closing: Closing): void {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => this.onclose?.({ code: closing.close, reason: closing.reason }));
  }
}

export class LaneEndpoint {
  readonly sockets: EndpointSocket[] = [];
  readonly acts: LaneAct[] = [];
  readonly channel = new LaneSockets((url: string) => this.open(url) as unknown as WebSocket);
  serving = true;
  readonly unreached = new Set<string>();
  private readonly lanes = new Map<string, string>();

  constructor(private readonly answer: (act: LaneAct) => unknown = (act) => admitted(act.sequence)) {}

  stand(token: string, binding: string): void {
    this.lanes.set(token, binding);
  }

  shut(token: string, closing: Closing): void {
    this.lanes.delete(token);
    for (const socket of this.sockets) if (socket.token === token) socket.drop(closing);
  }

  following(): EndpointSocket | undefined {
    return this.sockets.findLast((socket) => !socket.closed && socket.follows.length > 0);
  }

  heard(socket: EndpointSocket, said: Said): void {
    if (socket.token === null) {
      socket.token = said.lane ?? '';
      if (!this.lanes.has(socket.token)) return socket.drop({ close: 4401, reason: 'no lane stands under this secret' });
      for (const other of this.sockets) {
        if (other !== socket && other.token === socket.token) other.drop({ close: 4409, reason: 'a newer connection took this lane' });
      }
      queueMicrotask(() => socket.say({ t: 'ready', execution: 'exec-1', head: '0' }));
      return;
    }
    if (said.t === 'follow') {
      socket.follows.push(said.offset ?? '');
      return;
    }
    const act: LaneAct = {
      binding: this.lanes.get(socket.token) ?? '',
      sequence: said.sequence ?? -1,
      cause: said.cause ?? '',
      act: said.act ?? { _tag: '' },
    };
    this.acts.push(act);
    void Promise.resolve(this.answer(act)).then((answer) => {
      if (closing(answer)) return socket.drop(answer);
      socket.say({ t: 'receipt', sequence: act.sequence, answer });
    });
  }

  private open(url: string): EndpointSocket {
    const socket = new EndpointSocket(url, this);
    this.sockets.push(socket);
    if (this.unreached.has(url)) socket.drop(DROP);
    else if (this.serving) {
      queueMicrotask(() => {
        if (!socket.closed) socket.onopen?.();
      });
    }
    return socket;
  }
}

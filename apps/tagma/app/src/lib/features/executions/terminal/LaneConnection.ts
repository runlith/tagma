import { Option, Schema } from 'effect';
import type { InputAnswer } from '@runlith/executions/protocol/input';
import {
  LaneClose,
  LaneReplyText,
  readOutputFrame,
  type LaneCause,
  type LaneHello,
  type LaneRequest,
} from '@runlith/executions/protocol/lane';
import type { ByteOffset } from '@runlith/executions/protocol/record';
import type { LaneSockets } from '$lib/wire/LaneSockets.js';
import type { InputAct } from '../Repo.js';

const RECONNECT_FIRST_MS = 100;
const RECONNECT_CEILING_MS = 5_000;
const CLOSED_WITHOUT_REASON = 'the terminal closed this lane';

export type LaneClosure = { readonly _tag: 'Reopen'; readonly reason: string } | { readonly _tag: 'Defect'; readonly problem: string };

export interface LaneInput {
  ready(): void;
  receipt(sequence: number, answer: InputAnswer): void;
  closed(closure: LaneClosure): void;
}

export interface LaneOutput {
  ready(): void;
  frame(offset: bigint, bytes: Uint8Array): void;
  behind(): void;
  ended(): void;
  lost(): void;
}

const decodeReply = Schema.decodeUnknownOption(LaneReplyText);

export class LaneConnection {
  private socket: WebSocket | null = null;
  private standing = false;
  private done = false;
  private attempts = 0;
  private output: LaneOutput | null = null;

  constructor(
    private readonly sockets: LaneSockets,
    private readonly url: string,
    private readonly token: string,
    private readonly input: LaneInput,
    private readonly wait: (ms: number) => Promise<void>,
  ) {
    this.connect();
  }

  get ready(): boolean {
    return this.standing;
  }

  watch(output: LaneOutput | null): void {
    this.output = output;
  }

  act(sequence: number, cause: LaneCause, act: InputAct): void {
    this.say({ t: 'act', sequence, cause, act });
  }

  follow(offset: ByteOffset): void {
    this.say({ t: 'follow', offset });
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    this.leave(this.socket);
  }

  private say(request: typeof LaneRequest.Encoded): void {
    if (this.standing) this.socket?.send(JSON.stringify(request));
  }

  private connect(): void {
    let socket: WebSocket;
    try {
      socket = this.sockets.open(this.url);
    } catch (error) {
      this.done = true;
      const problem = `this window cannot reach the terminal at ${this.url}: ${error instanceof Error ? error.message : String(error)}`;
      queueMicrotask(() => this.input.closed({ _tag: 'Defect', problem }));
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      const hello: typeof LaneHello.Encoded = { lane: this.token };
      socket.send(JSON.stringify(hello));
    };
    socket.onmessage = (event: MessageEvent) => {
      if (this.socket === socket) this.heard(event.data);
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.socket === socket) this.dropped(event.code, event.reason);
    };
  }

  private heard(data: unknown): void {
    if (data instanceof ArrayBuffer) {
      const frame = readOutputFrame(new Uint8Array(data));
      if (frame === undefined) return this.defect('the terminal sent an output frame shorter than its offset');
      this.attempts = 0;
      this.output?.frame(frame.offset, frame.bytes);
      return;
    }
    const reply = decodeReply(data);
    if (Option.isNone(reply)) return this.defect('the terminal sent a frame this window does not read');
    const said = reply.value;
    if (said.t === 'ready') {
      this.standing = true;
      this.input.ready();
      if (this.standing) this.output?.ready();
      return;
    }
    this.attempts = 0;
    switch (said.t) {
      case 'receipt':
        this.input.receipt(said.sequence, said.answer);
        return;
      case 'behind':
        this.output?.behind();
        return;
      case 'ended':
        this.output?.ended();
        return;
    }
  }

  private dropped(code: number, reason: string): void {
    const stood = this.standing;
    this.socket = null;
    this.standing = false;
    this.output?.lost();
    if (code === LaneClose.closed || code === LaneClose.unknown)
      return this.end({ _tag: 'Reopen', reason: reason || CLOSED_WITHOUT_REASON });
    if (code === LaneClose.malformed) return this.end({ _tag: 'Defect', problem: reason || CLOSED_WITHOUT_REASON });
    if (!stood) return this.end({ _tag: 'Reopen', reason: `the terminal at ${this.url} did not answer` });
    void this.again();
  }

  private defect(problem: string): void {
    this.leave(this.socket);
    this.end({ _tag: 'Defect', problem });
  }

  private leave(socket: WebSocket | null): void {
    this.socket = null;
    this.standing = false;
    socket?.close(1000);
    this.output?.lost();
  }

  private end(closure: LaneClosure): void {
    this.done = true;
    this.input.closed(closure);
  }

  private async again(): Promise<void> {
    const pause = this.attempts === 0 ? 0 : Math.min(RECONNECT_CEILING_MS, RECONNECT_FIRST_MS * 2 ** (this.attempts - 1));
    this.attempts += 1;
    if (pause > 0) await this.wait(pause);
    if (this.done || this.socket !== null) return;
    this.connect();
  }
}

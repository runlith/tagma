import type { Envelope } from '@runlith/ndjson-rpc/envelope';
import type { ContentBlock } from './content';
import type { ClientEvent, Outbound, Receipt, Step } from './events';
import type { AgentRequest, ClientRequest, ClientState, OpenMessage, Reply, Turn } from './state';
import type { ToolCall, ToolCallUpdate } from './toolCalls';

type PromptRequest = Extract<ClientRequest, { readonly meaning: 'prompt' }>;

const own = <A>(record: Readonly<Record<string, A>>, key: string): A | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);

const without = <A>(record: Readonly<Record<string, A>>, key: string): Record<string, A> => {
  const rest: Record<string, A> = {};
  for (const standing of Object.keys(record)) if (standing !== key) rest[standing] = record[standing]!;
  return rest;
};

const DURABLE: ReadonlySet<ClientEvent['_tag']> = new Set([
  'Initialized',
  'SessionReady',
  'ConfigChanged',
  'ModeChanged',
  'SessionClosed',
  'ExtensionAnswered',
  'Extended',
  'RequestFailed',
  'Message',
  'ToolCallStarted',
  'ToolCallEnded',
  'ToolCallAmended',
  'Asked',
  'Answered',
  'Withdrawn',
  'TurnEnded',
  'Uncertain',
  'Gapped',
]);

const ended = (call: ToolCall): boolean => call.status === 'completed' || call.status === 'failed';

const appended = (content: ReadonlyArray<ContentBlock>, block: ContentBlock): ReadonlyArray<ContentBlock> => {
  const last = content[content.length - 1];
  if (last?.type === 'text' && block.type === 'text') return [...content.slice(0, -1), { ...last, text: last.text + block.text }];
  return [...content, block];
};

const merged = (call: ToolCall, update: ToolCallUpdate): ToolCall => ({
  ...call,
  title: update.title ?? call.title,
  ...(update.name == null ? {} : { name: update.name }),
  kind: update.kind ?? call.kind,
  status: update.status ?? call.status,
  content: update.content ?? call.content,
  locations: update.locations ?? call.locations,
  ...('rawInput' in update ? { rawInput: update.rawInput } : {}),
  ...('rawOutput' in update ? { rawOutput: update.rawOutput } : {}),
  _meta: update._meta === undefined ? call._meta : update._meta,
});

export class Draft {
  readonly frames: Array<Outbound> = [];
  readonly events: Array<ClientEvent> = [];
  issued: string | null = null;

  constructor(public state: ClientState) {}

  emit(event: ClientEvent): void {
    this.events.push(event);
  }

  write(envelope: Envelope, receipt: Receipt | null): void {
    this.frames.push({ receipt, envelope });
  }

  done(durable: boolean): Step {
    return {
      state: this.state,
      frames: this.frames,
      events: this.events,
      durable: durable || this.frames.length > 0 || this.events.some((event) => DURABLE.has(event._tag)),
    };
  }

  request(method: string, params: unknown, meaning: (id: string) => ClientRequest): void {
    const counter = this.state.counter + 1;
    const id = `${this.state.incarnation}:${counter}`;
    this.issued = id;
    this.state = { ...this.state, counter, requests: [...this.state.requests, meaning(id)] };
    this.write({ _tag: 'Request', id, method, params }, { _tag: 'Request', id });
  }

  replaced(request: ClientRequest, next: ClientRequest | null): void {
    this.state = {
      ...this.state,
      requests:
        next === null
          ? this.state.requests.filter((standing) => standing !== request)
          : this.state.requests.map((standing) => (standing === request ? next : standing)),
    };
  }

  asked(ask: AgentRequest, next: AgentRequest | null): void {
    this.state = {
      ...this.state,
      asks:
        next === null
          ? this.state.asks.filter((standing) => standing !== ask)
          : this.state.asks.map((standing) => (standing === ask ? next : standing)),
    };
  }

  answer(ask: AgentRequest, reply: Reply): void {
    const answered: AgentRequest = { ...ask, answer: reply };
    this.asked(ask, answered);
    this.write(
      reply._tag === 'Result' ? { _tag: 'Result', id: ask.id, result: reply.result } : { _tag: 'Error', id: ask.id, error: reply.error },
      { _tag: 'Answer', id: ask.id },
    );
    this.emit({ _tag: 'Answered', ask: answered });
  }

  prompt(): PromptRequest | undefined {
    return this.state.requests.find((request): request is PromptRequest => request.meaning === 'prompt');
  }

  turn(): Turn | null {
    const prompt = this.prompt();
    if (prompt === undefined) return null;
    if (this.state.turn?.request === prompt.id) return this.state.turn;
    const turn: Turn = { id: prompt.turn, request: prompt.id, message: null, calls: {} };
    this.state = { ...this.state, turn };
    return turn;
  }

  held(ask: AgentRequest): void {
    this.state = { ...this.state, asks: [...this.state.asks, ask] };
  }

  private placed(turn: Turn): void {
    this.state = { ...this.state, turn };
  }

  flush(closing = false): void {
    const turn = this.state.turn;
    if (turn === null || turn.message === null) return;
    this.emit(
      closing
        ? { _tag: 'Message', turn: turn.id, message: turn.message, closing: true }
        : { _tag: 'Message', turn: turn.id, message: turn.message },
    );
    this.placed({ ...turn, message: null });
  }

  chunk(turn: Turn, stream: OpenMessage['stream'], messageId: string | null, content: ContentBlock): void {
    const open = turn.message;
    if (open !== null && (open.stream !== stream || open.messageId !== messageId)) this.flush();
    const current = this.state.turn ?? turn;
    const message: OpenMessage =
      current.message === null
        ? { stream, messageId, content: [content] }
        : { ...current.message, content: appended(current.message.content, content) };
    this.placed({ ...current, message });
    this.emit({ _tag: 'Delta', turn: turn.id, stream, messageId, content });
  }

  called(turn: Turn, update: ToolCallUpdate, opens: boolean): void {
    const id = update.toolCallId;
    const open = own(turn.calls, id);
    if (open === undefined && !opens) {
      this.flush();
      this.emit({ _tag: 'ToolCallAmended', turn: turn.id, update });
      return;
    }
    const call = merged(open ?? { toolCallId: id, title: '' }, update);
    if (open === undefined) {
      this.flush();
      this.emit({ _tag: 'ToolCallStarted', turn: turn.id, call });
    }
    const current = this.state.turn ?? turn;
    if (!ended(call)) {
      this.placed({ ...current, calls: { ...current.calls, [id]: call } });
      if (open !== undefined) this.emit({ _tag: 'ToolCallChanged', turn: turn.id, call, update });
      return;
    }
    this.flush();
    this.placed({ ...(this.state.turn ?? current), calls: without(current.calls, id) });
    this.emit({ _tag: 'ToolCallEnded', turn: turn.id, call, update });
  }

  closed(): Turn | null {
    const turn = this.state.turn;
    if (turn === null) return null;
    this.flush(true);
    for (const call of Object.values(turn.calls)) this.emit({ _tag: 'ToolCallEnded', turn: turn.id, call, update: null });
    this.state = { ...this.state, turn: null };
    return turn;
  }
}

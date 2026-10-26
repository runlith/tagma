import { appendFileSync, existsSync, readFileSync, rmSync, watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import type { HookCallbackMatcher, HookInput, Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentFault, FAULT } from '@runlith/acp/agent';
import type { Channel, ClaudeSdk, Entry, Interrupted, Said } from '../runner/claude-code/channel.js';
import { ZERO } from '../runner/claude-code/translate.js';

const MODEL = 'claude-fixture';
const REQUEST_AFTER_START_MS = 50;
const READ_AFTER_MS = 150;

type Command = {
  readonly uuid: string;
  readonly text: string;
  readonly empty: boolean;
  readonly compacts: boolean;
  modelStarted: boolean;
  stepping: boolean;
  tool: string | null;
  asking: AbortController | null;
  calling: (() => void) | null;
  ended: boolean;
};

type Wire = {
  onmessage?: (message: unknown) => void;
  onclose?: () => void;
  start(): Promise<void>;
  send(message: unknown): Promise<void>;
  close(): Promise<void>;
};

type Reply = { readonly accept: (value: unknown) => void; readonly decline: (cause: unknown) => void };

class Pipe {
  private readonly items: Said[] = [];
  private waiting: ((read: IteratorResult<Said, void>) => void) | null = null;
  private ended = false;

  push(item: Said): void {
    const waiting = this.waiting;
    if (waiting === null) this.items.push(item);
    else {
      this.waiting = null;
      waiting({ value: item, done: false });
    }
  }

  end(): void {
    this.ended = true;
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.({ value: undefined, done: true });
  }

  next(): Promise<IteratorResult<Said, void>> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve({ value: item, done: false });
    if (this.ended) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }
}

const said = (body: Record<string, unknown>): Said => ({ session_id: 'fixture', ...body }) as unknown as SDKMessage;

const textOf = (message: SDKUserMessage): string => JSON.stringify(message.message.content);

const resultOf = (subtype: string, terminal: string, isError: boolean): Said =>
  said({
    type: 'result',
    subtype,
    is_error: isError,
    stop_reason: isError ? null : 'end_turn',
    terminal_reason: terminal,
    result: '',
    uuid: crypto.randomUUID(),
    usage: { input_tokens: 0, output_tokens: 0 },
    total_cost_usd: 0,
    modelUsage: {},
  });

class FixtureClaude implements Channel {
  private readonly out = new Pipe();
  private readonly queue: SDKUserMessage[] = [];
  private readonly unread: SDKUserMessage[] = [];
  private readonly words = new Map<string, SDKUserMessage>();
  private running: Command | null = null;
  private lingering: (() => void) | null = null;
  private closed = false;
  private wire: Promise<Wire> | null = null;
  private calls = 0;

  constructor(
    private readonly report: string,
    private readonly hooks: Options['hooks'],
    private readonly servers: Options['mcpServers'],
    private readonly sessionId: string,
  ) {
    this.log({ event: 'open' });
    this.idle();
  }

  readonly messages: AsyncIterable<Said> = {
    [Symbol.asyncIterator]: () => ({ next: () => this.out.next(), return: async () => (this.out.end(), { value: undefined, done: true }) }),
  };

  control(): void {
    if (this.taken('step')) this.stepped();
    if (this.taken('call')) this.called('hosted-call', 'mcp__tagma__read');
    if (this.taken('vendor')) this.called('vendor-call', 'WebSearch');
    if (this.taken('result') && this.running?.tool != null)
      this.emit(
        said({
          type: 'user',
          uuid: crypto.randomUUID(),
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: this.running.tool, content: 'fixture result' }],
          },
        }),
      );
    if (existsSync(`${this.report}.release`)) this.released();
  }

  models: Channel['models'] = () => Effect.succeed([{ value: MODEL, displayName: 'Fixture', description: 'the scripted Claude Code' }]);
  window: Channel['window'] = () => Effect.succeed(200_000);
  setModel: Channel['setModel'] = () => Effect.void;
  setEffort: Channel['setEffort'] = () => Effect.void;
  setThinking: Channel['setThinking'] = () => Effect.void;
  autoCompact: Channel['autoCompact'] = (enabled) =>
    Effect.sync(() => {
      this.log({ event: 'autoCompact', enabled });
      const running = this.running;
      if (enabled && running !== null && running.modelStarted && !running.compacts && !running.stepping) this.compacting(running);
    });
  sideQuestions: Channel['sideQuestions'] = () =>
    Effect.fail(new AgentFault({ code: FAULT.methodNotFound, message: 'the fixture answers no side question' }));
  reading: Channel['reading'] = () => Effect.succeed(ZERO);
  quota: Channel['quota'] = () => Effect.succeed(null);
  rejectedUntil: Channel['rejectedUntil'] = () => null;

  send: Channel['send'] = (message) =>
    Effect.sync(() => {
      const uuid = message.uuid ?? crypto.randomUUID();
      this.log({ event: 'transcript', sessionId: this.sessionId, message: { ...message, uuid } });
      this.log({ event: 'sent', uuid, priority: message.priority ?? null, compact: textOf(message).includes('/compact') });
      this.emit(said({ type: 'command_lifecycle', uuid, state: 'queued' }));
      if (message.priority !== 'next') this.queue.push(message);
      else {
        this.unread.push(message);
        setTimeout(() => this.read(), READ_AFTER_MS);
      }
      this.next();
    });

  interrupt: Channel['interrupt'] = () =>
    Effect.sync((): Interrupted => {
      this.log({ event: 'interrupt' });
      const dropped = [...this.words.keys(), ...this.queue.flatMap((message) => (message.uuid === undefined ? [] : [message.uuid]))];
      this.words.clear();
      this.queue.length = 0;
      for (const uuid of dropped) this.emit(said({ type: 'command_lifecycle', uuid, state: 'cancelled' }));
      const running = this.running;
      if (running !== null && !running.ended) {
        if (running.text.includes('LINGER') && !existsSync(`${this.report}.release`)) this.lingering = () => this.aborted(running);
        else this.aborted(running);
      }
      return { queued: [], dropped };
    });

  withdraw: Channel['withdraw'] = (uuid) =>
    Effect.sync(() => {
      if (!this.words.delete(uuid)) return false;
      this.emit(said({ type: 'command_lifecycle', uuid, state: 'cancelled' }));
      return true;
    });

  close: Channel['close'] = () =>
    Effect.andThen(
      Effect.sync(() => {
        this.closed = true;
        this.out.end();
      }),
      Effect.promise(async () => {
        await (await this.wire)?.close();
      }),
    );

  private log(entry: Record<string, unknown>): void {
    appendFileSync(this.report, `${JSON.stringify(entry)}\n`);
  }

  private emit(message: Said): void {
    if (this.closed) return;
    if ((message.type === 'user' && !('isReplay' in message && message.isReplay)) || message.type === 'assistant')
      this.log({ event: 'transcript', sessionId: this.sessionId, message });
    this.out.push(message);
  }

  private taken(name: string): boolean {
    if (!existsSync(`${this.report}.${name}`)) return false;
    rmSync(`${this.report}.${name}`, { force: true });
    return true;
  }

  private idle(): void {
    this.log({ event: 'idle' });
  }

  private read(): void {
    for (const message of this.unread.splice(0)) {
      if (this.running !== null) this.words.set(message.uuid ?? crypto.randomUUID(), message);
      else this.queue.push(message);
    }
    this.next();
  }

  private compacting(command: Command): void {
    command.stepping = true;
    const hook = this.hooks?.PreCompact?.[0]?.hooks[0];
    const input = { hook_event_name: 'PreCompact', trigger: 'auto', custom_instructions: null } as unknown as HookInput;
    void hook?.(input, undefined, { signal: new AbortController().signal });
    this.emit(said({ type: 'system', subtype: 'status', status: 'compacting' }));
  }

  connect(): Effect.Effect<void, AgentFault> {
    const server = this.servers?.tagma;
    if (server?.type !== 'sdk') return Effect.void;
    const instance = server.instance;
    this.wire ??= (async () => {
      const waiting = new Map<unknown, Reply>();
      const request = (method: string, params?: unknown) =>
        new Promise<unknown>((accept, decline) => {
          const id = (this.calls += 1);
          waiting.set(id, { accept, decline });
          wire.onmessage?.({ jsonrpc: '2.0', id, method, params });
        });
      const wire: Wire = {
        start: async () => {},
        close: async () => {
          wire.onclose?.();
          wire.onclose = undefined;
          for (const reply of waiting.values()) reply.decline(new Error('the fixture MCP client closed'));
          waiting.clear();
        },
        send: async (message) => {
          if (typeof message !== 'object' || message === null) return;
          if ('method' in message && message.method === 'notifications/tools/list_changed') {
            await request('tools/list');
            return;
          }
          if (!('id' in message)) return;
          const reply = waiting.get(message.id);
          if (reply === undefined) return;
          waiting.delete(message.id);
          if ('error' in message) reply.decline(message.error);
          else reply.accept('result' in message ? message.result : undefined);
        },
      };
      await instance.connect(wire);
      await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } });
      wire.onmessage?.({ jsonrpc: '2.0', method: 'notifications/initialized' });
      await request('tools/list');
      return wire;
    })();
    return Effect.tryPromise({
      try: async () => {
        await this.wire;
      },
      catch: (cause) => new AgentFault({ code: FAULT.internal, message: `the fixture MCP client could not connect: ${String(cause)}` }),
    });
  }

  private hosted(command: Command, id: string): void {
    if (this.wire === null) return;
    const call = (this.calls += 1);
    void this.wire.then((wire) => {
      wire.onmessage?.({
        jsonrpc: '2.0',
        id: call,
        method: 'tools/call',
        params: { name: 'read', arguments: {}, _meta: { 'claudecode/toolUseId': id } },
      });
      command.calling = () =>
        wire.onmessage?.({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: call, reason: 'interrupted' } });
    });
  }

  private next(): void {
    if (this.running !== null) return;
    const message = this.queue.shift();
    if (message === undefined) return;
    const text = textOf(message);
    const content = message.message.content;
    const command: Command = {
      uuid: message.uuid ?? crypto.randomUUID(),
      text,
      empty:
        typeof content === 'string' ? content.trim() === '' : content.every((block) => block.type === 'text' && block.text.trim() === ''),
      compacts: text.includes('/compact'),
      modelStarted: false,
      stepping: false,
      tool: null,
      asking: null,
      calling: null,
      ended: false,
    };
    this.running = command;
    this.log({ event: 'busy', uuid: command.uuid });
    this.log({ event: 'heard', text });
    this.emit(said({ type: 'command_lifecycle', uuid: command.uuid, state: 'started' }));
    setTimeout(() => this.request(command), REQUEST_AFTER_START_MS);
  }

  private request(command: Command): void {
    if (command.ended) return;
    this.emit(said({ type: 'system', subtype: 'init', model: MODEL }));
    this.emit(
      said({
        type: 'user',
        isReplay: true,
        uuid: command.uuid,
        parent_tool_use_id: null,
        message: { role: 'user', content: command.text },
      }),
    );
    this.log({ event: 'model', uuid: command.uuid });
    command.modelStarted = true;
    if (command.empty) {
      this.finished(
        command,
        said({
          ...resultOf('error_during_execution', 'api_error', true),
          api_error_status: 400,
          errors: ['This model does not support assistant message prefill. The conversation must end with a user message.'],
        }),
        'failed',
      );
      return;
    }
    if (command.compacts) {
      this.emit(said({ type: 'system', subtype: 'status', status: 'compacting' }));
      if (existsSync(`${this.report}.release`)) this.released();
      return;
    }
    this.stream({ type: 'message_start', message: { id: `m-${command.uuid}`, usage: { input_tokens: 10, output_tokens: 0 } } });
    if (command.text.includes('PONDER')) {
      this.stream({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
      this.stream({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Weighing it.' } });
    } else if (command.text.includes('STREAM')) {
      this.stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      this.stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partial' } });
    } else if (command.text.includes('ASK')) this.asked(command);
    else if (!command.text.includes('HOLD')) this.answered(command);
    if (!command.ended && existsSync(`${this.report}.release`)) this.released();
  }

  private stream(event: Record<string, unknown>): void {
    this.emit(said({ type: 'stream_event', parent_tool_use_id: null, uuid: crypto.randomUUID(), event }));
  }

  private assistant(command: Command, content: readonly Record<string, unknown>[]): void {
    this.emit(
      said({
        type: 'assistant',
        uuid: crypto.randomUUID(),
        parent_tool_use_id: null,
        message: { id: `m-${command.uuid}`, model: MODEL, content, usage: { input_tokens: 10, output_tokens: 1 } },
      }),
    );
  }

  private called(id: string, name: string): void {
    const running = this.running;
    if (running === null || running.ended) return;
    running.tool = id;
    this.stream({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id, name, input: {} } });
    this.assistant(running, [{ type: 'tool_use', id, name, input: {} }]);
    this.stream({ type: 'message_stop' });
    if (name.startsWith('mcp__tagma__')) this.hosted(running, id);
  }

  private asked(command: Command): void {
    const id = 'fetch-call';
    command.tool = id;
    this.assistant(command, [{ type: 'tool_use', id, name: 'WebFetch', input: { url: 'https://example.com', prompt: 'title' } }]);
    this.stream({ type: 'message_stop' });
    const matcher = (this.hooks?.PreToolUse ?? []).find((hook: HookCallbackMatcher) => hook.matcher === 'WebFetch');
    const hook = matcher?.hooks[0];
    if (hook === undefined) return;
    const asking = new AbortController();
    command.asking = asking;
    const input = {
      hook_event_name: 'PreToolUse',
      session_id: 'fixture',
      transcript_path: '',
      cwd: '',
      tool_name: 'WebFetch',
      tool_input: { url: 'https://example.com', prompt: 'title' },
      tool_use_id: id,
    } as unknown as HookInput;
    void hook(input, id, { signal: asking.signal }).then(
      (answer) => this.log({ event: 'hooked', answer }),
      () => this.log({ event: 'hook-abandoned' }),
    );
  }

  private stepped(): void {
    this.read();
    const running = this.running;
    if (running === null) return;
    for (const [uuid, message] of this.words) {
      this.log({ event: 'heard', text: textOf(message) });
      this.emit(
        said({ type: 'user', isReplay: true, uuid, parent_tool_use_id: null, message: { role: 'user', content: message.message.content } }),
      );
    }
    this.words.clear();
  }

  private released(): void {
    const lingering = this.lingering;
    this.lingering = null;
    if (lingering !== null) return lingering();
    const running = this.running;
    if (running === null || running.ended || !running.modelStarted) return;
    if (running.compacts) {
      this.emit(
        said({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'manual', pre_tokens: 900, post_tokens: 90 } }),
      );
      this.emit(
        said({
          type: 'user',
          isSynthetic: true,
          uuid: crypto.randomUUID(),
          parent_tool_use_id: null,
          message: { role: 'user', content: 'summary' },
        }),
      );
      return this.finished(running, resultOf('success', '', false), 'completed');
    }
    if (running.stepping) {
      running.stepping = false;
      this.emit(
        said({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 900, post_tokens: 90 } }),
      );
      this.emit(
        said({
          type: 'user',
          isSynthetic: true,
          uuid: crypto.randomUUID(),
          parent_tool_use_id: null,
          message: { role: 'user', content: 'summary' },
        }),
      );
    }
    this.answered(running);
  }

  private answered(command: Command): void {
    this.assistant(command, [{ type: 'text', text: 'done' }]);
    this.stream({ type: 'message_stop' });
    this.finished(command, resultOf('success', 'completed', false), 'completed');
  }

  private aborted(command: Command): void {
    if (command.ended) return;
    command.asking?.abort();
    command.calling?.();
    if (command.stepping)
      this.emit(
        said({
          type: 'system',
          subtype: 'status',
          status: null,
          compact_result: 'failed',
          compact_error: 'API Error: Request was aborted.',
        }),
      );
    if (!command.modelStarted) {
      this.emit(said({ type: 'system', subtype: 'init', model: MODEL }));
      this.emit(
        said({
          type: 'user',
          isReplay: true,
          uuid: command.uuid,
          parent_tool_use_id: null,
          message: { role: 'user', content: command.text },
        }),
      );
    }
    if (command.compacts) {
      this.emit(
        said({
          type: 'system',
          subtype: 'status',
          status: null,
          compact_result: 'failed',
          compact_error: 'API Error: Request was aborted.',
        }),
      );
      this.assistant(command, [{ type: 'text', text: 'Compaction canceled.' }]);
      return this.finished(command, resultOf('success', '', false), 'cancelled');
    }
    if (command.tool !== null)
      this.emit(
        said({
          type: 'user',
          uuid: crypto.randomUUID(),
          parent_tool_use_id: null,
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: command.tool, content: 'interrupted', is_error: true }] },
        }),
      );
    this.emit(
      said({
        type: 'user',
        uuid: crypto.randomUUID(),
        parent_tool_use_id: null,
        message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] },
      }),
    );
    if (command.modelStarted) this.stream({ type: 'message_stop' });
    this.finished(
      command,
      resultOf('error_during_execution', command.tool === null ? 'aborted_streaming' : 'aborted_tools', true),
      'cancelled',
    );
  }

  private finished(command: Command, result: Said, state: string): void {
    command.ended = true;
    this.emit(result);
    this.emit(said({ type: 'command_lifecycle', uuid: command.uuid, state }));
    this.running = null;
    this.queue.unshift(...this.words.values());
    this.words.clear();
    this.log({ event: 'ended', uuid: command.uuid, state });
    if (this.queue.length === 0) this.idle();
    this.next();
  }
}

export const fixtureClaude = (report: string): ClaudeSdk => {
  const transcript: ClaudeSdk['transcript'] = async (sessionId, dir) => {
    const messages = existsSync(report)
      ? readFileSync(report, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { event: string; sessionId?: string; message?: Entry; messages?: readonly Entry[] })
          .flatMap((line) =>
            line.sessionId !== sessionId
              ? []
              : line.event === 'transcript' && line.message !== undefined
                ? [line.message]
                : line.event === 'history'
                  ? (line.messages ?? [])
                  : [],
          )
      : [];
    return messages.length > 0
      ? [...new Map(messages.map((message) => [message.uuid, message])).values()]
      : (await import('@anthropic-ai/claude-agent-sdk')).getSessionMessages(sessionId, { dir });
  };
  const opened: FixtureClaude[] = [];
  appendFileSync(report, `${JSON.stringify({ event: 'process' })}\n`);
  watch(dirname(report), () => {
    for (const channel of opened) channel.control();
  });
  return {
    open: (options) =>
      Effect.callback<Channel, AgentFault>((resume) => {
        const ready = () => {
          const sessionId = options.resume;
          const cwd = options.cwd;
          const history =
            sessionId === undefined || cwd === undefined ? Effect.succeed([]) : Effect.promise(() => transcript(sessionId, cwd));
          resume(
            Effect.flatMap(history, (messages) => {
              appendFileSync(report, `${JSON.stringify({ event: 'history', sessionId, messages })}\n`);
              const channel = new FixtureClaude(
                report,
                options.hooks,
                options.mcpServers,
                options.resume ?? options.sessionId ?? 'fixture',
              );
              opened.push(channel);
              return Effect.as(channel.connect(), channel);
            }),
          );
        };
        const hold = join(dirname(report), 'opening.hold');
        if (!existsSync(hold)) return ready();
        const watcher = watch(dirname(report), () => {
          if (existsSync(hold)) return;
          watcher.close();
          ready();
        });
      }),
    transcript,
  };
};

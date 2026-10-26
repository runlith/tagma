import { Effect, Exit, Schema, Semaphore } from 'effect';
import { QuotaObservation, QuotaFailure, QuotaInvalidResponse } from '@runlith/llm/schema/quota';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentFault, FAULT, type Outlet } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import type { SessionConfigOption } from '@runlith/acp/updates';
import { BACKGROUND, QUOTA, UNSTEPPED } from '../../contract/wire/extensions.js';
import { aside, type AsideAnswered } from './aside.js';
import { failed, type Ended } from './calls.js';
import { Compaction } from './compaction.js';
import type { HostedAgent, HostedDoor } from '../hosted/door.js';
import { Feed } from './feed.js';
import { Fetching } from './fetching.js';
import { Handed } from '../hosted/handed.js';
import { Lifecycle, type Listener } from './lifecycle.js';
import { Names } from './names.js';
import type { Channel, ClaudeSdk, Said } from './channel.js';
import type { Opening } from './opening.js';
import type { Runner } from './runner.js';
import type { Settings } from './settings.js';
import { Spend } from './spend.js';
import { Turn } from './turn.js';
import type { Input, Prepared, Steered, Withdrawn } from '../hosted/cycle.js';

export class ClaudeSession implements Listener {
  private readonly lifecycle: Lifecycle;
  private readonly feed: Feed;
  private readonly spend: Spend;
  private readonly turn: Turn;
  private readonly compaction: Compaction;
  private readonly names: Names;
  private openingTurn = false;

  private constructor(
    readonly id: string,
    readonly cwd: string,
    sdk: ClaudeSdk,
    door: HostedDoor,
    private readonly runner: Runner,
    private readonly settings: Settings,
    opening: Opening,
    outlet: Outlet,
    hosted: HostedAgent,
    controls: Semaphore.Semaphore,
  ) {
    const handed = new Handed();
    const names = new Names(Object.keys(opening.servers));
    this.names = names;
    this.spend = new Spend(opening.origin._tag === 'New', runner.stderr);
    this.feed = new Feed(id, cwd, outlet, settings, runner, handed, names, this.spend);
    this.lifecycle = new Lifecycle(
      sdk,
      door,
      runner,
      opening,
      settings,
      this.spend,
      new Fetching(id, outlet, this.feed),
      handed,
      names,
      this,
      hosted,
      controls,
    );
    this.turn = new Turn(this.lifecycle, this.feed, this.spend, opening.recap);
    this.compaction = new Compaction(this.lifecycle, this.feed, this.spend);
  }

  static readonly open = Effect.fnUntraced(function* (
    sdk: ClaudeSdk,
    door: HostedDoor,
    runner: Runner,
    settings: Settings,
    outlet: Outlet,
    opening: Opening,
  ) {
    const hosted = yield* door.agent();
    const controls = yield* Semaphore.make(1);
    const session = new ClaudeSession(opening.id, opening.cwd, sdk, door, runner, settings, opening, outlet, hosted, controls);
    yield* session.lifecycle.start(opening.origin);
    return session;
  });

  configOptions(): readonly SessionConfigOption[] {
    return this.settings.configOptions();
  }

  busy(): boolean {
    return this.openingTurn || this.turn.busy() || this.compaction.busy();
  }

  turning(active: boolean): void {
    this.openingTurn = active;
  }

  readonly prepare = Effect.fnUntraced(function* (this: ClaudeSession, input: Prepared) {
    const { lifecycle } = this;
    yield* lifecycle.alive();
    const { opened, listed } = input;
    const prompt = opened.prompt ?? lifecycle.prompt;
    const names = opened.prompt === null || this.names.holds(listed.names) ? null : listed.names;
    if (prompt !== lifecycle.prompt || opened.web !== lifecycle.web || names !== null) yield* lifecycle.reopen(prompt, opened.web, names);
    yield* lifecycle.listed(listed.tools);
  });

  start(input: Input) {
    return this.turn.start(input);
  }

  steer(prompt: ReadonlyArray<ContentBlock>, input: string | undefined): Effect.Effect<Steered, AgentFault> {
    return this.turn.steer(prompt, input);
  }

  withdraw(input: string): Effect.Effect<Withdrawn, AgentFault> {
    return this.turn.withdraw(input);
  }

  queued(words: readonly string[]): Effect.Effect<void> {
    return this.turn.queued(words);
  }

  readonly cancel = Effect.fnUntraced(function* (this: ClaudeSession) {
    if (yield* this.compaction.cancel()) return;
    yield* this.turn.cancel();
  });

  readonly compact = Effect.fnUntraced(function* (this: ClaudeSession, instructions: string, at: 'step' | 'end') {
    yield* this.lifecycle.alive();
    if (at === 'step' && !this.openingTurn && !this.turn.busy())
      return yield* new AgentFault({ code: UNSTEPPED, message: 'no turn is running, so no step will come; compact after the turn' });
    if (at === 'step' && !this.compaction.busy()) return yield* this.compaction.step(instructions);
    if (this.busy())
      return yield* new AgentFault({
        code: FAULT.invalidRequest,
        message: 'a turn is running in this session; compact it at its next step or once the turn ends',
      });
    return yield* this.compaction.compact(instructions);
  });

  compacting(): Effect.Effect<string | null> {
    return this.compaction.compacting();
  }

  compacted(): Effect.Effect<void> {
    return this.compaction.compacted();
  }

  reopened(): Effect.Effect<void> {
    return this.feed.notify(BACKGROUND, { running: 0 });
  }

  aside(question: string): Effect.Effect<AsideAnswered, AgentFault> {
    return Effect.flatMap(this.lifecycle.channel(), (channel) => aside(channel, question));
  }

  configure(configId: string, value: string): Effect.Effect<readonly SessionConfigOption[], AgentFault> {
    return Effect.flatMap(this.lifecycle.channel(), (channel) => this.settings.configure(channel, configId, value));
  }

  close(): Effect.Effect<void> {
    return Effect.flatMap(this.lifecycle.close(), (reason) => this.settle(reason));
  }

  ended(reason: string): Effect.Effect<void> {
    return Effect.andThen(this.settle(reason), this.runner.died(reason));
  }

  heard(message: Said, source: Channel): Effect.Effect<void, AgentFault> {
    switch (message.type) {
      case 'command_lifecycle':
        return Effect.andThen(this.compaction.commanded(message), this.turn.commanded(message));
      case 'stream_event':
        if (message.parent_tool_use_id !== null) return Effect.void;
        return message.event.type === 'message_start'
          ? Effect.andThen(
              Effect.sync(() => this.turn.answering()),
              this.feed.streamed(message.event),
            )
          : this.feed.streamed(message.event);
      case 'assistant':
        return message.parent_tool_use_id === null ? Effect.andThen(this.turn.assistant(message), this.feed.titled()) : Effect.void;
      case 'user':
        return Effect.andThen(this.spoken(message), this.feed.titled());
      case 'system':
        return this.noted(message);
      case 'result':
        return this.finished(message);
      case 'rate_limit_event':
        return Effect.andThen(
          Effect.sync(() => this.turn.limited(source.rejectedUntil())),
          this.reportQuota(source),
        );
      default:
        return Effect.void;
    }
  }

  private readonly reportQuota = Effect.fnUntraced(function* (this: ClaudeSession, source: Channel) {
    const { runner, feed } = this;
    const read = yield* Effect.result(source.quota());
    if (read._tag === 'Failure') {
      runner.stderr(`Claude Code quota unavailable: ${read.failure.message}\n`);
      const failure = Schema.encodeSync(Schema.toCodecJson(QuotaFailure))(new QuotaInvalidResponse({ message: read.failure.message }));
      yield* feed.notify(QUOTA, { failure });
      return;
    }
    if (read.success === null) {
      runner.stderr('Claude Code reported no numeric quota measurement.\n');
      return;
    }
    const observation = Schema.encodeSync(Schema.toCodecJson(QuotaObservation))(read.success);
    yield* feed.notify(QUOTA, { observation });
  });

  private readonly spoken = Effect.fnUntraced(function* (this: ClaudeSession, message: Extract<SDKMessage, { readonly type: 'user' }>) {
    if (message.parent_tool_use_id !== null) return;
    yield* this.feed.heard();
    if ('isReplay' in message && message.isReplay === true) return yield* this.turn.echoed(message);
    if (yield* this.compaction.summarized(message)) return;
    yield* this.turn.heard(message);
  });

  private noted(message: Extract<SDKMessage, { readonly type: 'system' }>): Effect.Effect<void> {
    return Effect.andThen(this.feed.noted(message), this.subtyped(message));
  }

  private subtyped(message: Extract<SDKMessage, { readonly type: 'system' }>): Effect.Effect<void> {
    if (message.subtype === 'background_tasks_changed')
      return this.feed.notify(BACKGROUND, { running: message.tasks.filter((task) => task.ambient !== true).length });
    if (message.subtype !== 'init') return this.compaction.noted(message);
    this.settings.serving(message.model);
    return Effect.void;
  }

  private readonly finished = Effect.fnUntraced(function* (this: ClaudeSession, result: Ended) {
    const { feed, spend, compaction, turn } = this;
    yield* feed.titled();
    spend.record(result);
    if (yield* compaction.finished(result)) return;
    if (turn.overflowed(result) && (yield* compaction.overflowed())) {
      const continued = yield* Effect.exit(turn.continued());
      if (Exit.isSuccess(continued)) return;
    }
    yield* turn.finished(result);
  });

  private readonly settle = Effect.fnUntraced(function* (this: ClaudeSession, reason: string) {
    const fault = failed(`this Claude Code session ended: ${reason}`);
    yield* this.turn.fail(fault);
    yield* this.compaction.fail(fault);
  });
}

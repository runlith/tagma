import { Cause, Deferred, Effect, Exit, Fiber, Scope, Stream, type Semaphore } from 'effect';
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentFault } from '@runlith/acp/agent';
import { Bridge, servedPrompt } from './bridge.js';
import { failed, said } from './calls.js';
import type { Channel, ClaudeSdk, Said } from './channel.js';
import type { HostedToolWire } from '../../contract/wire/hosted.js';
import type { HostedAgent, HostedDoor, HostedOpened } from '../hosted/door.js';
import type { Fetching } from './fetching.js';
import type { Handed } from '../hosted/handed.js';
import { TAGMA_SERVER, type Names } from './names.js';
import type { Opening, Origin } from './opening.js';
import type { Runner } from './runner.js';
import { MODE, type Settings } from './settings.js';
import type { Spend } from './spend.js';
import { VENDOR_TOOLS } from './vendor.js';

type Web = HostedOpened['web'];

type Driving = {
  readonly channel: Channel;
  readonly scope: Scope.Closeable;
  readonly bridge: Bridge;
  readonly generation: number;
};

export type Listener = {
  readonly heard: (message: Said, source: Channel) => Effect.Effect<void, AgentFault>;
  readonly queued: (words: readonly string[]) => Effect.Effect<void>;
  readonly ended: (reason: string) => Effect.Effect<void>;
  readonly compacting: () => Effect.Effect<string | null>;
  readonly compacted: () => Effect.Effect<void>;
  readonly reopened: () => Effect.Effect<void>;
};

const STEPPED = { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000', CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '1' };

export class Lifecycle {
  private driving: Driving | null = null;
  private reopening: Deferred.Deferred<void> | null = null;
  private readonly replacing = new Set<Fiber.Fiber<void>>();
  private generations = 0;
  private materialized: boolean;
  private over: string | null = null;
  private prompted: string;
  private webbed: Web;
  private compacting = false;

  constructor(
    private readonly sdk: ClaudeSdk,
    private readonly door: HostedDoor,
    private readonly runner: Runner,
    private readonly opening: Opening,
    private readonly settings: Settings,
    private readonly spend: Spend,
    private readonly fetching: Fetching,
    private readonly handed: Handed,
    private readonly names: Names,
    private readonly listener: Listener,
    hosted: HostedAgent,
    private readonly controls: Semaphore.Semaphore,
  ) {
    this.materialized = opening.origin._tag === 'Resume';
    this.prompted = hosted.prompt;
    this.webbed = hosted.web;
  }

  get prompt(): string {
    return this.prompted;
  }

  get web(): Web {
    return this.webbed;
  }

  ready(): Effect.Effect<void, AgentFault> {
    return Effect.asVoid(this.driven());
  }

  alive(): Effect.Effect<void, AgentFault> {
    return Effect.suspend(() =>
      this.over === null ? Effect.void : Effect.fail(failed(`this Claude Code session ended: ${this.over}; load it again`)),
    );
  }

  channel(): Effect.Effect<Channel, AgentFault> {
    return Effect.map(this.driven(), (driving) => driving.channel);
  }

  readonly autoCompact = Effect.fn('Lifecycle.autoCompact')(
    function* (this: Lifecycle, enabled: boolean) {
      if (this.over !== null) return yield* failed(`this Claude Code session ended: ${this.over}; load it again`);
      const driving = this.driving;
      if (driving !== null) yield* driving.channel.autoCompact(enabled);
      this.compacting = enabled;
    },
    (work) => this.controls.withPermit(work),
  );

  readonly send = Effect.fnUntraced(function* (this: Lifecycle, message: SDKUserMessage) {
    const driving = yield* this.driven();
    this.materialized = true;
    yield* driving.channel.send(message);
  });

  listed(tools: readonly HostedToolWire[]): Effect.Effect<void, AgentFault> {
    return Effect.flatMap(this.driven(), (driving) => driving.bridge.serve(tools));
  }

  readonly interrupt = Effect.fnUntraced(function* (this: Lifecycle) {
    const driving = yield* this.driven();
    return yield* driving.channel
      .interrupt()
      .pipe(Effect.tapError((fault) => this.broke(driving, `Claude Code could not be interrupted: ${fault.message}`)));
  });

  readonly start = Effect.fnUntraced(function* (this: Lifecycle, origin: Origin) {
    const { sdk, door, handed, runner, opening, settings } = this;
    const scope = yield* Scope.make();
    const bridge = new Bridge(
      door,
      handed,
      runner.stderr,
      (reason) => this.fall(reason),
      (words) => this.listener.queued(words),
    );
    const compacting = this.compacting;
    const options: Options = { ...this.options(origin), mcpServers: { ...opening.servers, [TAGMA_SERVER]: bridge.config } };
    const driving = yield* Effect.acquireRelease(sdk.open(options), (channel) => channel.close()).pipe(
      Scope.provide(scope),
      Effect.flatMap((channel) =>
        Effect.flatMap(Effect.zip(channel.models(), channel.window()), ([models, window]) =>
          this.controls.withPermit(
            Effect.suspend(() =>
              Effect.andThen(
                compacting === this.compacting ? Effect.void : channel.autoCompact(this.compacting),
                Effect.suspend(() => {
                  if (this.over !== null) return Effect.fail(failed(`this Claude Code session ended: ${this.over}`));
                  this.generations += 1;
                  settings.offered(models, window);
                  const driving: Driving = { channel, scope, bridge, generation: this.generations };
                  this.driving = driving;
                  return Effect.succeed(driving);
                }),
              ),
            ),
          ),
        ),
      ),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );
    yield* Effect.forkIn(this.read(driving), scope);
  });

  readonly reopen = Effect.fnUntraced(
    function* (this: Lifecycle, prompt: string, web: Web, names: readonly string[] | null) {
      const before = this.reopening;
      const latch = yield* Deferred.make<void>();
      this.reopening = latch;
      this.prompted = prompt;
      this.webbed = web;
      if (names !== null) this.names.hold(names);
      const replacing = yield* Effect.forkDetach(
        this.replace(before).pipe(
          Effect.ensuring(
            Effect.suspend(() => {
              this.replacing.delete(replacing);
              if (this.reopening === latch) this.reopening = null;
              return Deferred.succeed(latch, undefined);
            }),
          ),
        ),
        { startImmediately: false },
      );
      this.replacing.add(replacing);
    },
    (work) => Effect.uninterruptible(work),
  );

  private readonly replace = Effect.fnUntraced(function* (this: Lifecycle, before: Deferred.Deferred<void> | null) {
    if (before !== null) yield* Deferred.await(before);
    const standing = yield* this.controls.withPermit(
      Effect.sync(() => {
        const standing = this.driving;
        this.driving = null;
        return standing;
      }),
    );
    if (standing !== null) yield* this.shut(standing);
    if (this.over === null) {
      const origin: Origin = this.materialized ? { _tag: 'Resume', sessionId: this.opening.id } : this.opening.origin;
      this.spend.restart(origin._tag === 'New');
      const started = yield* Effect.exit(this.start(origin));
      if (Exit.isSuccess(started)) yield* this.listener.reopened();
      else if (this.over === null) yield* this.fall(`Claude Code could not be reopened for the new turn: ${Cause.pretty(started.cause)}`);
    }
  });

  fall(reason: string): Effect.Effect<void> {
    this.over ??= reason;
    return this.listener.ended(this.over);
  }

  private readonly broke = Effect.fnUntraced(function* (this: Lifecycle, driving: Driving, reason: string) {
    if (this.driving === driving) this.driving = null;
    yield* this.shut(driving);
    yield* this.fall(reason);
  });

  readonly close = Effect.fnUntraced(function* (this: Lifecycle) {
    this.over ??= 'the session was closed';
    for (const replacing of [...this.replacing]) yield* Fiber.interrupt(replacing);
    const driving = this.driving;
    this.driving = null;
    if (driving !== null) yield* this.shut(driving);
    return this.over;
  });

  private shut(driving: Driving): Effect.Effect<void> {
    return Effect.andThen(driving.channel.close(), Scope.close(driving.scope, Exit.void));
  }

  private driven(): Effect.Effect<Driving, AgentFault> {
    return Effect.suspend(() => {
      if (this.over !== null) return Effect.fail(failed(`this Claude Code session ended: ${this.over}; load it again`));
      const reopening = this.reopening;
      if (reopening !== null) return Effect.andThen(Deferred.await(reopening), this.driven());
      return this.driving === null ? Effect.fail(failed('this Claude Code session holds no query')) : Effect.succeed(this.driving);
    });
  }

  private options(origin: Origin): Options {
    const { id, cwd, directories } = this.opening;
    const { model, effort, titled } = this.settings;
    const thinking = this.settings.opening();
    return {
      cwd,
      additionalDirectories: [...directories],
      pathToClaudeCodeExecutable: this.runner.claude,
      systemPrompt: { type: 'custom', prompt: servedPrompt(this.prompted), snapshot: false },
      tools: this.webbed === 'vendor' ? VENDOR_TOOLS.map((tool) => tool.wire) : [],
      toolAliases: this.names.aliases,
      strictMcpConfig: true,
      settingSources: [],
      settings: {
        autoMemoryEnabled: false,
        autoCompactEnabled: this.compacting,
        idleCompaction: false,
        precomputeCompactionEnabled: false,
      },
      env: { ...process.env, ...STEPPED },
      hooks: {
        PreToolUse: this.webbed === 'vendor' ? [this.fetching.hook()] : [],
        PreCompact: [
          {
            hooks: [
              () =>
                Effect.runPromise(
                  Effect.map(this.listener.compacting(), (instructions) => (instructions === null ? {} : { systemMessage: instructions })),
                ),
            ],
          },
        ],
        PostCompact: [{ hooks: [() => Effect.runPromise(Effect.as(this.listener.compacted(), {}))] }],
      },
      permissionMode: MODE,
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      title: titled ? undefined : 'Tagma',
      stderr: this.runner.stderr,
      extraArgs: { 'replay-user-messages': null },
      model: model ?? undefined,
      effort: effort ?? undefined,
      thinking,
      sessionId: origin._tag === 'Resume' ? undefined : id,
      resume: origin._tag === 'New' ? undefined : origin.sessionId,
      forkSession: origin._tag === 'Fork' ? true : undefined,
      resumeSessionAt: origin._tag === 'Fork' ? (origin.at ?? undefined) : undefined,
    };
  }

  private read(driving: Driving): Effect.Effect<void> {
    return Stream.runForEach(Stream.fromAsyncIterable(driving.channel.messages, said), (message) =>
      this.listener.heard(message, driving.channel),
    ).pipe(
      Effect.exit,
      Effect.flatMap((exit) => {
        if (this.driving?.generation !== driving.generation) return Effect.void;
        const reason = Exit.isSuccess(exit) ? 'Claude Code stopped answering' : `Claude Code failed: ${Cause.pretty(exit.cause)}`;
        return this.fall(reason);
      }),
    );
  }
}

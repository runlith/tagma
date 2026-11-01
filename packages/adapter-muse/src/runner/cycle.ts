import { Clock, Deferred, Effect, Exit, FileSystem, Predicate, Result, Schema, Scope } from 'effect';
import { AgentFault, FAULT, type Outlet } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { Bridge, servedPrompt, type BridgeVendor } from '@runlith/hosted-runner/bridge';
import { clientSession, type ClientCompaction, type ClientOutcome, type ClientRun } from '@runlith/hosted-runner/client';
import type { Cycle, Process, Steered, Withdrawn } from '@runlith/hosted-runner/cycle';
import type { HostedDoor } from '@runlith/hosted-runner/door';
import { Handed } from '@runlith/hosted-runner/handed';
import { historyBlocks } from '@runlith/hosted-runner/history';
import { Options, type ClientLaunch } from '@runlith/hosted-runner/options';
import type { Output } from '@runlith/hosted-runner/output';
import { QUOTA } from '@runlith/hosted-runner/wire/extensions';
import type { HostedToolWire } from '@runlith/hosted-runner/wire/messages';
import { MUSE_CODE_EXTENSIONS } from '../harness/acp.js';
import type { McpServerInput } from '@runlith/mcp/server';
import { MuseSdk, type Frame, type Host, type MuseRefused } from './channel.js';
import { Feed } from './feed.js';
import { Compact, ItemEvent, Models, Opened, Quota, Started, TurnStarted, type Item } from './frames.js';
import { writeSettings, type MusePlace } from './home.js';

const PROVIDER_ID = 'meta';
const PROFILE = ':ask-me';
const APPROVALS = 'promptUnmatched';
const CONTINUE = 'Continue the work.';
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const museVendor: BridgeVendor = {
  name: 'Muse Code',
  callIdOf: (meta) => (typeof meta.callId === 'string' && meta.callId !== '' ? meta.callId : null),
  relists: false,
};

export type MuseRunner = {
  readonly place: MusePlace;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly program: string;
  readonly mint: () => string;
  readonly serve: (input: McpServerInput & { readonly bearer: string }) => Effect.Effect<{ readonly url: string }, AgentFault, Scope.Scope>;
};

type Want = { readonly prompt: string; readonly web: 'vendor' | 'none'; readonly tools: readonly HostedToolWire[] };
type Seat = { readonly id: string; readonly cwd: string; fresh: boolean };
type Live = {
  readonly host: Host;
  readonly key: string;
  readonly scope: Scope.Closeable;
  readonly loaded: Set<string>;
  readonly windows: ReadonlyMap<string, number>;
};
type Compacting = { readonly session: string; readonly output: Output; readonly done: Deferred.Deferred<Item, AgentFault> };

const faultOf = (refused: MuseRefused): AgentFault =>
  new AgentFault({
    code: refused.kind === 'sessionNotFound' ? FAULT.notFound : FAULT.internal,
    message: `Muse Code refused ${refused.method}: ${refused.message}`,
  });

const decoded =
  <A>(schema: Schema.Codec<A, unknown>, method: string) =>
  (value: unknown) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(
        (cause) =>
          new AgentFault({ code: FAULT.internal, message: `Muse Code answered ${method} in an unreadable shape: ${cause.message}` }),
      ),
    );

type Part = Readonly<Record<string, string>>;

const partsOf = (blocks: readonly ContentBlock[]): Effect.Effect<readonly Part[], AgentFault> =>
  Effect.forEach(blocks, (block): Effect.Effect<Part, AgentFault> =>
    block.type === 'text'
      ? Effect.succeed({ type: 'text', text: block.text })
      : block.type === 'image'
        ? Effect.succeed({ type: 'image', base64Data: block.data, mediaType: block.mimeType })
        : Effect.fail(new AgentFault({ code: FAULT.invalidParams, message: `Muse Code cannot receive ${block.type} content` })),
  );

const keyOf = (want: Want): string => JSON.stringify([want.web, want.tools.map((tool) => tool.name), want.prompt]);

const toolsetOf = (web: Want['web']): readonly string[] => ['mcp__tagma__*', ...(web === 'vendor' ? ['web_search', 'web_fetch'] : [])];

export const makeMuseCycle = Effect.fnUntraced(function* (door: HostedDoor, process: Process, runner: MuseRunner, launch: ClientLaunch) {
  const sdk = yield* MuseSdk;
  const files = yield* FileSystem.FileSystem;
  const scope = yield* Effect.scope;
  const options = new Options(launch, true);
  const handed = new Handed();
  let live: Live | null = null;
  let feed: Feed | null = null;
  let compacting: Compacting | null = null;
  let output: Output | null = null;
  let observed: unknown = null;
  let window: number | null = null;
  let applied: { readonly session: string; readonly model: string } | null = null;
  const words = new Map<string, Deferred.Deferred<void>>();
  const refused = new Set<string>();
  const steers = new Map<string, { readonly command: string; readonly feed: Feed }>();

  const slot = (input: string) => {
    const standing = words.get(input);
    if (standing !== undefined) return Effect.succeed(standing);
    return Effect.tap(Deferred.make<void>(), (made) => Effect.sync(() => words.set(input, made)));
  };
  const settleWords = Effect.fnUntraced(function* () {
    for (const done of words.values()) yield* Deferred.succeed(done, undefined);
    words.clear();
  });

  const bridge = new Bridge(
    door,
    handed,
    process.stderr,
    process.died,
    (named) => Effect.forEach(named, (input) => Effect.flatMap(slot(input), Deferred.await), { discard: true }),
    museVendor,
  );
  const bearer = crypto.randomUUID();
  const served = yield* runner.serve({ ...bridge.input, bearer });
  const config = {
    mcpServers: {
      tagma: { transport: 'streamableHttp', mode: 'required', url: served.url, headers: { Authorization: `Bearer ${bearer}` } },
    },
  };

  const report = Effect.fnUntraced(function* () {
    const observation = observed;
    if (observation === null || output === null) return;
    observed = null;
    yield* output.event({ type: 'notification', method: QUOTA, fields: { observation } });
  });

  const quota = Effect.fnUntraced(function* (frame: Frame) {
    const read = Schema.decodeUnknownResult(Quota)(frame.params);
    if (Result.isFailure(read)) return process.stderr(`Muse Code reported its quota in an unreadable shape: ${read.failure.message}\n`);
    const { window: session, weekly, observedAtMs } = read.success;
    const windows = [
      ...(session === undefined
        ? []
        : [
            new QuotaWindow({
              kind: 'session',
              usedPercent: session.usedPercent,
              windowMinutes: session.windowDurationMins,
              resetsAt: session.resetsAtMs === undefined ? undefined : session.resetsAtMs / 1000,
            }),
          ]),
      ...(weekly === undefined
        ? []
        : [
            new QuotaWindow({
              kind: 'weekly',
              usedPercent: weekly.usedPercent,
              windowMinutes: 10_080,
              resetsAt: weekly.resetsAtMs === undefined ? undefined : weekly.resetsAtMs / 1000,
            }),
          ]),
    ];
    if (windows.length === 0) return;
    const observedAt = observedAtMs ?? (yield* Clock.currentTimeMillis);
    observed = yield* Schema.encodeEffect(Schema.toCodecJson(QuotaObservation))(
      new QuotaObservation({ observedAt: new Date(observedAt), source: 'usage', windows }),
    ).pipe(Effect.orDie);
    yield* report();
  });

  const compacted = Effect.fnUntraced(function* (frame: Frame, standing: Compacting) {
    const read = Schema.decodeUnknownResult(ItemEvent)(frame.params);
    if (Result.isFailure(read) || read.success.sessionId !== standing.session || read.success.item.kind !== 'compaction') return false;
    const item = read.success.item;
    if (frame.method === 'item/started') yield* standing.output.event({ type: 'phase', phase: 'compacting' });
    if (frame.method === 'item/completed') yield* Deferred.succeed(standing.done, item);
    return true;
  });

  const orphan = Effect.fnUntraced(function* (frame: Frame) {
    const read = Schema.decodeUnknownResult(TurnStarted)(frame.params);
    const host = live?.host;
    if (Result.isFailure(read) || host === undefined) return;
    const { sessionId, turnId } = read.success;
    process.stderr(`Muse Code started turn ${turnId}, which no Tagma turn holds; it is interrupted\n`);
    yield* Effect.forkIn(
      host.command('turn/interrupt', { sessionId, turnId }).pipe(
        Effect.asVoid,
        Effect.catchTag('MuseRefused', () => Effect.void),
      ),
      scope,
    );
  });

  const route = Effect.fnUntraced(function* (frame: Frame) {
    if (frame.method === 'usage/changed') return yield* quota(frame);
    const standing = compacting;
    if (standing !== null && frame.method.startsWith('item/') && (yield* compacted(frame, standing))) return;
    const turn = feed;
    if (frame.method === 'turn/started' && standing === null) {
      const id = frame.params.turnId;
      if (typeof id === 'string' && (turn === null || !turn.owns(id))) return yield* orphan(frame);
    }
    if (turn !== null && frame.params.sessionId === turn.session) return yield* turn.frame(frame);
    if (frame.request) process.stderr(`Muse Code asked ${frame.method} with no turn running; it stays unanswered\n`);
  });

  const died = Effect.fnUntraced(function* (reason: string) {
    const turn = feed;
    if (turn !== null) yield* Deferred.succeed(turn.done, { status: 'error', detail: reason });
    const standing = compacting;
    if (standing !== null) yield* Deferred.fail(standing.done, new AgentFault({ code: FAULT.internal, message: reason }));
    yield* settleWords();
    yield* process.died(reason);
  });

  const drop = Effect.fnUntraced(function* () {
    const standing = live;
    if (standing === null) return;
    live = null;
    applied = null;
    yield* Scope.close(standing.scope, Exit.void);
  });

  const ensureHost = Effect.fnUntraced(function* (want: Want, cwd: string) {
    const key = keyOf(want);
    yield* bridge.serve(want.tools);
    const standing = live;
    if (standing !== null && standing.key === key) return standing;
    yield* drop();
    yield* writeSettings(runner.place, { system: want.prompt, toolset: toolsetOf(want.web) }).pipe(
      Effect.provideService(FileSystem.FileSystem, files),
    );
    const owned = yield* Scope.fork(scope);
    const host = yield* sdk
      .open({ program: runner.program, args: ['serve'], cwd, env: runner.env, sessionMcp: true, frame: route, stderr: process.stderr })
      .pipe(
        Scope.provide(owned),
        Effect.onError(() => Scope.close(owned, Exit.void)),
      );
    const listed = yield* host.request('model/list', {}).pipe(Effect.mapError(faultOf), Effect.flatMap(decoded(Models, 'model/list')));
    const windows = new Map(listed.models.flatMap((row) => (row.contextLimit === null ? [] : [[row.modelId, row.contextLimit] as const])));
    const made: Live = { host, key, scope: owned, loaded: new Set(), windows };
    live = made;
    yield* Effect.forkIn(
      Effect.flatMap(host.ended, (reason) => (live === made ? died(`Muse Code ended under a live session: ${reason}`) : Effect.void)),
      owned,
    );
    return made;
  });

  const load = Effect.fnUntraced(function* (standing: Live, seat: Seat) {
    if (standing.loaded.has(seat.id)) return;
    const { model } = options.read();
    if (seat.fresh) {
      yield* standing.host
        .command('session/start', {
          sessionId: seat.id,
          workspaceRoot: seat.cwd,
          ...(model === null ? {} : { modelId: model }),
          providerId: PROVIDER_ID,
          approvalMode: APPROVALS,
          permissionProfile: PROFILE,
          config,
        })
        .pipe(Effect.mapError(faultOf));
      seat.fresh = false;
      applied = model === null ? null : { session: seat.id, model };
    } else {
      const resumed = yield* standing.host
        .command('session/resume', { sessionId: seat.id, excludeItems: true, config, permissionProfile: PROFILE })
        .pipe(Effect.mapError(faultOf), Effect.flatMap(decoded(Opened, 'session/resume')));
      if (resumed.session.approvalMode?.mode !== APPROVALS)
        yield* standing.host.command('session/setApprovalMode', { sessionId: seat.id, mode: APPROVALS }).pipe(Effect.mapError(faultOf));
      applied = null;
    }
    standing.loaded.add(seat.id);
  });

  const attach = Effect.fnUntraced(function* (seat: Seat, want: Want) {
    const standing = yield* ensureHost(want, seat.cwd);
    yield* load(standing, seat);
    const { model } = options.read();
    if (model !== null && (applied?.session !== seat.id || applied.model !== model)) {
      yield* standing.host
        .command('session/setModel', { sessionId: seat.id, model: { modelId: model, providerId: PROVIDER_ID } })
        .pipe(Effect.mapError(faultOf));
      applied = { session: seat.id, model };
    }
    return standing;
  });

  const wanted = Effect.fnUntraced(function* () {
    const [agent, listed] = yield* Effect.zip(door.agent(), door.tools());
    return { prompt: servedPrompt(agent.prompt), web: agent.web, tools: listed.tools } satisfies Want;
  });

  const windowOf = () => window ?? (applied === null ? null : (live?.windows.get(applied.model) ?? null));

  const sessionOf = (seat: Seat, seed: readonly ContentBlock[], outlet: Outlet) => {
    let history = seed;
    return clientSession(
      {
        id: seat.id,
        cwd: seat.cwd,
        configOptions: options.options,
        configure: options.configure.bind(options),
        handed,
        queued: (named) => Effect.forEach(named, (input) => Effect.flatMap(slot(input), Deferred.await), { discard: true }),
        send: Effect.fnUntraced(function* ({ input, prepared, output: out, permitted }) {
          output = out;
          yield* report();
          const prompt = prepared.opened.prompt ?? (yield* door.agent()).prompt;
          const standing = yield* attach(seat, { prompt: servedPrompt(prompt), web: prepared.opened.web, tools: prepared.listed.tools });
          const blocks: ContentBlock[] = [...history];
          if (input.context !== null) blocks.push({ type: 'text', text: input.context });
          blocks.push(...input.prompt);
          const parts = yield* partsOf(blocks);
          const turn = UUID_V7.test(input.id) ? input.id : runner.mint();
          const done = yield* Deferred.make<ClientOutcome>();
          const { effort, parameters } = options.read();
          const running = new Feed(
            {
              session: seat.id,
              turn,
              output: out,
              host: standing.host,
              scope,
              thoughts: parameters.reasoningDisplay !== 'omitted',
              window: windowOf,
              measured: (size) => {
                window = size;
              },
              permitted,
              stderr: process.stderr,
            },
            done,
          );
          feed = running;
          const admitted = yield* standing.host
            .command(
              'turn/start',
              {
                sessionId: seat.id,
                input: parts.length === 0 ? [{ type: 'text', text: CONTINUE }] : parts,
                ...(effort === null ? {} : { reasoningEffort: effort }),
              },
              turn,
            )
            .pipe(
              Effect.mapError(faultOf),
              Effect.flatMap(decoded(Started, 'turn/start')),
              Effect.onError(() =>
                Effect.sync(() => {
                  if (feed === running) feed = null;
                }),
              ),
            );
          if (admitted.turnId !== turn)
            return yield* new AgentFault({ code: FAULT.internal, message: `Muse Code admitted turn ${admitted.turnId} for ${turn}` });
          if (admitted.disposition === 'started') running.started = true;
          yield* input.taken;
          history = [];
          const finish = Effect.andThen(
            Effect.sync(() => {
              if (feed === running) feed = null;
              if (!running.cancelled) for (const [word, sent] of steers) if (sent.feed === running) steers.delete(word);
            }),
            settleWords(),
          );
          return {
            wait: Deferred.await(done).pipe(
              Effect.tap((outcome) => (outcome.failure?.type === 'configError' && live === standing ? drop() : Effect.void)),
              Effect.ensuring(finish),
            ),
            cancel: Effect.gen(function* () {
              const open = running.stop();
              if (!running.started) {
                const reclaimed = yield* standing.host.command('turn/unqueue', { sessionId: seat.id, turnId: turn }).pipe(
                  Effect.as(true),
                  Effect.catchTag('MuseRefused', (refusal) =>
                    refusal.kind === 'commandRejected' ? Effect.succeed(false) : Effect.fail(faultOf(refusal)),
                  ),
                );
                if (reclaimed) return;
              }
              yield* Effect.forEach(
                open,
                (id) =>
                  standing.host.command('turn/interrupt', { sessionId: seat.id, turnId: id }).pipe(
                    Effect.asVoid,
                    Effect.catchTag('MuseRefused', (refusal) =>
                      refusal.kind === 'commandRejected' ? Effect.void : Effect.fail(faultOf(refusal)),
                    ),
                  ),
                { discard: true },
              );
            }),
            steer: Effect.fnUntraced(function* (prompt: readonly ContentBlock[], word: string | undefined) {
              const steering = yield* partsOf(prompt);
              const command = word !== undefined && UUID_V7.test(word) ? word : runner.mint();
              const settled = word === undefined ? null : yield* slot(word);
              running.steering(command);
              if (word !== undefined) steers.set(word, { command, feed: running });
              const answer = yield* standing.host
                .command('turn/steer', { sessionId: seat.id, expectedTurnId: turn, input: steering }, command)
                .pipe(
                  Effect.as<Steered>({ outcome: 'injected' }),
                  Effect.catchTag('MuseRefused', (refusal) =>
                    refusal.kind === 'commandRejected'
                      ? Effect.sync((): Steered => {
                          running.unsteered(command);
                          if (word !== undefined) {
                            steers.delete(word);
                            refused.add(word);
                          }
                          return { outcome: 'promptRequired' };
                        })
                      : Effect.fail(faultOf(refusal)),
                  ),
                  Effect.ensuring(settled === null ? Effect.void : Deferred.succeed(settled, undefined)),
                );
              return answer;
            }),
            withdraw: Effect.fnUntraced(function* (word: string) {
              const pending = words.get(word);
              if (pending !== undefined) yield* Deferred.await(pending);
              if (refused.delete(word)) return { withdrawn: true } satisfies Withdrawn;
              const sent = steers.get(word);
              if (sent === undefined || !sent.feed.cancelled) return { withdrawn: false } satisfies Withdrawn;
              steers.delete(word);
              yield* Deferred.await(sent.feed.done);
              return { withdrawn: sent.feed.unread.has(sent.command) } satisfies Withdrawn;
            }),
          } satisfies ClientRun;
        }),
        compact: Effect.fnUntraced(function* (_instructions, out) {
          output = out;
          const standing = live ?? (yield* attach(seat, yield* wanted()));
          yield* load(standing, seat);
          const done = yield* Deferred.make<Item, AgentFault>();
          compacting = { session: seat.id, output: out, done };
          const asked = yield* standing.host.command('session/compact', { sessionId: seat.id }).pipe(
            Effect.mapError(faultOf),
            Effect.flatMap(decoded(Compact, 'session/compact')),
            Effect.onError(() =>
              Effect.sync(() => {
                compacting = null;
              }),
            ),
          );
          if (asked.status !== 'accepted') {
            compacting = null;
            return yield* new AgentFault({
              code: FAULT.invalidRequest,
              message: `Muse Code had nothing to compact${asked.reason === undefined ? '' : ` (${asked.reason})`}`,
            });
          }
          return {
            wait: Deferred.await(done).pipe(
              Effect.flatMap((item) =>
                item.outcome === 'compacted'
                  ? Effect.as(
                      out.event({
                        type: 'compacted',
                        summary: '',
                        trigger: 'manual',
                        preTokens: item.tokensBefore,
                        postTokens: item.tokensAfter,
                      }),
                      { summary: '', preTokens: item.tokensBefore, postTokens: item.tokensAfter ?? null },
                    )
                  : Effect.fail(
                      new AgentFault({
                        code: item.outcome === 'cancelled' ? -32800 : FAULT.internal,
                        message: `Muse Code ended the compaction ${item.outcome ?? item.status}${item.reason === undefined ? '' : `: ${item.reason}`}`,
                      }),
                    ),
              ),
              Effect.ensuring(
                Effect.sync(() => {
                  compacting = null;
                }),
              ),
            ),
            cancel: Effect.andThen(
              drop(),
              Effect.asVoid(Deferred.fail(done, new AgentFault({ code: -32800, message: 'the compaction was cancelled' }))),
            ),
          } satisfies ClientCompaction;
        }),
        close: Effect.void,
      },
      door,
      process,
      outlet,
      scope,
    );
  };

  return {
    extensions: MUSE_CODE_EXTENSIONS,
    initialize: {
      protocolVersion: 1,
      agentInfo: { name: 'tagma-muse-code', version: launch.version },
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true }, sessionCapabilities: { resume: {}, close: {} } },
    },
    modes: { currentModeId: 'agent', availableModes: [{ id: 'agent', name: 'Agent' }] },
    open: Effect.fnUntraced(function* (opening, outlet, replacing) {
      yield* replacing;
      const seat: Seat = { id: opening.origin === 'new' ? runner.mint() : opening.id, cwd: opening.cwd, fresh: opening.origin === 'new' };
      if (!seat.fresh) yield* attach(seat, yield* wanted());
      return yield* sessionOf(seat, opening.origin === 'new' && opening.history.length > 0 ? historyBlocks(opening.history) : [], outlet);
    }),
  } satisfies Cycle;
});

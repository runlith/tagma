import { Clock, Deferred, Effect, Exit, FileSystem, Option, Predicate, Result, Schema, Scope } from 'effect';
import { AgentFault, FAULT, type Outlet } from '@runlith/acp/agent';
import type { ContentBlock } from '@runlith/acp/content';
import { QuotaObservation, QuotaWindow } from '@runlith/llm/schema/quota';
import { Bridge, servedPrompt, type BridgeVendor } from '@runlith/hosted-runner/bridge';
import { clientSession, type ClientCompaction, type ClientOutcome, type ClientRun } from '@runlith/hosted-runner/client';
import type { Cycle, Process, Steered, Withdrawn } from '@runlith/hosted-runner/cycle';
import type { HostedDoor, HostedListed } from '@runlith/hosted-runner/door';
import { Handed } from '@runlith/hosted-runner/handed';
import { historyBlocks } from '@runlith/hosted-runner/history';
import { Options, type ClientLaunch } from '@runlith/hosted-runner/options';
import type { Output } from '@runlith/hosted-runner/output';
import { COST, QUOTA } from '@runlith/hosted-runner/wire/extensions';
import { MUSE_CODE_EXTENSIONS } from '../harness/acp.js';
import type { McpServerInput } from '@runlith/mcp/server';
import { MuseSdk, type Frame, type Host, type MuseRefused } from './channel.js';
import { Feed, NOTHING, spentOf, sum, type Spent } from './feed.js';
import { Compact, ItemEvent, Models, Opened, Quota, Started, TokenUsage, TurnCompleted, TurnStarted, type Item } from './frames.js';
import { writeSettings, type MusePlace } from './home.js';

const PROVIDER_ID = 'meta';
const PROFILE = ':ask-me';
const APPROVALS = 'promptUnmatched';
const CONTINUE = 'Continue the work.';

const unsent: ClientRun = { wait: Effect.succeed({ status: 'cancelled' }), cancel: Effect.void };
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

type Want = { readonly prompt: string; readonly web: 'vendor' | 'none'; readonly listed: HostedListed };
type Seat = { readonly id: string; readonly cwd: string; fresh: boolean };
type Live = {
  readonly host: Host;
  readonly key: string;
  readonly scope: Scope.Closeable;
  readonly loaded: Set<string>;
  readonly windows: ReadonlyMap<string, number>;
};
type Compacting = { readonly session: string; readonly output: Output; readonly done: Deferred.Deferred<Item, AgentFault> };
type Asking = {
  session: string | null;
  turn: string | null;
  readonly done: Deferred.Deferred<AsideAnswer, AgentFault>;
  readonly said: string[];
  spent: Spent;
  usd: number | null;
};
type Reaching = { host: boolean; feed: Feed | null };
type Acquired = {
  readonly standing: Live;
  readonly running: Feed;
  readonly turn: string;
  readonly done: Deferred.Deferred<ClientOutcome>;
};
type AsideAnswer = { readonly text: string; readonly usage?: Spent; readonly _meta?: Readonly<Record<string, unknown>> };

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

const partOf = (block: ContentBlock): Effect.Effect<Part, AgentFault> => {
  switch (block.type) {
    case 'text':
      return Effect.succeed({ type: 'text', text: block.text });
    case 'image':
      return Effect.succeed({ type: 'image', base64Data: block.data, mediaType: block.mimeType });
    case 'resource_link':
      return Effect.succeed({ type: 'text', text: `[${block.name}](${block.uri})` });
    case 'resource':
      if ('text' in block.resource)
        return Effect.succeed({ type: 'text', text: `<context ref="${block.resource.uri}">\n${block.resource.text}\n</context>` });
      if (block.resource.mimeType?.startsWith('image/') === true)
        return Effect.succeed({ type: 'image', base64Data: block.resource.blob, mediaType: block.resource.mimeType });
      return Effect.fail(
        new AgentFault({
          code: FAULT.invalidParams,
          message: `Muse Code cannot receive a ${block.resource.mimeType ?? 'binary'} resource`,
        }),
      );
    default:
      return Effect.fail(new AgentFault({ code: FAULT.invalidParams, message: `Muse Code cannot receive ${block.type} content` }));
  }
};

const partsOf = (blocks: readonly ContentBlock[]): Effect.Effect<readonly Part[], AgentFault> => Effect.forEach(blocks, partOf);

const said = (parts: readonly Part[]): readonly Part[] => {
  const kept = parts.filter((part) => part.type !== 'text' || (part.text ?? '').trim() !== '');
  return kept.length === 0 ? [{ type: 'text', text: CONTINUE }] : kept;
};

const keyOf = (want: Want): string =>
  JSON.stringify([
    want.web,
    want.listed.dispatch,
    want.listed.tools.toSorted((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)),
    want.prompt,
  ]);

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
  let asking: Asking | null = null;
  let output: Output | null = null;
  let observed: unknown = null;
  let window: number | null = null;
  let applied: { readonly session: string; readonly model: string } | null = null;
  const words = new Map<string, Deferred.Deferred<void>>();
  const refused = new Set<string>();
  const steers = new Map<string, { readonly command: string; readonly feed: Feed }>();
  const priced = new Map<string, number>();

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
    const { window: session, weekly, observedAtMs, tier } = read.success;
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
      new QuotaObservation({ observedAt: new Date(observedAt), source: 'usage', windows, plan: tier }),
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

  const interrupt = Effect.fnUntraced(function* (sessionId: string, turnId: string) {
    const standing = live;
    if (standing === null) return;
    yield* Effect.forkIn(
      standing.host.command('turn/interrupt', { sessionId, turnId }).pipe(
        Effect.asVoid,
        Effect.catchTag('MuseRefused', (refused) =>
          refused.kind === 'commandRejected' || live !== standing
            ? Effect.void
            : Effect.andThen(
                Effect.sync(() => process.stderr(`Muse Code refused to stop turn ${turnId}: ${refused.message}; its host is replaced\n`)),
                drop(),
              ),
        ),
      ),
      scope,
    );
  });

  const orphan = Effect.fnUntraced(function* (frame: Frame) {
    const read = Schema.decodeUnknownResult(TurnStarted)(frame.params);
    if (Result.isFailure(read) || live === null) return;
    const { sessionId, turnId } = read.success;
    process.stderr(`Muse Code started turn ${turnId}, which no Tagma turn holds; it is interrupted\n`);
    yield* interrupt(sessionId, turnId);
  });

  const aside = Effect.fnUntraced(function* (frame: Frame, side: Asking) {
    if (frame.method === 'item/completed') {
      const read = Schema.decodeUnknownResult(ItemEvent)(frame.params);
      if (Result.isSuccess(read) && read.success.item.kind === 'agentMessage' && read.success.item.text !== undefined)
        side.said.push(read.success.item.text);
      return;
    }
    if (frame.method === 'session/tokenUsage') {
      const read = Schema.decodeUnknownResult(TokenUsage)(frame.params);
      if (Result.isFailure(read)) return;
      side.spent = sum(side.spent, spentOf(read.success.usage));
      side.usd = read.success.cumulative?.cost?.usd ?? side.usd;
      return;
    }
    if (frame.request) {
      const reason = `Muse Code asked ${frame.method} inside a side question, which takes no answer back; the side question is stopped`;
      process.stderr(`${reason}\n`);
      yield* Deferred.fail(side.done, new AgentFault({ code: FAULT.internal, message: reason }));
      const turn = typeof frame.params.turnId === 'string' ? frame.params.turnId : side.turn;
      if (side.session !== null && turn !== null) yield* interrupt(side.session, turn);
      return;
    }
    if (frame.method !== 'turn/completed') return;
    const read = Schema.decodeUnknownResult(TurnCompleted)(frame.params);
    if (Result.isFailure(read)) return;
    if (read.success.terminal !== 'completed')
      return yield* Deferred.fail(
        side.done,
        new AgentFault({
          code: FAULT.internal,
          message: read.success.error?.message ?? `Muse Code ended the side question ${read.success.terminal}`,
        }),
      );
    const usage = side.spent === NOTHING ? undefined : side.spent;
    const cost = side.usd === null ? undefined : { amount: side.usd, currency: 'USD', basis: 'estimate' };
    yield* Deferred.succeed(side.done, { text: side.said.join('\n\n'), usage, _meta: cost === undefined ? undefined : { [COST]: cost } });
  });

  const route = Effect.fnUntraced(function* (frame: Frame) {
    if (frame.method === 'usage/changed') return yield* quota(frame);
    const side = asking;
    if (side !== null && side.session !== null && frame.params.sessionId === side.session) return yield* aside(frame, side);
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
    const side = asking;
    if (side !== null) yield* Deferred.fail(side.done, new AgentFault({ code: FAULT.internal, message: reason }));
    yield* settleWords();
    yield* process.died(reason);
  });

  const drop = Effect.fnUntraced(function* () {
    const standing = live;
    if (standing === null) return;
    live = null;
    applied = null;
    const side = asking;
    if (side !== null)
      yield* Deferred.fail(side.done, new AgentFault({ code: FAULT.internal, message: 'Muse Code was replaced under the side question' }));
    yield* Scope.close(standing.scope, Exit.void);
  });

  const ensureHost = Effect.fnUntraced(function* (want: Want, cwd: string) {
    const key = keyOf(want);
    yield* bridge.serve(want.listed);
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
      priced.set(seat.id, 0);
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
      if (applied?.model !== model) window = null;
      applied = { session: seat.id, model };
    }
    return standing;
  });

  const wanted = Effect.fnUntraced(function* () {
    const [agent, listed] = yield* Effect.zip(door.agent(), door.tools());
    return { prompt: servedPrompt(agent.prompt, listed.dispatch), web: agent.web, listed } satisfies Want;
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
        send: Effect.fnUntraced(function* ({ input, prepared, output: out, permitted, halted }) {
          output = out;
          yield* report();
          const reaching: Reaching = { host: false, feed: null };
          const acquire = Effect.gen(function* () {
            const prompt = prepared.opened.prompt ?? (yield* door.agent()).prompt;
            reaching.host = true;
            const standing = yield* attach(seat, {
              prompt: servedPrompt(prompt, prepared.listed.dispatch),
              web: prepared.opened.web,
              listed: prepared.listed,
            });
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
                callOf: (tool, input) => bridge.callOf(tool, input),
                stderr: process.stderr,
                began: Effect.andThen(
                  input.taken,
                  Effect.sync(() => {
                    history = [];
                  }),
                ),
                abandon: Effect.suspend(() => (live === standing ? drop() : Effect.void)),
                pricedBefore: priced.get(seat.id) ?? null,
                priced: (usd) => void priced.set(seat.id, usd),
              },
              done,
            );
            reaching.feed = running;
            feed = running;
            const admitted = yield* standing.host
              .command(
                'turn/start',
                {
                  sessionId: seat.id,
                  input: said(parts),
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
            if (admitted.disposition === 'started') yield* running.begin();
            return Option.some({ standing, running, turn, done });
          });
          const acquired = yield* Effect.raceFirst(acquire, Effect.as(halted, Option.none<Acquired>()));
          if (Option.isNone(acquired)) {
            if (reaching.feed !== null && feed === reaching.feed) feed = null;
            if (reaching.host) yield* drop();
            return unsent;
          }
          const { standing, running, turn, done } = acquired.value;
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
              const open = yield* running.stop();
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
              const read = running.steering(command);
              if (word !== undefined) steers.set(word, { command, feed: running });
              const admitted = yield* standing.host
                .command('turn/steer', { sessionId: seat.id, expectedTurnId: running.current, input: steering }, command)
                .pipe(
                  Effect.as(true),
                  Effect.catchTag('MuseRefused', (refusal) =>
                    Effect.andThen(running.unsteered(command), () => {
                      if (word !== undefined) steers.delete(word);
                      if (refusal.kind !== 'commandRejected') return Effect.fail(faultOf(refusal));
                      if (word !== undefined) refused.add(word);
                      return Effect.succeed(false);
                    }),
                  ),
                  Effect.ensuring(settled === null ? Effect.void : Deferred.succeed(settled, undefined)),
                );
              const outcome: Steered['outcome'] = admitted && (yield* Deferred.await(read)) ? 'injected' : 'promptRequired';
              return { outcome } satisfies Steered;
            }),
            withdraw: Effect.fnUntraced(function* (word: string) {
              const pending = words.get(word);
              if (pending !== undefined) yield* Deferred.await(pending);
              if (refused.delete(word)) return { withdrawn: true } satisfies Withdrawn;
              const sent = steers.get(word);
              if (sent === undefined || !sent.feed.cancelled) return { withdrawn: false } satisfies Withdrawn;
              steers.delete(word);
              yield* Deferred.await(sent.feed.done);
              if (sent.feed.doubted.has(sent.command))
                return yield* new AgentFault({
                  code: FAULT.internal,
                  message: `Muse Code cannot show whether it still holds the words of ${sent.command}`,
                });
              return { withdrawn: sent.feed.unread.has(sent.command) } satisfies Withdrawn;
            }),
          } satisfies ClientRun;
        }),
        compact: Effect.fnUntraced(function* (_instructions, out, halted) {
          output = out;
          const done = yield* Deferred.make<Item, AgentFault>();
          const release = Effect.sync(() => {
            if (compacting?.done === done) compacting = null;
          });
          const admit = Effect.gen(function* () {
            const standing = live ?? (yield* attach(seat, yield* wanted()));
            yield* load(standing, seat);
            compacting = { session: seat.id, output: out, done };
            const asked = yield* standing.host
              .command('session/compact', { sessionId: seat.id })
              .pipe(Effect.mapError(faultOf), Effect.flatMap(decoded(Compact, 'session/compact')));
            return Option.some(asked);
          }).pipe(Effect.onError(() => release));
          const asked = yield* Effect.raceFirst(admit, Effect.as(halted, Option.none<typeof Compact.Type>()));
          if (Option.isNone(asked)) {
            yield* drop();
            yield* Deferred.fail(
              done,
              new AgentFault({ code: -32800, message: 'the compaction was cancelled while Muse Code was admitting it' }),
            );
          } else if (asked.value.status !== 'accepted') {
            yield* release;
            return yield* new AgentFault({
              code: FAULT.invalidRequest,
              message: `Muse Code had nothing to compact${asked.value.reason === undefined ? '' : ` (${asked.value.reason})`}`,
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
              Effect.ensuring(release),
            ),
            cancel: Effect.andThen(
              drop(),
              Effect.asVoid(Deferred.fail(done, new AgentFault({ code: -32800, message: 'the compaction was cancelled' }))),
            ),
          } satisfies ClientCompaction;
        }),
        aside: Effect.fnUntraced(function* (question: string) {
          if (asking !== null)
            return yield* new AgentFault({ code: FAULT.invalidRequest, message: 'a side question is already being answered' });
          const mine: Asking = {
            session: null,
            turn: null,
            done: Deferred.makeUnsafe<AsideAnswer, AgentFault>(),
            said: [],
            spent: NOTHING,
            usd: null,
          };
          asking = mine;
          return yield* Effect.gen(function* () {
            const standing = live ?? (yield* attach(seat, yield* wanted()));
            yield* load(standing, seat);
            const opened = yield* standing.host
              .command('session/sideChat', { sessionId: seat.id })
              .pipe(Effect.mapError(faultOf), Effect.flatMap(decoded(Opened, 'session/sideChat')));
            const side = opened.session.sessionId;
            mine.session = side;
            const { model, effort } = options.read();
            if (model !== null)
              yield* standing.host
                .command('session/setModel', { sessionId: side, model: { modelId: model, providerId: PROVIDER_ID } })
                .pipe(Effect.mapError(faultOf));
            if (effort !== null)
              yield* standing.host
                .command('session/setReasoningEffort', { sessionId: side, reasoningEffort: effort })
                .pipe(Effect.mapError(faultOf));
            const turn = runner.mint();
            mine.turn = turn;
            yield* standing.host
              .command(
                'turn/start',
                { sessionId: side, input: [{ type: 'text', text: question }], ...(effort === null ? {} : { reasoningEffort: effort }) },
                turn,
              )
              .pipe(Effect.mapError(faultOf));
            return yield* Deferred.await(mine.done);
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (asking === mine) asking = null;
              }),
            ),
          );
        }),
        close: Effect.suspend(() => (live?.loaded.has(seat.id) === true ? drop() : Effect.void)),
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
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, embeddedContext: true },
        sessionCapabilities: { resume: {}, close: {} },
      },
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

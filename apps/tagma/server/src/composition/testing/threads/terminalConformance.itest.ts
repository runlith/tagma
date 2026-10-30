import { describe, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { watch } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Cause, Clock, Context, Effect, FileSystem, Layer, Queue, Schedule, Schema, type Scope, Stream } from 'effect';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { RUN_UNOWNED } from '../../../external-harnesses/contract/wire/call.js';
import { describeTransportWords, type WordCase, type WordRig, type WordState } from '@runlith/agent/thread/conformance/transportWords';
import {
  describeTransportStops,
  type StopCase,
  type StopRig,
  type StopState,
  type Unreachable,
} from '@runlith/agent/thread/conformance/transportStops';
import type { ThreadStop } from '@runlith/agent/thread/ending';
import { screenLines } from '@runlith/executions/protocol/presentationText';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { GRANT_HEADER } from '../../../platform/contract/service/credentials.js';
import { grantFor } from '../../../platform/testing/grants.js';
import { CALL_HEADER } from '../../../invocation/contract/wire/headers.js';
import { LEASE_RHYTHM } from '../../../threads/contract/wire/rhythm.js';
import { harnessSessionActive } from '../../../threads/contract/wire/harness/session.js';
import type { HarnessReportInput } from '../../../threads/contract/wire/harness/observation.js';
import { TerminalScreens } from '../../../executions/contract/service/records.js';
import { Terminals } from '../../../executions/contract/service/terminals.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { ThreadHarness } from '../../../threads/contract/service/engine.js';
import { SHIPPED_HARNESSES } from '../../../external-harnesses/testing/builtin.js';
import { HarnessPermissions } from '../../../external-harnesses/contract/service/permissions.js';
import { WORLD_COMMAND } from '../../../installation/contract/wire/layout.js';
import { makeDoorWorld, projectLeaving } from '../doorFixture.js';
import { claudeLogin, keepAccountDefaults } from '../claudeLogin.js';
import { AccountKey } from '@runlith/llm/models/authStatus';
import { HarnessDirectories } from '../../../providers/accounts/harnessRows.js';
import { DefaultAccounts } from '../../../providers/contract/service/accounts.js';
import { deliveryRig, until as readUntil, whoSpeaks, type Who } from './terminalDeliveryRig.js';
import { stamp, terminalRig, type Cli } from './terminalRig.js';
import { windowChannel } from './windowChannel.js';

const answering = [
  '#!/bin/sh',
  'case "$1" in --version) echo "2.1.306 (Claude Code)"; exit 0;; auth) echo \'{"loggedIn":false}\'; exit 0;; esac',
];
const TUI = `const { appendFileSync, existsSync, writeFileSync, watch } = require('node:fs');
const [report, keys, ...argv] = process.argv.slice(2);
const rule = '─'.repeat(40);
const heard = (event) => appendFileSync(keys + '.events', JSON.stringify(event) + '\\n');
writeFileSync(keys + '.pid', String(process.pid));
appendFileSync(report, argv.join(' '));
heard({ kind: 'boot', prompt: argv.includes('--') ? argv[argv.indexOf('--') + 1] : null });
let working = false;
let escaped = false;
let drawn = null;
const draw = () => {
  const busy = existsSync(keys + '.listened') ? existsSync(keys + '.turn') : working && !(escaped && !existsSync(keys + '.hold'));
  const screen = (busy ? '✶ Working… (1s)\\r\\n' : '') + rule + '\\r\\n❯\\r\\n' + rule + '\\r\\n';
  if (screen === drawn) return;
  drawn = screen;
  process.stdout.write('\\x1b[2J\\x1b[H' + screen);
};
process.stdout.write('\\x1b[?2004h');
process.stdin.setRawMode(true);
const OPEN = '\\x1b[200~';
const CLOSE = '\\x1b[201~';
let pending = '';
process.stdin.on('data', (chunk) => {
  appendFileSync(report, chunk);
  pending += chunk.toString('utf8');
  for (;;) {
    if (pending.startsWith(OPEN)) {
      const end = pending.indexOf(CLOSE);
      if (end < 0) break;
      heard({ kind: 'paste', text: pending.slice(OPEN.length, end).replace(/\\r/g, '\\n') });
      pending = pending.slice(end + CLOSE.length);
    } else if (pending.startsWith('\\x1b[')) {
      if (pending.length < OPEN.length) break;
      pending = pending.slice(1);
    } else if (pending.startsWith('\\x1b')) {
      heard({ kind: 'esc' });
      appendFileSync(keys, 'esc\\n');
      escaped = true;
      pending = pending.slice(1);
    } else if (pending.startsWith('\\r')) {
      heard({ kind: 'enter' });
      working = true;
      escaped = false;
      pending = pending.slice(1);
    } else if (pending.length > 0) pending = pending.slice(1);
    else break;
  }
  draw();
});
watch(require('node:path').dirname(keys), () => {
  if (existsSync(keys + '.exit')) process.exit(0);
  draw();
});
draw();
`;

const SCREENS = `const { appendFileSync, existsSync, watch } = require('node:fs');
const [report, keys] = process.argv.slice(2);
const rule = '─'.repeat(40);
const confirm = (said, options) => [rule, ...said.map((line) => ' ' + line), '', ' ❯ ' + options[0], ...options.slice(1).map((option) => '   ' + option), '', ' Enter to confirm · Esc to cancel'];
const TRUST = confirm(['Accessing workspace:', 'Quick safety check: Is this a project you created or one you trust?'], ['No, exit', 'Yes, I trust this folder']);
const BYPASS = confirm(['WARNING: Claude Code running in Bypass Permissions mode'], ['No, exit', 'Yes, I accept']);
let drawn = null;
const draw = () => {
  const screen = (existsSync(keys + '.trusted') ? BYPASS : TRUST).join('\\r\\n') + '\\r\\n';
  if (screen === drawn) return;
  drawn = screen;
  process.stdout.write('\\x1b[2J\\x1b[H' + screen);
};
process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => appendFileSync(report, chunk));
watch(require('node:path').dirname(keys), draw);
draw();
`;

const UNREACHABLE: Partial<Record<StopState, string>> = {
  'compaction-end':
    'the terminal transport declares compaction none, so Tagma opens no compaction run after a turn; the CLI compacts only inside its own turn (compaction-step)',
};

const setup = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const stage = yield* files.makeTempDirectoryScoped({ prefix: 'conformance-cli-' });
  const bin = join(stage, 'bin');
  yield* files.makeDirectory(bin);
  for (const binary of [WORLD_COMMAND, ...SHIPPED_HARNESSES.map(({ binary }) => binary).filter((binary) => !isAbsolute(binary))])
    yield* files.writeFileString(join(bin, binary), '#!/bin/sh\nprintf "fixture\\n"\n', { mode: 0o755 });
  yield* files.writeFileString(join(stage, 'tui.js'), TUI);
  yield* files.writeFileString(join(stage, 'screens.js'), SCREENS);
  const path = process.env.PATH;
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.env.PATH = `${bin}:${path ?? ''}`;
    }),
    () =>
      Effect.sync(() => {
        if (path === undefined) delete process.env.PATH;
        else process.env.PATH = path;
      }),
  );
  const world = yield* makeDoorWorld({
    models: (standing) => ({ ...standing, request: (input) => ({ ...standing.request(input), stream: () => Stream.never }) }),
  });
  yield* claudeLogin(world);
  const projectId = yield* world.stealthProject(yield* world.directory('conformance-project'));
  yield* projectLeaving(world, projectId);
  yield* Context.get(world.runtime.workspace, Coverage).cover(projectId);
  const rig = yield* terminalRig(world, projectId, yield* world.directory('terminal-conformance'));
  return { world, rig, flow: deliveryRig(world, rig), stage, bin, projectId };
});
class World extends Context.Service<World, Effect.Success<typeof setup>>()('testing/TerminalConformanceWorld') {}

const notices = Effect.fnUntraced(function* (threadId?: string) {
  const { world, stage } = yield* World;
  const moved = yield* Effect.acquireRelease(Queue.sliding<void>(1), Queue.shutdown);
  const wake = () => {
    Queue.offerUnsafe(moved, undefined);
  };
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const watcher = watch(stage, wake);
      const reads = Context.get(world.runtime.owners, ThreadHarness).reads;
      const unsubscribe = threadId === undefined ? reads.subscribeStates(wake) : reads.subscribe(threadId, wake);
      return () => {
        watcher.close();
        unsubscribe();
      };
    }),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
  return moved;
});
const until = <A, E, R>(read: Effect.Effect<A | null, E, R>, what: string, threadId?: string) =>
  Effect.flatMap(World, (world) =>
    readUntil(read, what, Effect.provideService(Effect.map(notices(threadId), Queue.take), World, world)),
  ).pipe(Effect.tapCause(() => Effect.logWarning('the conformance wait failed', { what })));

const textOf = Effect.fnUntraced(function* (file: string) {
  const files = yield* FileSystem.FileSystem;
  return (yield* files.exists(file)) ? yield* files.readFileString(file) : '';
});
const typedIn = (report: string) =>
  Effect.map(textOf(report), (text) => [...text.matchAll(/<input envelope="([^"]+)"/g)].map((found) => found[1]!));
const pressed = (keys: string) => Effect.map(textOf(keys), (text) => text.split('\n').filter((line) => line === 'esc').length);

const screenOf = Effect.fn('testing.conformanceScreen')(function* (cli: Cli) {
  const { world } = yield* World;
  const execution = (yield* cli.facet())?.execution;
  if (execution === null || execution === undefined) return null;
  const record = yield* Context.get(world.runtime.owners, Terminals).record(execution.execution, execution.incarnation);
  if (record === null) return null;
  return yield* Context.get(world.runtime.owners, TerminalScreens).screen(record.execution);
});

const screensOf = (cli: Cli) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const { world } = yield* World;
      const execution = (yield* cli.facet())?.execution;
      if (execution == null) return yield* Effect.die('the CLI has no execution');
      const terminal = yield* Context.get(world.runtime.owners, Terminals).record(execution.execution, execution.incarnation);
      if (terminal === null) return yield* Effect.die('the CLI has no terminal');
      return Context.get(world.runtime.owners, TerminalScreens).screens(terminal.execution);
    }),
  );

type Fake = Effect.Success<ReturnType<typeof raised>>;

const launched = Effect.fn('testing.conformanceLaunched')(function* (script: string, name: string, approvalMode?: 'review') {
  const { rig, flow, stage, bin } = yield* World;
  const files = yield* FileSystem.FileSystem;
  const report = join(stage, `${name}.stdin`);
  const keys = join(stage, `${name}.keys`);
  yield* files.writeFileString(
    join(bin, 'claude'),
    [...answering, `exec ${process.execPath} ${join(stage, script)} ${report} ${keys} "$@"`].join('\n'),
    {
      mode: 0o755,
    },
  );
  const cli = yield* rig.raised({ name, transcript: '', seeded: false, approvalMode });
  yield* flow.sayTo(cli, 'first words');
  return { cli, report, keys };
});

const raised = Effect.fn('testing.conformanceCli')(function* (name: string, approvalMode?: 'review') {
  const files = yield* FileSystem.FileSystem;
  const { cli, report, keys } = yield* launched('tui.js', name, approvalMode);
  const first = yield* until(
    Effect.map(cli.facet(), (facet) =>
      facet?.session?.state === 'running' && facet.turn !== undefined && (facet.unread ?? []).length > 0 ? facet : null,
    ),
    'started its CLI with the first words',
  );
  const who: Who = whoSpeaks(first);
  const items = first.unread![0]!.items;
  let prompts = 1;
  const state = { turns: 0, taken: items.length };
  const hook = (event: string, over: Record<string, unknown> = {}, input: HarnessReportInput = {}) =>
    cli.hook(event, { session_id: who.root, ...over }, { session: who.session, ...input });
  const echoed = (inputs: readonly string[], prompt: string) => {
    state.taken += inputs.length;
    return hook('UserPromptSubmit', { prompt_id: prompt }, { inputs });
  };
  const prompted = Effect.fnUntraced(function* (inputs: readonly string[]) {
    prompts += 1;
    const id = `p${prompts}`;
    yield* echoed(inputs, id);
    return id;
  });
  yield* hook('UserPromptSubmit', { prompt_id: 'p1' }, { inputs: items });
  yield* hook('Stop', { prompt_id: 'p1' }, { said: { last_assistant_message: 'done' } });
  yield* until(
    Effect.map(cli.running(), (running) => (running === null ? true : null)),
    'closed its first run',
  );
  yield* screensOf(cli).pipe(
    Stream.filter((update) => update._tag !== 'ScreenUnavailable' && update.input._tag === 'Available' && update.input.bracketedPaste),
    Stream.take(1),
    Stream.runDrain,
  );
  return {
    cli,
    who,
    report,
    keys,
    state,
    hook,
    echoed,
    prompted,
    current: () => `p${prompts}`,
    hold: () => files.writeFileString(`${keys}.hold`, ''),
    unhold: () => files.remove(`${keys}.hold`, { force: true }),
    held: () => Effect.map(typedIn(report), (ids) => ids.slice(state.taken)),
  };
});

const working = Effect.fn('testing.conformanceWorking')(function* (fake: Fake) {
  const { flow } = yield* World;
  yield* flow.sayTo(fake.cli, 'second words');
  const runId = yield* until(fake.cli.running(), 'opened the second run');
  const items = yield* until(
    Effect.map(fake.held(), (ids) => (ids.length === 0 ? null : ids)),
    'the CLI heard the second words',
  );
  yield* fake.prompted(items);
  return runId;
});

const steered = Effect.fn('testing.conformanceSteered')(function* (fake: Fake) {
  const { flow } = yield* World;
  yield* flow.sayTo(fake.cli, 'steer words');
  return yield* until(
    Effect.map(fake.held(), (ids) => (ids.length > 0 ? ids : null)),
    'typed the steer words into the running turn',
  );
});

type Env = World | FileSystem.FileSystem;

const began = Effect.fnUntraced(function* (fake: Fake, words: readonly string[]) {
  const esc = yield* pressed(fake.keys);
  const id = yield* fake.prompted(words);
  if ((yield* fake.cli.facet())?.interrupted !== undefined) {
    yield* until(
      Effect.map(pressed(fake.keys), (count) => (count > esc ? true : null)),
      'interrupted the turn the CLI began while its stop stood unconfirmed',
    );
    return;
  }
  fake.state.turns += 1;
  yield* fake.hook('Stop', { prompt_id: id }, { said: { last_assistant_message: 'Carried on.' } });
});

const late = Effect.fnUntraced(function* (fake: Fake, threadId: string, then: Effect.Effect<unknown, unknown, Env>) {
  yield* then;
  const held = yield* fake.held();
  if (held.length > 0) yield* began(fake, held);
  yield* fake.unhold();
  for (;;) {
    const next = yield* until(
      Effect.gen(function* () {
        const words = yield* fake.held();
        if (words.length > 0) return words;
        const facet = yield* fake.cli.store.read(threadId);
        return facet?.interrupted === undefined && (yield* runningOf(threadId)) === null ? [] : null;
      }),
      'settled with no running run and the interrupt confirmed',
    );
    if (next.length === 0) return;
    yield* began(fake, next);
  }
});

const runningOf = Effect.fnUntraced(function* (threadId: string) {
  const { flow } = yield* World;
  const row = yield* flow
    .db()
    .get<{ readonly id: string }>(sql`select id from thread_run where thread_id = ${threadId} and status = 'running'`);
  return row?.id ?? null;
});

type Reached = {
  readonly threadId?: string;
  readonly stop?: Effect.Effect<ThreadStop, unknown, Env>;
  readonly late?: Effect.Effect<unknown, unknown, Env>;
};

const stopCase = Effect.fnUntraced(function* (fake: Fake, runId: string, options: Reached = {}) {
  const { flow } = yield* World;
  const context = yield* Effect.context<Env>();
  const run = <A, E>(effect: Effect.Effect<A, E, Env>) => Effect.provide(effect, context);
  const threadId = options.threadId ?? fake.cli.threadId;
  const reached: StopCase = {
    runId,
    stop: () => run(options.stop ?? flow.harness().threads.handle(threadId, OPERATOR_PRINCIPAL).stop()),
    ended: () => flow.ended(runId),
    journal: () => flow.journalOf(threadId, runId),
    agentTurns: () => Effect.sync(() => fake.state.turns),
    interrupts: () => run(pressed(fake.keys)),
    runsAfter: () =>
      Effect.map(
        flow.runsOf(threadId),
        (runs) => runs.slice(runs.findIndex((each) => each.id === runId) + 1).filter((each) => each.origin === 'core').length,
      ),
    settle: () => run(late(fake, threadId, options.late ?? Effect.void)),
  };
  return reached;
});

const call = (id: string, tool: string, subject: string) => ({ id, tool, subject });

const questioned = Effect.fnUntraced(function* (threadId: string) {
  const { flow } = yield* World;
  yield* until(
    Effect.map(flow.harness().reads.snapshot(threadId), (snapshot) => (snapshot.status.openQuestions.length > 0 ? true : null)),
    'opened the question',
  );
});

const reach = Effect.fnUntraced(function* (state: StopState): Effect.fn.Return<StopCase | Unreachable, unknown, Env | Scope.Scope> {
  const unreachable = UNREACHABLE[state];
  if (unreachable !== undefined) return { unreachable };
  const { world, rig, flow, projectId } = yield* World;
  const files = yield* FileSystem.FileSystem;
  switch (state) {
    case 'opening': {
      const fake = yield* raised(state);
      yield* fake.hold();
      yield* flow.sayTo(fake.cli, 'second words');
      return yield* stopCase(fake, yield* until(fake.cli.running(), 'opened the run'));
    }
    case 'thinking':
    case 'writing': {
      const fake = yield* raised(state);
      const runId = yield* working(fake);
      yield* fake.hold();
      const said = { last_assistant_message: 'Late words of the stopped turn.' };
      return yield* stopCase(fake, runId, {
        late: state === 'writing' ? fake.hook('Stop', { prompt_id: fake.current() }, { said }) : Effect.void,
      });
    }
    case 'tagma-call': {
      const fake = yield* raised(state);
      const runId = yield* working(fake);
      const own = (yield* fake.cli.facet())!.execution!;
      const tagma = call('toolu_tagma', 'mcp__tagma__wait_terminal', own.execution);
      yield* fake.hook('PreToolUse', { tool_name: tagma.tool }, { call: tagma });
      yield* Effect.forkScoped(
        world.op('wait_terminal', { ...own, waitMs: 30_000 }, `project=${projectId}`, {
          [GRANT_HEADER]: grantFor(fake.cli.threadId),
          [CALL_HEADER]: tagma.id,
        }),
      );
      yield* fake.hold();
      return yield* stopCase(fake, runId, {
        late: fake.hook('PostToolUse', { tool_name: tagma.tool }, { call: { ...tagma, done: true, failed: true, output: 'cancelled' } }),
      });
    }
    case 'vendor-call': {
      const fake = yield* raised(state);
      const runId = yield* working(fake);
      const bash = call('toolu_bash', 'bash', 'sleep 60');
      yield* fake.hook('PreToolUse', { tool_name: 'Bash' }, { call: bash });
      yield* fake.hold();
      return yield* stopCase(fake, runId, {
        late: fake.hook('PostToolUse', { tool_name: 'Bash' }, { call: { ...bash, done: true, output: 'late output' } }),
      });
    }
    case 'question': {
      const fake = yield* raised(state, 'review');
      const runId = yield* working(fake);
      const push = call('toolu_push', 'bash', 'git push origin main');
      yield* fake.hook('PreToolUse', { tool_name: 'Bash' }, { call: push });
      const permissions = Context.get(world.runtime.owners, HarnessPermissions);
      const decision = yield* permissions.judge(fake.cli.threadId, push);
      if (decision._tag !== 'Asked') return yield* Effect.die(new Error(`the call was not asked: ${decision._tag}`));
      yield* Effect.forkScoped(permissions.outcome(fake.cli.threadId, decision.requestId, 30_000));
      yield* questioned(fake.cli.threadId);
      yield* fake.hold();
      return yield* stopCase(fake, runId, {
        late: fake.hook('PostToolUse', { tool_name: 'Bash' }, { call: { ...push, done: true, failed: true, output: 'denied' } }),
      });
    }
    case 'compaction-step': {
      const fake = yield* raised(state);
      const runId = yield* working(fake);
      yield* fake.hook('PreCompact', { trigger: 'auto' });
      yield* fake.hold();
      return yield* stopCase(fake, runId, { late: fake.hook('SessionStart', { source: 'compact' }) });
    }
    case 'reopening': {
      const fake = yield* raised(state);
      yield* files.writeFileString(`${fake.keys}.exit`, '');
      yield* until(
        Effect.map(fake.cli.facet(), (facet) => (harnessSessionActive(facet?.session) ? null : true)),
        'saw the CLI process end',
      );
      yield* files.remove(`${fake.keys}.exit`);
      yield* fake.hold();
      yield* flow.sayTo(fake.cli, 'second words');
      return yield* stopCase(fake, yield* until(fake.cli.running(), 'opened the run that reopens the CLI'));
    }
    case 'steer-unechoed': {
      const fake = yield* raised(state);
      const runId = yield* working(fake);
      yield* fake.hold();
      yield* steered(fake);
      return yield* stopCase(fake, runId);
    }
    case 'steer-echoed': {
      const fake = yield* raised(state);
      const runId = yield* working(fake);
      yield* fake.hold();
      yield* fake.echoed(yield* steered(fake), fake.current());
      return yield* stopCase(fake, runId);
    }
    case 'natural-end': {
      const fake = yield* raised(state);
      const runId = yield* working(fake);
      const ending = fake.hook('Stop', { prompt_id: fake.current() }, { said: { last_assistant_message: 'Done.' } });
      const stop = flow.harness().threads.handle(fake.cli.threadId, OPERATOR_PRINCIPAL).stop();
      return yield* stopCase(fake, runId, {
        stop: Effect.map(Effect.all([ending, stop], { concurrency: 'unbounded' }), ([, answer]) => answer),
      });
    }
    case 'unlinked': {
      const fake = yield* raised(state);
      const runId = yield* working(fake);
      const pid = Number(yield* files.readFileString(`${fake.keys}.pid`));
      yield* Effect.sync(() => process.kill(pid, 'SIGKILL'));
      return yield* stopCase(fake, runId);
    }
    case 'restarted': {
      const host = yield* raised('restarted-host');
      const execution = (yield* host.cli.facet())!.execution!;
      const orphan = yield* rig.raised({ name: state, transcript: '' });
      const quiet = (yield* Clock.currentTimeMillis) - LEASE_RHYTHM.takeoverAfterMs - 1_000;
      const runId = `run-${crypto.randomUUID()}`;
      yield* flow
        .db()
        .run(
          sql`insert into thread_run (id, thread_id, status, owner_id, started_at, heartbeat_at, created_at, updated_at) values (${runId}, ${orphan.threadId}, 'running', 'a-server-that-died', ${quiet}, ${quiet}, ${quiet}, ${quiet})`,
        );
      const old = new Date(quiet).toISOString();
      const openedAt = yield* stamp();
      yield* orphan.store.change(orphan.threadId, (facet) =>
        Effect.succeed({
          facet: {
            ...facet,
            execution,
            session: facet.session === undefined ? undefined : { ...facet.session, ownerId: 'a-server-that-died', heartbeatAt: old },
            turn: { run: runId, turn: 'p-before-restart', openedAt, offset: null },
          },
          value: undefined,
        }),
      );
      return yield* stopCase(host, runId, { threadId: orphan.threadId });
    }
    case 'repeated': {
      const fake = yield* raised(state);
      const runId = yield* working(fake);
      yield* fake.hold();
      return yield* stopCase(fake, runId);
    }
    default:
      return yield* Effect.die(new Error(`the terminal rig has no way into ${state}`));
  }
});

const terminalStops: StopRig<Env> = { reach };

const HeardEvent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('boot'), prompt: Schema.NullOr(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal('paste'), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literals(['enter', 'esc']) }),
]);
const decodeHeard = Schema.decodeUnknownEffect(Schema.fromJsonString(HeardEvent));

const envelopes = (texts: readonly string[]) =>
  texts.flatMap((text) =>
    [...text.matchAll(/<input envelope="([^"]+)"[^>]*>([\s\S]*?)<\/input>/g)].map((found) => ({ id: found[1]!, words: found[2]!.trim() })),
  );

const listened = Effect.fn('testing.conformanceListener')(function* (fake: Fake) {
  const files = yield* FileSystem.FileSystem;
  const { rig } = yield* World;
  const moved = yield* notices(fake.cli.threadId);
  const events = `${fake.keys}.events`;
  const busy = `${fake.keys}.turn`;
  const ear = {
    read: (yield* textOf(events)).length,
    open: null as string | null,
    holding: false,
    held: false,
    released: false,
    caught: true,
    broke: null as string | null,
  };
  const pastes: string[] = [];
  const heard: string[] = [];
  let prompts = 0;
  yield* files.writeFileString(`${fake.keys}.listened`, '');
  const said = Effect.fnUntraced(function* (event: string, prompt: string, input: HarnessReportInput) {
    const who = whoSpeaks((yield* fake.cli.facet())!);
    yield* fake.cli
      .hook(event, { session_id: who.root, prompt_id: prompt }, { session: who.session, ...input })
      .pipe(
        Effect.retry({ while: (failure) => failure instanceof GateRefusal && failure.code === RUN_UNOWNED, schedule: Schedule.spaced(25) }),
      );
  });
  const closed = Effect.fnUntraced(function* () {
    ear.open = null;
    ear.holding = false;
    yield* files.remove(busy, { force: true });
  });
  const answered = Effect.fnUntraced(function* () {
    if (ear.open === null) return;
    yield* said('Stop', ear.open, { said: { last_assistant_message: 'Heard.' } });
    yield* closed();
  });
  const submitted = Effect.fnUntraced(function* (texts: readonly string[]) {
    const found = envelopes(texts);
    if (found.length === 0) return;
    heard.push(...found.map((each) => each.words));
    const inputs = found.map((each) => each.id);
    if (ear.open !== null) return yield* said('UserPromptSubmit', ear.open, { inputs });
    prompts += 1;
    ear.open = `heard-${prompts}`;
    ear.holding = !ear.held && !ear.released;
    ear.held = true;
    yield* files.writeFileString(busy, '');
    yield* said('UserPromptSubmit', ear.open, { inputs });
  });
  const took = Effect.fnUntraced(function* (event: typeof HeardEvent.Type) {
    switch (event.kind) {
      case 'boot':
        pastes.length = 0;
        yield* closed();
        if (event.prompt !== null) yield* submitted([event.prompt]);
        return;
      case 'paste':
        pastes.push(event.text);
        return;
      case 'enter':
        return yield* submitted(pastes.splice(0));
      case 'esc':
        if (ear.open !== null) yield* closed();
        return;
    }
  });
  const tick = Effect.gen(function* () {
    const text = yield* textOf(events);
    const fresh = text.slice(ear.read);
    const complete = fresh.lastIndexOf('\n') + 1;
    ear.read += complete;
    for (const line of fresh.slice(0, complete).split('\n').filter(Boolean)) yield* took(yield* decodeHeard(line));
    if (ear.open !== null && !(ear.holding && !ear.released)) {
      const queued = yield* rig.inbox().pending(fake.cli.threadId);
      const unread = (yield* fake.cli.facet())?.unread ?? [];
      if (queued.length === 0 && unread.length === 0) yield* answered();
    }
    ear.caught = ear.read === text.length && ear.open === null;
  });
  yield* Effect.forkScoped(
    Effect.forever(Effect.andThen(tick, Queue.take(moved))).pipe(
      Effect.tapCause((cause) =>
        Effect.sync(() => {
          ear.broke = Cause.pretty(cause);
        }),
      ),
    ),
  );
  return {
    began: () => ear.open !== null,
    release: () =>
      Effect.sync(() => {
        ear.released = true;
        Queue.offerUnsafe(moved, undefined);
      }),
    quiet: () =>
      Effect.suspend(() =>
        ear.broke === null
          ? Effect.succeed(ear.released && ear.caught)
          : Effect.die(new Error(`the fake CLI stopped listening: ${ear.broke}`)),
      ),
    heard: () => heard.join('\n'),
  };
});

const shelved = Effect.fnUntraced(function* (threadId: string, archived: boolean) {
  const { world, projectId } = yield* World;
  const answer = yield* world.op('archive_thread', { threadId, archived }, `project=${projectId}`);
  if (answer.status !== 200)
    return yield* Effect.die(new Error(`archive_thread answered ${answer.status}: ${JSON.stringify(answer.body)}`));
});

const listen = Effect.fnUntraced(function* (state: WordState): Effect.fn.Return<WordCase | Unreachable, unknown, Env | Scope.Scope> {
  const { rig, flow } = yield* World;
  const files = yield* FileSystem.FileSystem;
  const fake = yield* raised(`words-${state}`);
  const ear = yield* listened(fake);
  const threadId = fake.cli.threadId;
  const handle = flow.harness().threads.handle(threadId, OPERATOR_PRINCIPAL);
  const context = yield* Effect.context<Env>();
  const run = <A, E>(effect: Effect.Effect<A, E, Env>) => Effect.provide(effect, context);
  const wordCase = (during: WordCase['during'], woken: Effect.Effect<unknown, unknown, Env> = Effect.void): WordCase => ({
    send: (text) => handle.send(text),
    during,
    settle: () =>
      run(
        Effect.gen(function* () {
          yield* woken;
          yield* ear.release();
          yield* until(
            Effect.gen(function* () {
              const facet = yield* fake.cli.store.read(threadId);
              const queued = yield* rig.inbox().pending(threadId);
              const unread = facet?.unread ?? [];
              return (yield* ear.quiet()) &&
                facet?.interrupted === undefined &&
                queued.length === 0 &&
                unread.length === 0 &&
                (yield* runningOf(threadId)) === null
                ? true
                : null;
            }),
            'came to rest with every word taken',
          );
        }),
      ),
    heard: () => Effect.sync(() => ear.heard()),
  });
  switch (state) {
    case 'starting':
      return wordCase((press) => press);
    case 'reopening': {
      yield* files.writeFileString(`${fake.keys}.exit`, '');
      yield* until(
        Effect.map(fake.cli.facet(), (facet) => (harnessSessionActive(facet?.session) ? null : true)),
        'saw the CLI process end',
      );
      yield* files.remove(`${fake.keys}.exit`);
      return wordCase((press) => press);
    }
  }
  yield* flow.sayTo(fake.cli, 'second words');
  yield* until(
    Effect.sync(() => (ear.began() ? true : null)),
    'began the turn its words opened',
  );
  switch (state) {
    case 'running':
      return wordCase((press) => press);
    case 'ending':
      return wordCase((press) => Effect.asVoid(Effect.all([ear.release(), press], { concurrency: 'unbounded' })));
    case 'stopping':
      return wordCase((press) => Effect.asVoid(Effect.all([handle.stop(), press], { concurrency: 'unbounded' })));
    case 'archived':
      return wordCase(
        (press) => run(Effect.andThen(shelved(threadId, true), press)),
        Effect.andThen(shelved(threadId, false), handle.send('CHARLIE wakes the thread')),
      );
  }
});

const terminalWords: WordRig<Env> = { reach: listen };

describe('the terminal transport keeps the shared Esc contract', () => {
  layer(Layer.effect(World, setup).pipe(Layer.provideMerge(BunFileSystem.layer)), {
    excludeTestServices: true,
  })('PTY world', (it) => {
    describeTransportStops('terminal', () => Effect.succeed(terminalStops), it.effect, ['thinking']);
    describeTransportWords('terminal', () => Effect.succeed(terminalWords), it.effect, ['running']);
    it.effect('Restart agent on an idle CLI thread stands a new CLI at once, without words or a run', () =>
      Effect.gen(function* () {
        const { world, projectId } = yield* World;
        const fake = yield* raised('restart-seats');
        const before = (yield* fake.cli.facet())?.session?.id;
        const answer = yield* world.op('restart_thread', { threadId: fake.cli.threadId }, `project=${projectId}`);
        expect(answer.status).toBe(200);
        const session = (yield* fake.cli.facet())?.session;
        expect(harnessSessionActive(session)).toBe(true);
        expect(session?.id).not.toBe(before);
        expect(yield* runningOf(fake.cli.threadId)).toBeNull();
      }),
    );
    it.effect('Restart agent after a turn the CLI ended on its rate limit stands a new CLI that continues the turn in a new run', () =>
      Effect.gen(function* () {
        const { world, flow, projectId } = yield* World;
        const fake = yield* raised('restart-limited');
        const limited = yield* working(fake);
        yield* fake.hook('StopFailure', { prompt_id: fake.current(), error: 'rate_limit' });
        const failed = yield* until(
          Effect.map(
            flow.db().get<{
              readonly family: string | null;
            }>(sql`select json_extract(failure, '$.reason.family') as family from thread_run where id = ${limited} and status = 'failed'`),
            (row) => row ?? null,
          ),
          'ended the turn on the rate limit',
        );
        expect(failed.family).toBe('rate-limit');
        const boots = Effect.map(textOf(`${fake.keys}.events`), (text) =>
          text
            .split('\n')
            .filter((line) => line !== '')
            .map((line) => JSON.parse(line) as { readonly kind: string; readonly prompt?: string | null })
            .filter((event) => event.kind === 'boot'),
        );
        const booted = (yield* boots).length;
        const answer = yield* world.op('restart_thread', { threadId: fake.cli.threadId }, `project=${projectId}`);
        expect(answer.status).toBe(200);
        const continuing = (answer.body as { readonly runId: string | null }).runId!;
        const continued = yield* until(
          Effect.map(boots, (all) => all[booted]?.prompt ?? null),
          'stood the new CLI with the words that continue the turn',
        );
        const who = whoSpeaks(
          yield* until(
            Effect.map(fake.cli.facet(), (facet) => (harnessSessionActive(facet?.session) && facet.execution !== null ? facet : null)),
            'stood the new CLI',
          ),
        );
        yield* fake.cli.hook(
          'UserPromptSubmit',
          { session_id: who.root, prompt_id: 'p-continued' },
          { session: who.session, prompt: continued },
        );
        yield* fake.cli.hook(
          'Stop',
          { session_id: who.root, prompt_id: 'p-continued' },
          { session: who.session, said: { last_assistant_message: 'Carried on.' } },
        );
        expect((yield* until(flow.ended(continuing), 'ended the continuing run')).status).toBe('completed');
        const runs = yield* flow.runsOf(fake.cli.threadId);
        expect(runs.at(-1)?.id).toBe(continuing);
      }),
    );
    it.effect(
      'Restart agent on a thread whose CLI stands on the account before the default moved carries its session to the new account and resumes it',
      () =>
        Effect.gen(function* () {
          const { world, projectId } = yield* World;
          const files = yield* FileSystem.FileSystem;
          const fake = yield* raised('restart-carried');
          const standing = (yield* fake.cli.facet())!.session!.account!;
          const owners = world.runtime.owners;
          const directories = Context.get(owners, HarnessDirectories);
          const source = (yield* directories.of(standing.provider)).find((row) => row.key === standing.key)!.directory!;
          const transcript = join('projects', 'carried-project', `${fake.who.root}.jsonl`);
          yield* files.makeDirectory(join(source, 'projects', 'carried-project'), { recursive: true });
          yield* files.writeFileString(join(source, transcript), '{"type":"user","sessionId":"carried"}\n');
          const target = yield* world.directory('claude-carried');
          const chosen = AccountKey.make('carried-account');
          yield* keepAccountDefaults(world, standing.provider);
          yield* Effect.acquireRelease(
            directories.keep(standing.provider, {
              key: chosen,
              label: 'carried@example.com',
              machine: directories.machine,
              directory: target,
              addedAt: yield* Clock.currentTimeMillis,
              signed: true,
              pending: false,
            }),
            () => directories.remove(standing.provider, chosen).pipe(Effect.orDie),
          );
          yield* Context.get(owners, DefaultAccounts).saveDefaultAccount(standing.provider, chosen);
          const answer = yield* world.op('restart_thread', { threadId: fake.cli.threadId }, `project=${projectId}`);
          expect(answer.status).toBe(200);
          const session = yield* until(
            Effect.map(fake.cli.facet(), (facet) =>
              harnessSessionActive(facet?.session) && facet.session.account?.key === chosen && facet.execution !== null
                ? facet.session
                : null,
            ),
            'stood the CLI on the chosen account',
          );
          expect(yield* files.readFileString(join(target, transcript))).toBe('{"type":"user","sessionId":"carried"}\n');
          expect(session.argv).toEqual(expect.arrayContaining(['--resume', fake.who.root]));
          expect(session.seed).toBeUndefined();
        }),
    );
    it.effect('an answer to a CLI screen question the CLI has already left closes it unsent, and the next screen is its own question', () =>
      Effect.gen(function* () {
        const { world, flow, projectId } = yield* World;
        const files = yield* FileSystem.FileSystem;
        const fake = yield* launched('screens.js', 'screen-left');
        const threadId = fake.cli.threadId;
        const asking = (prompt: string) =>
          Effect.map(
            flow.harness().runs.questions().open(threadId),
            (open) => open.find((entry) => entry.questions[0]?.prompt.startsWith(prompt) === true) ?? null,
          );
        const trust = yield* until(asking('Accessing workspace:'), 'raised the trust screen as a question', threadId);
        yield* files.writeFileString(`${fake.keys}.trusted`, '');
        yield* screensOf(fake.cli).pipe(
          Stream.mapEffect(() => screenOf(fake.cli)),
          Stream.filter(
            (update) => update?._tag === 'ScreenTextFrame' && screenLines(update).some((line) => line.includes('Bypass Permissions')),
          ),
          Stream.take(1),
          Stream.runDrain,
        );
        const window = yield* windowChannel(world);
        const answered = yield* Effect.flip(
          window['thread.answer']({
            projectId,
            threadId,
            params: { questionId: trust.questionId, answers: [{ questionId: trust.questionId, values: ['Yes, I trust this folder'] }] },
          }),
        );
        expect(answered).toMatchObject({ code: 'interaction-conflict' });
        expect(yield* asking('Accessing workspace:')).toBeNull();
        expect(yield* textOf(fake.report)).toBe('');
        yield* until(
          asking('WARNING: Claude Code running in Bypass Permissions mode'),
          'raised the next screen as its own question',
          threadId,
        );
      }),
    );
  });
});

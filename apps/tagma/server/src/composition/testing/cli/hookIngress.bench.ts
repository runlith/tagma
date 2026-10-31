import { join } from 'node:path';
import { Clock, Context, Effect, FileSystem } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { sql } from 'drizzle-orm';
import { bornThread } from '../../../native-harness/testing/born.js';
import { sessionFor } from '../../../external-harnesses/testing/sessions.js';
import { GRANT_HEADER, GRANT_VARIABLE, SESSION_TOKEN_VARIABLE } from '../../../platform/contract/service/credentials.js';
import { grantFor, sessionTokenEnvironment } from '../../../platform/testing/grants.js';
import { unmeasuredObservation } from '../../../threads/contract/wire/harness/observation.js';
import { harnessArgv, harnessPresentation } from '../../../external-harnesses/contract/service/table.js';
import { SHIPPED_HARNESSES, sessionIdentity } from '../../../external-harnesses/testing/builtin.js';
import { builtinHarness } from '../../../external-harnesses/testing/builtin.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import type { ExternalSession } from '../../../threads/contract/wire/harness/externalSession.js';
import { AdapterInstalls } from '../../../providers/contract/service/adapters.js';
import { makeTerminalWorld } from '../fixture.js';
import { QUILL, quillPackage } from '../external-harnesses/quill.js';

const figure = (name: string, fallback: number): number => {
  const given = Bun.argv.find((argument) => argument.startsWith(`--${name}=`));
  if (given === undefined) return fallback;
  const read = Number.parseInt(given.slice(name.length + 3), 10);
  if (!Number.isSafeInteger(read) || read < 0) throw new Error(`--${name} must be a non-negative integer`);
  return read;
};
const posts = figure('posts', 24);
const spawns = figure('spawns', 6);
const unanswered = figure('unanswered', 1);
const launched = figure('launched', 6);
const baselineEntry = Bun.argv.find((argument) => argument.startsWith('--baseline-entry='))?.slice('--baseline-entry='.length);
const UNANSWERED_CUT_MS = 20_000;
const SESSION = '01a09400-0000-7000-8000-0000000000f1';
const ROOT = 'cursor-root';
const toolEvent = {
  hook_event_name: 'postToolUse',
  session_id: ROOT,
  model: 'default',
  tool_name: 'Read',
  tool_use_id: 'call-cursor-0\nfc_cursor_0',
  tool_input: { file_path: '/project/note.txt' },
};

type Reading = { readonly road: string; readonly posts: number; readonly meanMs: number; readonly p50: number; readonly p95: number };
const reading = (road: string, samples: readonly number[]): Reading => {
  const ordered = [...samples].sort((left, right) => left - right);
  const at = (share: number): number => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * share))] ?? 0;
  return {
    road,
    posts: samples.length,
    meanMs: samples.reduce((sum, sample) => sum + sample, 0) / (samples.length || 1),
    p50: at(0.5),
    p95: at(0.95),
  };
};
const bare = (): Record<string, string | undefined> => {
  const env: Record<string, string | undefined> = { [GRANT_VARIABLE]: undefined, [SESSION_TOKEN_VARIABLE]: undefined };
  for (const { variable } of SHIPPED_HARNESSES) if (variable !== undefined) env[variable] = undefined;
  return env;
};
const elapsed = (started: bigint) => Effect.map(Clock.monotonicTimeNanos, (ended) => Number(ended - started) / 1_000_000);
const READING = 'hook-ingress-reading';

const program = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const world = yield* makeTerminalWorld({ own: 'a measuring program closes its world so its process ends' });
  const project = yield* world.checkout();
  const store = Context.get(world.runtime.graph, MachineStore);
  const threadId = '01a09400-0000-7000-8000-0000000000f2';
  const facet: ExternalSession = {
    name: 'cursor',
    presentation: harnessPresentation(builtinHarness('cursor')),
    sessionKey: ROOT,
    execution: null,
    observation: unmeasuredObservation(),
    session: {
      id: SESSION,
      origin: 'launched',
      state: 'running',
      prompt: '',
      cwd: null,
      argv: yield* harnessArgv(builtinHarness('cursor'), ROOT, SESSION, ''),
      ownerId: null,
      startedAt: '2026-09-13T10:00:00.000Z',
      heartbeatAt: '2026-09-13T10:00:00.000Z',
    },
  };
  yield* bornThread(
    store.db,
    {
      id: threadId,
      ownerId: 'operator',
      agentId: 'harness',
      provider: 'openai-oauth',
      model: 'gpt-test',
      reasoning: 'high',
      authority: { mode: 'trust', bypassFrom: null },
      status: 'idle',
      createdAt: new Date(0),
      updatedAt: new Date(0),
      spawnRootId: threadId,
      cacheGroup: threadId,
      name: threadId,
    },
    { projectId: project.id, title: threadId },
  );
  yield* store.db.run(sql`insert into thread_log (thread_id) values (${threadId})`);
  yield* sessionFor(store.db, threadId, facet);

  const doorSamples: number[] = [];
  for (let index = 0; index < posts; index += 1) {
    const body = JSON.stringify({
      session: SESSION,
      sessionKey: ROOT,
      occasion: 'activity',
      capturedAt: new Date(Date.UTC(2026, 8, 13, 11, 0, index)).toISOString(),
      receipt: `harness-report:door-${index}`,
      event: {
        hook_event_name: 'postToolUse',
        session_id: ROOT,
        generation_id: `door-turn-${index}`,
        model: String(toolEvent.model),
        tool_name: String(toolEvent.tool_name),
      },
    });
    const started = yield* Clock.monotonicTimeNanos;
    const answered = yield* Effect.tryPromise((signal) =>
      fetch(`${world.url}/api/op/report_harness_event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [GRANT_HEADER]: grantFor(threadId) },
        body,
        signal,
      }),
    );
    yield* Effect.tryPromise(() => answered.json());
    doorSamples.push(yield* elapsed(started));
  }
  const granted = { ...bare(), ...sessionTokenEnvironment(threadId, SESSION, sessionIdentity) };
  const observeSamples: number[] = [];
  for (let index = 0; index < spawns; index += 1) {
    const started = yield* Clock.monotonicTimeNanos;
    yield* world.tagma(['hook', 'observe'], {
      cwd: project.root,
      stdin: JSON.stringify({ ...toolEvent, generation_id: `observe-turn-${index}` }),
      env: granted,
    });
    observeSamples.push(yield* elapsed(started));
  }
  const launchedSamples: number[] = [];
  const baselineSamples: number[] = [];
  const packagedSamples: number[] = [];
  const installedSamples: number[] = [];
  const temporary = yield* world.directory('tmp');
  const dataHome = yield* world.directory('home');
  const quill = yield* quillPackage(yield* world.directory('quill'));
  yield* Effect.orDie(Context.get(world.runtime.owners, AdapterInstalls).install(quill.directory));
  const processEnv = {
    ...process.env,
    TAGMA_SERVER_URL: world.url,
    TAGMA_DATABASE_PATH: join(dataHome, 'tagma.sqlite'),
    TMPDIR: temporary,
    TMP: temporary,
    TEMP: temporary,
    ...granted,
  };
  const cli = join(import.meta.dir, '../../developer/cli.ts');
  const entries = [
    { path: cli, harness: 'cursor', samples: launchedSamples },
    { path: cli, harness: 'claude-code', samples: packagedSamples },
    { path: cli, harness: QUILL.harness, samples: installedSamples },
  ];
  if (baselineEntry !== undefined) entries.push({ path: baselineEntry, harness: 'cursor', samples: baselineSamples });
  for (let index = 0; index < launched; index += 1) {
    const ordered = index % 2 === 0 ? entries : [...entries].reverse();
    for (const [lane, entry] of ordered.entries()) {
      const started = yield* Clock.monotonicTimeNanos;
      const ran = yield* spawnedEffect([process.execPath, '--no-install', entry.path, 'hook', 'observe', '--harness', entry.harness], {
        cwd: project.root,
        stdin: new Blob([JSON.stringify({ ...toolEvent, generation_id: `launched-turn-${index}-${lane}` })]),
        env: processEnv,
      });
      entry.samples.push(yield* elapsed(started));
      if (ran.exitCode !== 0) return yield* Effect.die(new Error(`the launched hook exited ${ran.exitCode}: ${ran.stderr.toString()}`));
    }
  }
  const written = join(project.root, 'note.txt');
  const writeSamples: number[] = [];
  for (let index = 0; index < spawns; index += 1) {
    yield* files.writeFileString(written, `the note says ok\nrun ${index}\n`);
    const event = {
      session_id: ROOT,
      generation_id: `write-turn-${index}`,
      tool_name: 'Write',
      tool_use_id: `call-cursor-${index}\nfc_cursor_${index}`,
      tool_input: { file_path: written, content: `the note says ok\nrun ${index}\ncursor-edit-ok\n` },
    };
    yield* world.tagma(['hook', 'pre-tool-use'], {
      cwd: project.root,
      stdin: JSON.stringify({ ...event, hook_event_name: 'preToolUse' }),
      env: granted,
    });
    yield* files.writeFileString(written, `the note says ok\nrun ${index}\ncursor-edit-ok\n`);
    const started = yield* Clock.monotonicTimeNanos;
    yield* world.tagma(['hook', 'post-tool-use'], {
      cwd: project.root,
      stdin: JSON.stringify({ ...event, hook_event_name: 'postToolUse' }),
      env: granted,
    });
    writeSamples.push(yield* elapsed(started));
  }
  const measured = yield* Effect.acquireUseRelease(
    Effect.sync(() => Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {}, open() {} } })),
    (deaf) =>
      Effect.gen(function* () {
        const samples: number[] = [];
        let cutByInstrument = 0;
        for (let index = 0; index < unanswered; index += 1) {
          const started = yield* Clock.monotonicTimeNanos;
          const held = world.tagma(['hook', 'observe'], {
            cwd: project.root,
            server: `http://127.0.0.1:${deaf.port}`,
            stdin: JSON.stringify({ ...toolEvent, generation_id: `deaf-turn-${index}` }),
            env: granted,
          });
          const raced = yield* Effect.raceFirst(
            Effect.as(held, 'answered' as const),
            Effect.as(Effect.sleep(UNANSWERED_CUT_MS), 'cut' as const),
          );
          samples.push(yield* elapsed(started));
          if (raced === 'cut') cutByInstrument += 1;
        }
        return { samples, cutByInstrument };
      }),
    (deaf) => Effect.sync(() => deaf.stop(true)),
  );
  return {
    fixture: { harness: 'cursor', source: 'hand-authored' },
    door: reading('door', doorSamples),
    process: reading('observe', observeSamples),
    launched: reading('observe in a launched process', launchedSamples),
    packaged: reading('observe in a launched process naming a builtin package harness', packagedSamples),
    installed: reading('observe in a launched process naming a machine-installed package harness', installedSamples),
    baseline:
      baselineEntry === undefined
        ? null
        : { entry: baselineEntry, ...reading('observe in a baseline process on the same server', baselineSamples) },
    write: reading('post-tool-use over one named file', writeSamples),
    unanswered: {
      ...reading('observe against an endpoint that answers nothing', measured.samples),
      cutByInstrument: measured.cutByInstrument,
      cutAtMs: UNANSWERED_CUT_MS,
      bound:
        measured.cutByInstrument > 0
          ? 'lower bound: the product applied no deadline and this runner cut its own wait'
          : 'the process ended on its own',
    },
  };
}).pipe(Effect.provide(BunFileSystem.layer), Effect.scoped);

BunRuntime.runMain(Effect.tap(program, (taken) => Effect.sync(() => console.log(`${READING} ${JSON.stringify(taken)}`))));

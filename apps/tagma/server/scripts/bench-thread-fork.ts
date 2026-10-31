import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, Exit, Layer, Scope, Tracer } from 'effect';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { childHosting } from '@runlith/sqlite-process/children';
import { Message } from '@runlith/llm/schema/messages';
import { threadEntryEvent, threadStepMessagesEvent } from '@runlith/agent/thread/events';
import type { ThreadEventInput } from '@runlith/agent/thread/events';
import { runEndEntryId, toolEntryId, userMessageEntryId } from '@runlith/agent/transcript/entryNames';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import { makeRuntime } from '../src/composition/runtime.js';
import { COMPOSED } from '../src/composition/testing/composed.js';
import { ProjectLifecycle } from '../src/graph/contract/service/serving.js';
import { MachineStore } from '../src/platform/contract/service/store.js';
import { MachineUnits } from '../src/platform/contract/service/units.js';
import { OPERATOR_PRINCIPAL } from '../src/platform/contract/wire/actor.js';
import { testGrantSigner } from '../src/platform/testing/grants.js';
import { rootFixture, tempRepoEffect } from '../src/composition/testing/graphFixture.js';
import { ThreadHarness } from '../src/threads/contract/service/engine.js';
import { ThreadRollouts } from '../src/threads/contract/service/rollouts.js';
import { birthsOf, rewindsOf, sqliteThreadJournal } from '../src/threads/testing/doubles.js';
import { NativeStorage } from '../src/threads/contract/service/engine.js';
import { ToolOutputs } from '../src/native-harness/contract/service/toolOutputs.js';
import { AttachmentFiles } from '../src/threads/resources/attachments.js';
import { TranscriptFold } from '@runlith/agent/transcript/TranscriptFold';
import { threadEventFact } from '@runlith/agent/thread/ThreadEventDoor';
import { readThreadEvents } from '@runlith/agent/thread/events';
import { CORE_KINDS } from '../src/native-harness/testing/doubles.js';

const argument = (name: string, fallback: number): number => {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  const value = raw === undefined ? fallback : Number(raw.slice(name.length + 3));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
};

const turns = argument('turns', 870);
const told = argument('told', 85);
const rounds = argument('rounds', 2);
const perAppend = argument('batch', 25);
const kept = argument('files', 1) - 1;
const resting = process.argv.includes('--rest');

const words = (seed: number, bytes: number): string => {
  const line = `turn ${seed} carries ordinary conversation about the code, the plan and what was read. `;
  return line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes);
};

const turnOf = (turn: number): readonly ThreadEventInput[] => {
  const runId = `run-${turn}`;
  const at = new Date(Date.UTC(2026, 9, 1) + turn * 60_000).toISOString();
  const said = (role: 'user' | 'assistant', bytes: number) => words(turn * 2 + (role === 'user' ? 0 : 1), bytes);
  const entries: ThreadTranscriptEntry[] = [
    {
      type: 'message',
      id: userMessageEntryId(runId),
      runId,
      role: 'user',
      text: said('user', 1_000),
      occurredAt: at,
    },
    { type: 'context', id: `context:${runId}`, runId, text: words(turn, 1_400), occurredAt: at },
    {
      type: 'composition',
      id: `composition:${runId}`,
      runId,
      occurredAt: at,
      system: { chars: 40_000 },
      context: { chars: 9_000 },
      tools: {
        count: 260,
        chars: 120_000,
        each: Array.from({ length: 260 }, (_, at) => ({ name: `tool_number_${at}`, chars: 400 + at })),
      },
    },
    ...[0, 1].map((step) => ({
      type: 'reasoning' as const,
      id: `reasoning:${runId}:${step}`,
      runId,
      text: words(turn + step, 750),
      state: 'done' as const,
      occurredAt: at,
    })),
    ...[0, 1, 2].map((call) => ({
      type: 'tool' as const,
      id: toolEntryId(`call-${turn}-${call}`),
      runId,
      toolName: 'read',
      toolCallId: `call-${turn}-${call}`,
      toolState: 'output-available' as const,
      toolInput: { path: `src/file-${turn}-${call}.ts` },
      toolOutput: { text: words(turn * 3 + call, 5_600) },
      occurredAt: at,
    })),
    { type: 'message', id: `message:assistant:${runId}`, runId, role: 'assistant', text: said('assistant', 1_000), occurredAt: at },
    {
      type: 'run-end',
      id: runEndEntryId(runId),
      runId,
      status: 'completed',
      startedAt: at,
      finishedAt: at,
      occurredAt: at,
      usage: { inputTokens: 120_000, outputTokens: 900, cacheReadInputTokens: 110_000, cacheWriteInputTokens: 0 },
    },
  ];
  const events: ThreadEventInput[] = entries.map(threadEntryEvent);
  if (turn >= turns - told) {
    const messages = threadStepMessagesEvent([
      Message.make({ role: 'user', content: said('user', 6_000) }),
      Message.make({ role: 'assistant', content: said('assistant', 6_000) }),
    ]);
    if (messages !== null) events.push(messages);
  }
  return events;
};

type Spent = { count: number; ms: number };

const home = mkdtempSync(join(tmpdir(), 'tagma-fork-bench-'));
const roots = rootFixture();
mkdirSync(join(home, 'home'));
const scope = await Effect.runPromise(Scope.make());
let exit = Exit.void;
try {
  await Effect.runPromise(
    Scope.addFinalizer(
      scope,
      Effect.sync(() => rmSync(home, { recursive: true, force: true })),
    ),
  );
  await Effect.runPromise(Scope.addFinalizer(scope, Effect.orDie(roots.releaseEffect)));
  const runtime = await Effect.runPromise(
    Scope.provide(
      makeRuntime(
        {
          ...COMPOSED,
          grants: testGrantSigner,
          databasePath: join(home, 'home', 'tagma.sqlite'),
          tokensPath: join(home, 'home', 'tokens.json'),
          attachmentsPath: join(home, 'home', 'attachments'),
          sourcePath: join(home, 'home', 'tagma'),
          quotaProviders: [],
        },
        Layer.empty,
        new ProcessPool(undefined, 'stop', undefined, childHosting),
      ),
      scope,
    ),
  );
  const run = <A, E>(work: Effect.Effect<A, E>) => runtime.runtime.runPromise(work);
  const db = Context.get(runtime.graph, MachineStore).db;
  const units = Context.get(runtime.graph, MachineUnits);

  const census = (threadId: string) =>
    run(
      units.read((unit) =>
        unit.run(
          db.all<{ readonly what: string; readonly rows: number; readonly bytes: number | null }>(sql`
          select 'thread_event' as what, count(*) as rows, sum(length(payload)) as bytes from thread_event where thread_id = ${threadId}
          union all select 'thread_entry', count(*), sum(length(entry)) from thread_entry where thread_id = ${threadId}
          union all select 'thread_history_item', count(*), sum(length(message)) from thread_history_item where thread_id = ${threadId}
          union all select 'thread_message', count(*), sum(length(text)) from thread_message where thread_id = ${threadId}
          union all select 'thread_base', count(*), sum(length(hidden)) from thread_base where thread_id = ${threadId}`),
        ),
      ),
    );

  const settled = async (threadId: string, path: string | undefined): Promise<boolean> => {
    const [mark] = await run(
      units.read((unit) =>
        unit.run(
          db.all<{ readonly caught: number }>(
            sql`select through >= seen and not unreadable as caught from thread_conversation where thread_id = ${threadId}`,
          ),
        ),
      ),
    );
    if (mark?.caught !== 1) return false;
    return path === undefined || (existsSync(path) && !existsSync(`${path}.partial`));
  };

  const project = await run(
    Context.get(runtime.graph, ProjectLifecycle)
      .create({
        name: 'fork-bench',
        rootPath: await Effect.runPromise(
          Effect.flatMap(roots.openEffect, (fixture) => tempRepoEffect(fixture, 'fork-bench-')).pipe(Effect.provide(BunFileSystem.layer)),
        ),
        storage: 'stealth',
      })
      .pipe(Effect.provide(runtime.graph)),
  );
  const source = (await run(birthsOf(runtime.owners).create({ projectId: project.id, createdBySessionId: null, title: 'fork bench' })))
    .thread.id;
  const handle = Context.get(runtime.owners, ThreadHarness).threads.handle(source, OPERATOR_PRINCIPAL);
  const seeded = performance.now();
  for (let from = 0; from < turns; from += perAppend) {
    const events = Array.from({ length: Math.min(perAppend, turns - from) }, (_, at) => turnOf(from + at)).flat();
    await run(handle.append(events));
  }
  const outputs = Context.get(runtime.owners, ToolOutputs).store;
  const pictures = Context.get(runtime.owners, AttachmentFiles);
  for (let at = 0; at < kept; at += 1) {
    await outputs.write(source, `retained output ${at} `.repeat(64));
    await run(pictures.keep(source, { mediaType: 'image/png', bytes: new Uint8Array([at % 256, 1, 2, 3]) }));
  }
  console.log(JSON.stringify({ turns, told, kept, seededMs: Math.round(performance.now() - seeded), source: await census(source) }));
  const threads = Context.get(runtime.owners, NativeStorage).threads;
  const opened = async (threadId: string) => {
    const started = performance.now();
    const page = await run(threads.transcriptWindow(threadId, { limit: 100, bytes: 512 * 1024 }));
    return { ms: Math.round(performance.now() - started), entries: page?.entries.length ?? 0 };
  };
  const folded = await (async () => {
    const started = performance.now();
    const journal = await run(sqliteThreadJournal().pipe(Effect.provide(runtime.graph)));
    const fold = new TranscriptFold();
    let after = 0;
    while (true) {
      const page = await run(readThreadEvents(journal, CORE_KINDS, source, after, 512));
      for (const record of page) fold.place(threadEventFact(record));
      if (page.length < 512) break;
      after = page[page.length - 1]!.position;
    }
    return { ms: Math.round(performance.now() - started), entries: fold.take().length };
  })();
  console.log(JSON.stringify({ sourceWindow: await opened(source), foldedFromEvents: folded }));
  const inner = await run(Effect.tracer);
  const children: string[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const spans: Tracer.Span[] = [];
    const counting = Tracer.make({
      span(options) {
        const span = inner.span(options);
        spans.push(span);
        return span;
      },
      context: inner.context,
    });
    const started = performance.now();
    const born = await run(rewindsOf(runtime.owners).branch(source, project.id, {}).pipe(Effect.withTracer(counting)));
    const elapsedMs = Math.round(performance.now() - started);
    const answered = spans.length;
    const path = Context.get(runtime.owners, ThreadRollouts).pathOf(project.id, born.threadId);
    while (!(await settled(born.threadId, path))) await new Promise((resolve) => setTimeout(resolve, 20));
    const settledMs = Math.round(performance.now() - started);
    const writer = (from: number, to: number) => {
      const held = spans
        .slice(from, to)
        .filter((span) => span.name === 'Store.execute' && span.status._tag === 'Ended')
        .map((span) => (span.status._tag === 'Ended' ? Number(span.status.endTime - span.status.startTime) / 1e6 : 0));
      return { units: held.length, maxMs: Math.round(Math.max(0, ...held)), totalMs: Math.round(held.reduce((sum, ms) => sum + ms, 0)) };
    };
    const spent = new Map<string, Spent>();
    for (const span of spans) {
      const held = spent.get(span.name) ?? { count: 0, ms: 0 };
      held.count += 1;
      if (span.status._tag === 'Ended') held.ms += Number(span.status.endTime - span.status.startTime) / 1e6;
      spent.set(span.name, held);
    }
    console.log(
      JSON.stringify({
        round,
        elapsedMs,
        settledMs,
        child: await census(born.threadId),
        childWindow: await opened(born.threadId),
        writer: { answer: writer(0, answered), behind: writer(answered, spans.length) },
        statements: spans.slice(0, answered).filter((span) => span.name === 'sql.execute').length,
        behindStatements: spans.slice(answered).filter((span) => span.name === 'sql.execute').length,
        spans: [...spent.entries()]
          .sort((left, right) => right[1].ms - left[1].ms)
          .slice(0, 14)
          .map(([name, { count, ms }]) => ({ name, count, ms: Math.round(ms) })),
        slowest: spans
          .filter((span) => span.name === 'sql.execute' && span.status._tag === 'Ended')
          .map((span) => ({
            ms: span.status._tag === 'Ended' ? Math.round(Number(span.status.endTime - span.status.startTime) / 1e6) : 0,
            summary: String(span.attributes.get('db.query.summary') ?? span.attributes.get('db.query.text') ?? ''),
          }))
          .sort((left, right) => right.ms - left.ms)
          .slice(0, 6),
        rolloutBytes: path === undefined ? null : (statSync(path, { throwIfNoEntry: false })?.size ?? null),
      }),
    );
    children.push(born.threadId);
  }
  if (resting) {
    const rollouts = Context.get(runtime.owners, ThreadRollouts);
    const folder = dirname(rollouts.pathOf(project.id, source) ?? '');
    const disk = () => readdirSync(folder).reduce((sum, file) => sum + statSync(join(folder, file)).size, 0);
    const before = disk();
    const spans: Tracer.Span[] = [];
    const counting = Tracer.make({
      span(options) {
        const span = inner.span(options);
        spans.push(span);
        return span;
      },
      context: inner.context,
    });
    const started = performance.now();
    const verdict = await run(rollouts.evict(project.id, source).pipe(Effect.withTracer(counting)));
    const elapsedMs = Math.round(performance.now() - started);
    const held = spans
      .filter((span) => span.name === 'Store.execute' && span.status._tag === 'Ended')
      .map((span) => (span.status._tag === 'Ended' ? Number(span.status.endTime - span.status.startTime) / 1e6 : 0));
    console.log(
      JSON.stringify({
        sourceRest: verdict,
        elapsedMs,
        writer: { units: held.length, maxMs: Math.round(Math.max(0, ...held)), totalMs: Math.round(held.reduce((sum, ms) => sum + ms, 0)) },
        source: await census(source),
        children: await Promise.all(children.map((child) => census(child))),
        longest: spans
          .filter((span) => span.name === 'Store.execute' && span.status._tag === 'Ended')
          .map((span) => ({
            ms: span.status._tag === 'Ended' ? Math.round(Number(span.status.endTime - span.status.startTime) / 1e6) : 0,
            attributes: Object.fromEntries(span.attributes),
          }))
          .sort((left, right) => right.ms - left.ms)
          .slice(0, 4),
        diskBefore: before,
        diskAfter: disk(),
        files: readdirSync(folder).map((file) => ({ file, bytes: statSync(join(folder, file)).size })),
      }),
    );
  }
} catch (cause) {
  exit = Exit.die(cause);
  console.error(cause);
  throw cause;
} finally {
  await Effect.runPromise(Scope.close(scope, exit));
}

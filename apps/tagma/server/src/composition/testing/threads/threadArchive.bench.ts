import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { Clock, Context, Effect, FileSystem, Layer } from 'effect';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { childHosting } from '@runlith/sqlite-process/children';
import { PerformanceReports } from '@runlith/performance/PerformanceReports';
import { PerformanceStore } from '@runlith/performance/PerformanceStore';
import type { TraceCursor } from '@runlith/performance/protocol/queries';
import type { StoredSpanRecord } from '@runlith/performance/protocol/records';
import { makeRuntime } from '../../runtime.js';
import { ProjectLifecycle } from '../../../graph/contract/service/serving.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { testGrantSigner } from '../../../platform/testing/grants.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { performanceKeepOneTraceIn } from '../../../performance/contract/wire/settings.js';
import { rootFixture, tempRepoEffect } from '../graphFixture.js';
import { birthsOf, listOf, turnsOf } from '../../../threads/testing/doubles.js';
import { makeThreadRecords } from '../../../thread-record/layer.js';
import { threadStack } from '../threadParts.js';
import { ENTRY_KINDS } from '../../manifest.js';
import { OPERATOR_PRINCIPAL } from '../../../platform/contract/wire/actor.js';
import { ThreadRollouts } from '../../../threads/contract/service/rollouts.js';

const argument = (name: string, fallback: number): number => {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  const value = raw === undefined ? fallback : Number(raw.slice(name.length + 3));
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be positive`);
  return value;
};
const history = argument('history', 300_000);
const members = argument('members', 26);
const rounds = argument('rounds', 3);

const main = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const home = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-archive-bench-' });
  const roots = rootFixture();
  const fixture = yield* Effect.acquireRelease(roots.openEffect, () => roots.releaseEffect.pipe(Effect.orDie));
  const rootPath = yield* tempRepoEffect(fixture, 'archive-bench-');
  yield* files.makeDirectory(join(home, 'home'));
  const runtime = yield* makeRuntime(
    {
      grants: testGrantSigner,
      databasePath: join(home, 'home', 'tagma.sqlite'),
      tokensPath: join(home, 'home', 'tokens.json'),
      attachmentsPath: join(home, 'home', 'attachments'),
      sourcePath: join(home, 'home', 'tagma'),
      quotaProviders: [],
      spanFloorMicros: () => 0,
    },
    Layer.empty,
    new ProcessPool(undefined, 'stop', undefined, childHosting),
  );
  yield* Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const settings = yield* Settings;
    yield* settings.write({ scope: 'user', key: performanceKeepOneTraceIn.id, value: 1 });
    const project = yield* Context.get(runtime.graph, ProjectLifecycle).create({ name: 'archive-bench', rootPath, storage: 'stealth' });
    const db = Context.get(runtime.graph, MachineStore).db;
    const units = Context.get(runtime.graph, MachineUnits);
    const records = yield* makeThreadRecords;
    const { store, threads: parts } = yield* threadStack({ db, units, records, kinds: ENTRY_KINDS });
    const root = (yield* birthsOf(runtime.owners).create({ projectId: project.id, createdBySessionId: null, title: 'archive bench' }))
      .thread.id;
    const ids = [root];
    for (let index = 1; index < members; index += 1) {
      ids.push(
        yield* units.write('archive.bench.birth', (unit) =>
          Effect.gen(function* () {
            const child = yield* store.insertChild(root, { ownerId: OPERATOR_PRINCIPAL, agentId: 'tagma' }, unit);
            yield* parts.rows.inheritFacet({ threadId: child.id, fromThreadId: root, agentId: 'tagma' }, unit);
            return child.id;
          }),
        ),
      );
    }
    const rollouts = Context.get(runtime.owners, ThreadRollouts);
    for (const id of ids) yield* rollouts.ensure(id);
    yield* units.write('archive.bench.history', (unit) =>
      unit.run(
        db.run(sql`
      with recursive rows(n) as (select 1 union all select n + 1 from rows where n < ${history})
      insert into command(execution_id, incarnation, project_id, owner, owner_thread, created_by, policy_identity, target_key, admitted_at, command_line)
      select 'ended-' || n, 0, ${project.id}, 'thread:' || json_extract(${JSON.stringify(ids)}, '$[' || (n % ${members}) || ']'),
        json_extract(${JSON.stringify(ids)}, '$[' || (n % ${members}) || ']'), 'operator', 'bench', 'bench', n, ${'x'.repeat(500)} from rows
    `),
      ),
    );
    const reports = Context.get(runtime.measurement, PerformanceReports);
    const performance = yield* PerformanceStore;
    console.log(JSON.stringify({ history, members, rounds, database: home }));
    for (let round = 0; round < rounds; round += 1) {
      const since = yield* Clock.currentTimeMillis;
      const started = clock.monotonicTimeNanosUnsafe();
      yield* turnsOf(runtime.owners).archive(root, project.id, { kind: 'operator' }).pipe(Effect.withSpan('archive_thread'));
      const elapsedMs = Number(clock.monotonicTimeNanosUnsafe() - started) / 1_000_000;
      console.log(JSON.stringify({ completed: round, elapsedMs }));
      yield* performance.flush;
      const slow = yield* reports.read({ type: 'slow', name: 'archive_thread', since, limit: 1 });
      if (slow.type !== 'slow' || slow.spans[0] === undefined) return yield* Effect.die(new Error('archive trace was not retained'));
      const archive = slow.spans[0];
      const spans: StoredSpanRecord[] = [];
      let after: TraceCursor | undefined;
      do {
        const trace = yield* reports.read({ type: 'trace', traceId: archive.traceId, spanId: archive.id, limit: 200, after });
        if (trace.type !== 'trace') return yield* Effect.die(new Error('no trace'));
        spans.push(...trace.segments.flatMap((segment) => segment.spans));
        after = trace.next ?? undefined;
      } while (after !== undefined);
      console.log(
        JSON.stringify({
          round,
          since,
          elapsedMs,
          span: archive.id,
          sql: spans.filter((span) => span.name === 'sql.execute').length,
          owned: spans
            .filter((span) => span.name === 'CommandRows.commandsOwnedBy')
            .map((span) => ({ durationMs: (span.monotonicEnd ?? span.monotonicStart) - span.monotonicStart })),
          breakdown: yield* reports.read({ type: 'breakdown', id: archive.id, limit: 8 }),
        }),
      );
      yield* listOf(runtime.owners).setArchived(root, project.id, false);
    }
  }).pipe(Effect.provide(yield* runtime.runtime.contextEffect));
});

BunRuntime.runMain(main.pipe(Effect.provide(BunFileSystem.layer), Effect.scoped));

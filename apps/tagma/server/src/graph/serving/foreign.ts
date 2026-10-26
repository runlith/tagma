import { Effect, Result } from 'effect';
import type { Projects } from '../../projects/contract/service/registry.js';
import type { ProjectPolicy } from '../contract/service/serving.js';
import type { FarPointer, FarProject, FarState, FarStep, ForeignBlocks } from '../contract/service/foreign.js';
import { type FarTarget, farKey } from '../contract/wire/far.js';
import { resolveStorageLayout, storageHomes } from '../storage/layout.js';
import { refused } from './refusal.js';
import type { CopyRead, IndexedCopyAsk, IndexQuestion, OutgoingRow, PointerRow, TargetRow, WorkRow, copyIndex } from './copyIndex.js';

type FarQuestion = Exclude<IndexQuestion, { readonly ask: 'titles' }>;

type Canonical = { readonly project: FarProject; readonly ask: IndexedCopyAsk; readonly failure: string | null };

type Read<Row> = { readonly copy: Canonical; readonly reading: CopyRead<Row> };

type Holder = { readonly copy: Canonical; readonly phased: boolean; readonly rows: ReadonlyMap<string, TargetRow> };

const UNBUILT = 'its graph index is not built on this machine yet';

export const makeForeignBlocks = (deps: {
  readonly index: ReturnType<typeof copyIndex>;
  readonly projects: Projects['Service'];
  readonly policy: ProjectPolicy['Service'];
  readonly storePath: string;
  readonly warm: (projectIds: ReadonlySet<number>) => Effect.Effect<void>;
}): ForeignBlocks => {
  const { index, projects, policy, storePath, warm } = deps;

  const canonical = Effect.fn('GraphPool.foreign.copies')(function* () {
    const listed = yield* projects.list();
    const global = yield* projects.global();
    const all = global === undefined || listed.some((row) => row.id === global.id) ? listed : [...listed, global];
    const rows = yield* policy.read(all.map((row) => row.id));
    const copies: Canonical[] = [];
    for (const row of rows.values()) {
      const project = { id: row.id, name: row.name };
      const layout = yield* Effect.result(
        refused(resolveStorageLayout({ mode: row.storage, projectName: row.name, ...storageHomes(storePath), worktree: row.rootPath })),
      );
      copies.push(
        Result.isFailure(layout)
          ? { project, ask: { mirror: '', projectId: row.id }, failure: layout.failure.reason }
          : { project, ask: { mirror: layout.success.mirrorPath, projectId: row.id }, failure: null },
      );
    }
    return copies;
  });

  const ask = Effect.fnUntraced(function* <Row>(copies: readonly Canonical[], question: FarQuestion) {
    const readable = copies.filter((copy) => copy.failure === null);
    const readings = yield* Effect.result(
      index.far<Row>(
        readable.map((copy) => copy.ask),
        question,
      ),
    );
    const byCopy = new Map(readable.map((copy, at) => [copy, at] as const));
    return copies.map((copy): Read<Row> => {
      const at = byCopy.get(copy);
      if (copy.failure !== null || at === undefined) return { copy, reading: { kind: 'unreadable', reason: copy.failure ?? 'not asked' } };
      if (Result.isFailure(readings)) return { copy, reading: { kind: 'unreadable', reason: readings.failure.reason } };
      return { copy, reading: readings.success[at] ?? { kind: 'unindexed' } };
    });
  });

  const statesOf = (reads: readonly Read<TargetRow>[], targets: readonly FarTarget[]) => {
    const states = new Map<string, FarState>();
    const cold = new Set<number>();
    const failures: string[] = [];
    const byRoot = new Map<string, Holder[]>();
    for (const { copy, reading } of reads) {
      if (reading.kind === 'unindexed') {
        cold.add(copy.project.id);
        failures.push(`${copy.project.name}: ${UNBUILT}`);
      } else if (reading.kind === 'unreadable') failures.push(`${copy.project.name}: ${reading.reason}`);
      else if (reading.root !== null) {
        const holder = { copy, phased: reading.phased, rows: new Map(reading.rows.map((row) => [row.uuid, row] as const)) };
        const holders = byRoot.get(reading.root.uuid);
        if (holders === undefined) byRoot.set(reading.root.uuid, [holder]);
        else holders.push(holder);
      }
    }
    const missing: FarState =
      failures.length > 0
        ? { kind: 'absent', reason: 'unreadable', detail: failures.join('; ') }
        : { kind: 'absent', reason: 'project', detail: null };
    for (const target of targets) {
      const holders = byRoot.get(target.graph) ?? [];
      const holder = holders[0];
      if (holders.length > 1) states.set(farKey(target), { kind: 'ambiguous', projects: holders.map((one) => one.copy.project) });
      else if (holder === undefined) states.set(farKey(target), missing);
      else {
        const row = holder.rows.get(target.uuid);
        if (row === undefined) {
          states.set(farKey(target), { kind: 'absent', reason: 'block', detail: holder.copy.project.name });
          continue;
        }
        if (!holder.phased) cold.add(holder.copy.project.id);
        states.set(farKey(target), {
          kind: 'here',
          project: holder.copy.project,
          title: row.title,
          trashed: row.trashed,
          superseded: row.superseded,
          phase: holder.phased ? row.phase : null,
        });
      }
    }
    return { states, cold };
  };

  const warmed = (cold: ReadonlySet<number>) => (cold.size === 0 ? Effect.void : warm(cold));

  return {
    farStates: Effect.fn('GraphPool.foreign.states')(function* (targets, contract) {
      if (targets.length === 0) return new Map<string, FarState>();
      const question = { ask: 'targets' as const, targets: targets.map((one) => ({ graph: one.graph, uuid: one.uuid })), contract };
      const { states, cold } = statesOf(yield* ask<TargetRow>(yield* canonical(), question), targets);
      yield* warmed(cold);
      return states;
    }),

    farPointing: Effect.fn('GraphPool.foreign.pointing')(function* (input) {
      const question = { ask: 'pointing' as const, graph: input.graph, uuids: input.uuids, contract: input.contract };
      const reads = yield* ask<PointerRow>(
        (yield* canonical()).filter((copy) => copy.project.id !== input.excluding),
        question,
      );
      const pointers: FarPointer[] = [];
      const unread: FarProject[] = [];
      const cold = new Set<number>();
      for (const { copy, reading } of reads) {
        if (reading.kind === 'unindexed') cold.add(copy.project.id);
        if (reading.kind !== 'read') {
          unread.push(copy.project);
          continue;
        }
        if (!reading.phased && reading.rows.length > 0) {
          cold.add(copy.project.id);
          unread.push(copy.project);
        }
        for (const row of reading.rows) {
          pointers.push({ ...row, phase: reading.phased ? row.phase : null, graph: input.graph, project: copy.project });
        }
      }
      yield* warmed(cold);
      return { pointers, unread };
    }),

    graphRootOf: Effect.fn('GraphPool.foreign.rootOf')(function* (projectId) {
      const copy = (yield* canonical()).find((one) => one.project.id === projectId);
      if (copy === undefined) return { kind: 'none' } as const;
      const [read] = yield* ask<TargetRow>([copy], { ask: 'targets', targets: [], contract: '' });
      const reading = read?.reading ?? ({ kind: 'unindexed' } as const);
      if (reading.kind === 'read')
        return reading.root === null ? ({ kind: 'none' } as const) : ({ kind: 'root', uuid: reading.root.uuid } as const);
      if (reading.kind === 'unindexed') yield* warmed(new Set([projectId]));
      return { kind: 'unread', project: copy.project } as const;
    }),

    farWork: Effect.fn('GraphPool.foreign.work')(function* (input) {
      const stands = new Map<string, boolean | null>(input.uuids.map((uuid) => [uuid, null]));
      if (input.uuids.length === 0) return stands;
      const reads = yield* ask<WorkRow>(yield* canonical(), { ask: 'work', ...input });
      const cold = new Set<number>();
      for (const { copy, reading } of reads) {
        if (reading.kind === 'unindexed') cold.add(copy.project.id);
        if (reading.kind !== 'read') continue;
        if (!reading.phased) cold.add(copy.project.id);
        else for (const row of reading.rows) stands.set(row.uuid, row.open);
      }
      yield* warmed(cold);
      return stands;
    }),

    farOutgoing: Effect.fn('GraphPool.foreign.outgoing')(function* (graph, uuids, kind) {
      if (uuids.length === 0) return [];
      const reads = yield* ask<OutgoingRow>(yield* canonical(), { ask: 'outgoing', graph, uuids, kind });
      const steps: FarStep[] = [];
      const cold = new Set<number>();
      for (const { copy, reading } of reads) {
        if (reading.kind === 'unindexed') cold.add(copy.project.id);
        if (reading.kind === 'read') steps.push(...reading.rows);
      }
      yield* warmed(cold);
      return steps;
    }),
  };
};

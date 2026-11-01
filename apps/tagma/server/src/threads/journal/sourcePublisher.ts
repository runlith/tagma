import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { Context, Effect } from 'effect';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { recordFacts } from '../../thread-record/facts.js';
import { restedAtOf } from '../rest.js';
import { journalProjectOf, publishedSourceRows, threadPublishedSource, threadRolloutForm, threadSourceIntent } from '../store/journal.js';
import type { SourceReplacement } from './sourceReplacement.js';
import { ROLLOUT_SUFFIX } from './rolloutForms.js';
import { sourcePath, type SourcePublication } from './sourceFiles.js';
import type { PublishedSource } from '../contract/service/rested.js';
import type { JournalEntry } from './rolloutContext.js';
import type { RolloutForms } from './rolloutForming.js';
import type { SourceRetention } from './sourceRetention.js';

const publishing = writes('ThreadRollout.publishSource', [publishedSourceRows]);
type SourceUse = { active: boolean };
const SourceUses = Context.Reference<ReadonlyMap<string, SourceUse>>('tagma/threads/SourceUses', { defaultValue: () => new Map() });

export type SourcePublisher = Effect.Success<ReturnType<typeof makeSourcePublisher>>;

export const makeSourcePublisher = Effect.fnUntraced(function* (input: {
  readonly home: string | undefined;
  readonly journal: JournalEntry;
  readonly forms: RolloutForms;
  readonly publication: SourcePublication;
  readonly replacement: SourceReplacement;
  readonly retention: SourceRetention;
}) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;
  const byId = db
    .select({
      journal: journalProjectOf(recordFacts.id, recordFacts.projectId),
      rested: restedAtOf(recordFacts.id),
      source: threadPublishedSource,
      form: threadRolloutForm.step,
      publishing: threadRolloutForm.publishing,
      intent: threadSourceIntent.operation,
    })
    .from(recordFacts)
    .leftJoin(threadPublishedSource, eq(threadPublishedSource.threadId, recordFacts.id))
    .leftJoin(threadRolloutForm, eq(threadRolloutForm.threadId, recordFacts.id))
    .leftJoin(threadSourceIntent, eq(threadSourceIntent.threadId, recordFacts.id))
    .where(eq(recordFacts.id, sql.placeholder('threadId')))
    .prepare();
  const standing = (threadId: string) => units.read((unit) => unit.run(byId.get({ threadId })));
  const io = (cause: unknown) => new ThreadStorageFailed({ call: 'rollout.source', cause });
  type Standing = NonNullable<Effect.Success<ReturnType<typeof standing>>>;
  const current = (row: Standing) => row.source !== null && row.source.form === row.form && row.publishing === null && row.intent === null;
  const held = Effect.fnUntraced(function* (canonical: string, source: PublishedSource) {
    const file = sourcePath(canonical, source.generation);
    const size = yield* Effect.tryPromise({ try: () => stat(file).then((s) => s.size), catch: io });
    if (size !== source.bytes) return yield* io(new Error(`${file} does not hold its published prefix`));
  });

  const prepare = Effect.fnUntraced(function* (threadId: string) {
    if (input.home === undefined) return;
    const first = yield* standing(threadId).pipe(Effect.mapError(io));
    if (first === undefined || first.journal === null) return;
    if (first.rested !== null && current(first))
      return yield* held(`${input.home}/${first.journal}/${threadId}${ROLLOUT_SUFFIX}`, first.source!);
    if (first.rested === null && first.intent === null) return;
    yield* input
      .journal(
        threadId,
        Effect.gen(function* () {
          let row = yield* standing(threadId).pipe(Effect.mapError(io));
          if (row === undefined || row.journal === null) return;
          const path = `${input.home}/${row.journal}/${threadId}${ROLLOUT_SUFFIX}`;
          if (row.intent !== null) {
            yield* input.replacement.settle(threadId, path).pipe(Effect.mapError(io));
            row = yield* standing(threadId).pipe(Effect.mapError(io));
            if (row === undefined || row.journal === null) return;
          }
          if (row.rested === null) return;
          if (row.publishing === null) yield* input.forms.checked(threadId, path).pipe(Effect.mapError(io));
          else yield* input.forms.readable(threadId, path).pipe(Effect.mapError(io));
          const formed = yield* standing(threadId).pipe(Effect.mapError(io));
          if (formed === undefined || formed.rested === null) return;
          if (current(formed)) return yield* held(path, formed.source!);
          if (formed.source !== null || formed.publishing !== null)
            return yield* io(new Error(`The source of ${threadId} was not republished by its last form step.`));
          const adopted = yield* input.publication
            .stage({ canonical: path, candidate: { kind: 'current' }, form: formed.form, origin: 'adopted' })
            .pipe(Effect.provideService(ThreadEntryKinds, kinds), Effect.mapError(io));
          const published = yield* units
            .write(publishing, (unit) =>
              Effect.gen(function* () {
                const now = yield* unit.run(byId.get({ threadId }));
                if (
                  now === undefined ||
                  now.rested === null ||
                  now.source !== null ||
                  now.publishing !== null ||
                  now.intent !== null ||
                  now.form !== formed.form
                )
                  return false;
                yield* input.publication.publishIn(db, unit, threadId, path, adopted);
                return true;
              }),
            )
            .pipe(Effect.mapError(io));
          if (!published) {
            yield* input.publication.discard(threadId, path, adopted).pipe(Effect.mapError(io));
            return yield* io(new Error(`The source of ${threadId} moved while it was adopted.`));
          }
        }),
      )
      .pipe(Effect.mapError(io));
  });
  const open = Effect.fnUntraced(function* (threadId: string) {
    if (input.home !== undefined) {
      const row = yield* standing(threadId).pipe(Effect.mapError(io));
      if (row !== undefined && row.rested !== null && row.journal !== null) {
        const path = `${input.home}/${row.journal}/${threadId}${ROLLOUT_SUFFIX}`;
        if (row.intent !== null) yield* input.journal(threadId, input.replacement.settle(threadId, path)).pipe(Effect.mapError(io));
        yield* input.forms.readable(threadId, path).pipe(Effect.mapError(io));
      }
    }
    yield* prepare(threadId);
  });
  const recover = Effect.gen(function* () {
    if (input.home === undefined) return;
    for (const threadId of input.replacement.pendingIds()) {
      yield* input
        .journal(threadId, input.replacement.recover(threadId))
        .pipe(Effect.catchCause((cause) => Effect.logError(`The replacement of ${threadId} could not recover`, cause)));
    }
    const directories = yield* Effect.tryPromise({
      try: () =>
        readdir(input.home!, { withFileTypes: true }).catch((cause: NodeJS.ErrnoException) => {
          if (cause.code === 'ENOENT') return [];
          throw cause;
        }),
      catch: io,
    });
    for (const project of directories) {
      if (!project.isDirectory() || !/^\d+$/.test(project.name)) continue;
      const root = join(input.home, project.name);
      const entries = yield* Effect.tryPromise({ try: () => readdir(root, { withFileTypes: true }), catch: io });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const match = /^([A-Za-z0-9_-]+)\.jsonl\.generations$/.exec(entry.name);
        if (match === null) continue;
        const threadId = match[1]!;
        const current = Effect.map(standing(threadId), (row) =>
          row?.journal === Number(project.name) ? (row.source?.generation ?? null) : null,
        );
        yield* input.retention.sweep(threadId, join(root, entry.name), current).pipe(Effect.mapError(io));
      }
    }
  });
  const using = <A, E, R>(threadId: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(SourceUses, (held) =>
      Effect.suspend(() => {
        const use: SourceUse = { active: true };
        const context = new Map(held).set(threadId, use);
        const guarded = Effect.provideService(
          work.pipe(Effect.ensuring(Effect.sync(() => void (use.active = false)))),
          SourceUses,
          context,
        );
        return input.retention.using(threadId, guarded);
      }),
    );
  const retained = (threadId: string) => Effect.map(SourceUses, (held) => held.get(threadId)?.active === true);
  const retaining = <A, E, R>(threadId: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E | ThreadStorageFailed, R> =>
    Effect.flatMap(SourceUses, (held): Effect.Effect<A, E | ThreadStorageFailed, R> => {
      const parent = held.get(threadId);
      if (parent === undefined) return work;
      const expired = () =>
        new ThreadStorageFailed({ call: 'rolloutReads.source', cause: new Error(`The source lease of ${threadId} ended.`) });
      if (!parent.active) return Effect.fail(expired());
      return using(
        threadId,
        Effect.suspend((): Effect.Effect<A, E | ThreadStorageFailed, R> => (parent.active ? work : Effect.fail(expired()))),
      );
    });
  return { using, retaining, retained, prepare, open, recover };
});

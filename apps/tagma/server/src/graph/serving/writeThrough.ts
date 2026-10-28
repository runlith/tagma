import { Context, Effect } from 'effect';
import { eq, inArray } from 'drizzle-orm';
import { GraphStore } from '../../platform/contract/service/store.js';
import { Tags } from '../contract/service/vocabulary.js';
import { type SessionIdentity, sessionName } from '../../platform/contract/wire/session.js';
import { session } from '../../platform/store/writers.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { block } from '../store/tables.js';
import type { ActEntry, TreeGuard, TreeProjection } from '../contract/service/acts.js';
import { CurrentGraph, type TreeBatches, type WriteBindings } from '../contract/service/serving.js';
import { inStealth, stealthRelative } from '../contract/wire/storage.js';
import { writableAt } from './writing.js';
import { FORMAT_FILE } from '../contract/wire/storage.js';
import { blocksOf } from '../journal/eventLog.js';
import { projectDelta, restorePaths } from '../tree/projection.js';
import { actLines, type CommitAct } from '../tree/message.js';
import { refusal, refused } from './refusal.js';
import { writes } from '../../platform/contract/service/writes.js';

export const throughWrites = writes('TreeGuard.writeThrough', [block]);

export const writeThrough = (
  deps: { readonly identity: SessionIdentity['Service'] },
  bind: WriteBindings,
): NonNullable<Context.Service.Shape<typeof TreeGuard>>['prepare'] => {
  const { projectId, layout, commits, batches, unmerged, store, tags, ledger, settled, format } = bind;
  return Effect.suspend(() => {
    const stealth = bind.stealth?.tree() ?? null;
    const stealthRoot = stealth?.layout.treeRoot ?? null;
    const unmergedRead = Effect.map(
      Effect.all([unmerged.read, stealth === null ? Effect.succeed([]) : stealth.unmerged.read]),
      ([own, hidden]) => [...own, ...hidden],
    );
    return Effect.map(Effect.all([Effect.result(settled), Effect.result(unmergedRead)]), ([ready, reading]): TreeProjection => {
      const touched = new Set<string>();
      const write = Effect.fn('TreeGuard.writeThrough')(function* (entries: readonly ActEntry[]) {
        const concerned = entries.map((entry) => blocksOf(entry));
        const ids = [...new Set(concerned.flatMap((one) => one.ids))];
        const damaged = concerned.some((one) => one.unreadable !== null);
        if (ids.length === 0 && !damaged) return Effect.void;
        yield* writableAt(yield* CurrentGraph);
        yield* format.writable;
        if (ready._tag === 'Failure') {
          return yield* new GateRefusal(
            'graph-pool',
            `${layout.treeRoot} changed outside Tagma and could not be read into the graph, so this act would have projected over it: ${ready.failure.reason}`,
            ready.failure.unblock,
          );
        }
        const conflicted = yield* refused(Effect.fromResult(reading));
        if (conflicted.length > 0) {
          return yield* new GateRefusal(
            'tree-mid-merge',
            `the tree stands mid-merge with ${conflicted.length} unmerged path(s)`,
            batches === null
              ? ['resolve and commit in the project repository — its git owns this merge; the mirror repairs on the next read']
              : ['tagma files resolve — conclude the merge, then retry the act'],
          );
        }
        const staged = new Set<string>();
        const noteTouch = (relative: string, stage: boolean, restorable: boolean): void => {
          ledger.wrote(relative);
          if (restorable) touched.add(relative);
          if (stage) staged.add(relative);
        };
        if (yield* format.stamp) noteTouch(FORMAT_FILE, true, true);
        const projected = yield* Effect.result(
          Effect.gen(function* () {
            const blockIds = damaged
              ? (yield* store.db.select({ id: block.id }).from(block).where(eq(block.projectId, projectId))).map((row) => row.id)
              : ids;
            for (let at = 0; at < blockIds.length; at += 400) {
              yield* projectDelta({
                projectId,
                treeRoot: layout.treeRoot,
                stealth: stealthRoot,
                blockIds: blockIds.slice(at, at + 400),
                touched: noteTouch,
              });
            }
          }).pipe(Effect.provideService(GraphStore, store), Effect.provideService(Tags, tags)),
        );
        if (projected._tag !== 'Success') return yield* Effect.fail(refusal(projected.failure));
        const own = [...staged].filter((path) => !inStealth(path));
        const hidden = [...staged].filter(inStealth).map(stealthRelative);
        const actOf = Effect.fnUntraced(function* () {
          const sessionId = entries.find((entry) => entry.sessionId !== null)?.sessionId ?? null;
          const signer =
            sessionId === null
              ? undefined
              : yield* store.db.select({ harness: session.harness, key: session.key }).from(session).where(eq(session.id, sessionId)).get();
          const rows =
            ids.length === 0
              ? []
              : yield* store.db
                  .select({ id: block.id, uuid: block.uuid, title: block.title, tags: block.tags, stealth: block.stealth })
                  .from(block)
                  .where(inArray(block.id, ids));
          const table = yield* tags.of(projectId);
          const agent = signer === undefined ? null : sessionName(signer, deps.identity);
          const position = entries.length === 0 ? null : Math.max(...entries.map((entry) => entry.id));
          return (team: boolean): CommitAct => ({
            lines: actLines(entries, new Map(rows.filter((row) => !team || !row.stealth).map((row) => [row.id, row])), table),
            agent,
            position,
          });
        });
        const hiddenInto: TreeBatches | null = hidden.length > 0 ? (stealth?.batches ?? null) : null;
        const ownLands = own.length > 0 && (batches !== null || commits !== undefined);
        if (hiddenInto === null && !ownLands) return Effect.void;
        const acts = yield* actOf();
        const after: Effect.Effect<void>[] = [];
        if (hiddenInto !== null) after.push(hiddenInto.land({ paths: hidden, act: acts(false) }));
        if (ownLands) {
          if (batches !== null) after.push(batches.land({ paths: own, act: acts(false) }));
          else if (commits !== undefined) after.push(commits.mark(acts(true), own));
        }
        return Effect.all(after, { discard: true });
      });
      const undo = Effect.suspend(() => {
        if (touched.size === 0) return Effect.void;
        const paths = [...touched];
        touched.clear();
        return restorePaths({ projectId, treeRoot: layout.treeRoot, stealth: stealthRoot, paths }).pipe(
          Effect.provideService(GraphStore, store),
          Effect.provideService(Tags, tags),
          Effect.tap(() => Effect.sync(() => paths.forEach((path) => ledger.wrote(path)))),
          Effect.mapError(
            (failure) =>
              new GateRefusal(
                'graph-pool',
                `the act failed after writing files in ${layout.treeRoot}, and they could not be put back as the graph holds them: ${failure.message}`,
                ['read the tree against the graph with sync_graph, then retry the act'],
              ),
          ),
          Effect.asVoid,
        );
      });
      return { write, undo };
    });
  });
};

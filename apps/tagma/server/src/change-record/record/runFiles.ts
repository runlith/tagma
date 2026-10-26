import { Clock, Effect, FileSystem } from 'effect';
import { chunk } from '@runlith/utils/collection';
import { contentDigest } from '@runlith/files/content';
import { workspaceChangeHunk } from '@runlith/files/hunk';
import { commitOf } from '@runlith/git/repository';
import { actingGit } from '../../platform/git/ownGit.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { checkoutAt, confineToTree, placeIn, placesIn } from '../../workspace/roots/proof.js';
import type { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import type { ChangeCheckout, ChangeRecord, RunEvidence } from '../contract/service/record.js';
import type { RunFilesFailure } from '../contract/service/runFiles.js';
import { LineWrites } from '../contract/service/lineWrites.js';
import type { RunFile, RunFilePage, RunSelection } from '../contract/wire/runFiles.js';
import type { LineCounts, LinesReverted } from '../contract/wire/runFiles.js';
import type { Folder } from '../holdings/judge.js';
import { restoreAt, type Restoring } from '../holdings/restore.js';
import type { Walks } from '../lines/walks.js';
import { working } from '../threadFiles/sides.js';
import { pathsOfRuns, evidenceOfRunPaths, RUN_PATH_GROUP, stateOf, stateOfRuns } from './runEvidence.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { StoreShape } from './places.js';

export const checkedPath = (checkout: ChangeCheckout, graphDirectory: string, path: string): boolean =>
  !path.startsWith('/') &&
  path !== '' &&
  confineToTree(checkout.root, path) !== null &&
  !path.split('/').some((part) => part === '..' || part === '.git') &&
  path !== graphDirectory &&
  !path.startsWith(`${graphDirectory}/`);

type Reverting = {
  readonly file: RunFile;
  readonly after: string | null;
  readonly changes: readonly string[];
  readonly lines: LineCounts;
};

const counted = (): { added: number; removed: number } => ({ added: 0, removed: 0 });

export const revertPlan = (
  path: string,
  rows: readonly RunEvidence[],
  selection: RunSelection,
  restoring: Restoring | RunFile['unavailable'],
): Reverting => {
  const runs = new Set(selection.runIds);
  const mine = rows.filter((row) => row.threadId === selection.threadId && row.runId !== null && runs.has(row.runId));
  const committed = mine
    .filter((row) => row.committedAt !== null)
    .map((row) => ({
      id: row.id,
      runId: row.runId as string,
      firstLine: row.firstLine,
      lines: row.lines,
      commit: row.commit,
      counts: row.added !== null && row.removed !== null ? { added: row.added, removed: row.removed } : { added: row.lines, removed: null },
    }));
  const pending = mine.filter((row) => row.committedAt === null && row.withdrawnAt === null);
  const absent = typeof restoring !== 'string' && restoring !== null && restoring.kind === 'folded' && restoring.working.kind === 'absent';
  const notRecreated = pending.filter((row) => row.origin === 'delete' && absent).map((row) => row.id);
  const file: RunFile = {
    path,
    own: counted(),
    committed,
    held: [],
    overwritten: [],
    unproven: [],
    atHead: [],
    notRecreated,
    unavailable: null,
  };
  const live = pending.map((row) => row.id).filter((id) => !notRecreated.includes(id));
  const untouched = (unavailable: RunFile['unavailable']): Reverting => ({
    file: { ...file, unproven: live, unavailable },
    after: null,
    changes: [],
    lines: counted(),
  });
  if (pending.length === 0)
    return {
      file: { ...file, overwritten: mine.filter((row) => row.withdrawnAt !== null).map((row) => row.id) },
      after: null,
      changes: [],
      lines: counted(),
    };
  if (typeof restoring === 'string' || restoring === null) return untouched(restoring);
  if (restoring.kind === 'unread') return untouched('git-unreadable');
  if (restoring.kind === 'unproven' || 'reason' in restoring.restored) return untouched(null);
  const { verdict, restored } = restoring;
  const ids = new Set(live);
  const back = new Set(restored.restored.filter((id) => ids.has(id)));
  const own = counted();
  const reverted = counted();
  const held = new Map<string, { added: number; removed: number }>();
  for (const line of verdict.lines === 'unweighed' ? [] : verdict.lines) {
    if (line.mark === 'external') continue;
    if (ids.has(line.mark.row)) {
      own[line.kind] += 1;
      if (back.has(line.mark.row)) reverted[line.kind] += 1;
    } else if (line.mark.holder !== selection.threadId) {
      const lines = held.get(line.mark.holder) ?? counted();
      lines[line.kind] += 1;
      held.set(line.mark.holder, lines);
    }
  }
  const overwritten = live.filter((id) => !verdict.standing.has(id) && verdict.overwritten.has(id));
  const atHead = live.filter((id) => !verdict.standing.has(id) && !verdict.overwritten.has(id));
  const unproven = live.filter((id) => verdict.standing.has(id) && !back.has(id));
  return {
    file: {
      ...file,
      own,
      held: [...held].map(([threadId, lines]) => ({ threadId, agentName: null, lines })),
      overwritten,
      unproven,
      atHead,
    },
    after: back.size === 0 ? null : restored.text,
    changes: [...back],
    lines: reverted,
  };
};

export function runFilesOver(
  units: MachineUnits['Service'],
  store: StoreShape,
  record: ChangeRecord['Service'],
  places: CheckoutPaths['Service'],
  graphDirectory: string,
  walks: Walks,
) {
  const folder: Folder = (input, cached, alignment, lane) => walks.fold(input, cached, alignment, lane);
  const unproven = (reason: string) =>
    new GateRefusal('root-unproven', `which checkout the selection reads is unknown: ${reason}`, [
      'use a proved checkout of the thread’s project',
    ]);
  const keyOf = (checkout: ChangeCheckout) =>
    checkout.origin === null
      ? Effect.fail(unproven('it has no proved origin'))
      : Effect.mapError(checkoutAt(places, checkout.projectId, checkout.root), (failure) => unproven(failure.reason));
  const headOf = (checkout: ChangeCheckout) => commitOf(actingGit(checkout.git, 'rewind-head'), checkout.root, 'HEAD');
  const read = Effect.fn('ChangeRecord.runFile')(function* (
    checkout: ChangeCheckout,
    key: string,
    selection: RunSelection,
    path: string,
    rows: readonly RunEvidence[],
  ) {
    const refused = (reason: RunFile['unavailable']) => ({ plan: revertPlan(path, rows, selection, reason), state: stateOf(rows) });
    if (checkout.origin === null) return refused('root-unproven');
    if (!checkedPath(checkout, graphDirectory, path)) return refused('path-refused');
    const runs = new Set(selection.runIds);
    const selected = new Set(
      rows.filter((row) => row.threadId === selection.threadId && row.runId !== null && runs.has(row.runId)).map((row) => row.id),
    );
    const readers = { store, units, git: checkout.git, files: yield* FileSystem.FileSystem, walks };
    const restoring = yield* restoreAt(readers, folder, { rootId: key, dir: checkout.root }, path, selected);
    if (restoring.kind === 'folded' && restoring.working.kind === 'whole') return refused('binary');
    if (restoring.kind === 'unread') return refused('path-unreadable');
    return { plan: revertPlan(path, rows, selection, restoring), state: stateOf(rows) };
  });
  const begin = Effect.fn('ChangeRecord.selectedRuns')(function* (checkout: ChangeCheckout, selection: RunSelection) {
    if (selection.runIds.length === 0)
      return yield* new GateRefusal('selection-shape', 'a file rewind needs at least one run', ['name the runs the rewind took out']);
    const key = yield* keyOf(checkout);
    return { key, named: yield* pathsOfRuns(units, store, checkout.projectId, key, selection) };
  });
  const runFiles = Effect.fn('ChangeRecord.runFiles')(function* (
    checkout: ChangeCheckout,
    selection: RunSelection,
    page: { readonly limit: number; readonly after?: string },
  ): Effect.fn.Return<RunFilePage, RunFilesFailure, FileSystem.FileSystem> {
    if (!Number.isSafeInteger(page.limit) || page.limit < 1)
      return yield* new GateRefusal('selection-shape', 'the file reading needs a positive whole limit', [
        'pass the number of files this reading should answer',
      ]);
    const { key, named } = yield* begin(checkout, selection);
    const asked = named.filter((path) => page.after === undefined || path > page.after).slice(0, page.limit);
    const files = [];
    for (const group of chunk(asked, RUN_PATH_GROUP)) {
      const evidence = yield* evidenceOfRunPaths(units, store, placesIn(key, group), selection);
      for (const path of group) files.push((yield* read(checkout, key, selection, path, evidence.get(path) ?? [])).plan.file);
    }
    const last = asked[asked.length - 1];
    return { files, total: named.length, next: last !== undefined && named.some((path) => path > last) ? last : null, unavailable: null };
  });
  const revertLines = Effect.fn('ChangeRecord.revertLines')(function* (
    checkout: ChangeCheckout,
    selection: RunSelection,
  ): Effect.fn.Return<LinesReverted, RunFilesFailure, FileSystem.FileSystem | LineWrites> {
    if (checkout.origin === null)
      return yield* new GateRefusal('root-unproven', 'the selected checkout has no proved origin, so none of its lines can be restored', [
        'use a proved checkout of the thread’s project',
      ]);
    const { key, named } = yield* begin(checkout, selection);
    const head = yield* headOf(checkout);
    const writes = yield* LineWrites;
    const reverted: LinesReverted['reverted'][number][] = [];
    const skipped: LinesReverted['skipped'][number][] = [];
    for (const group of chunk(named, RUN_PATH_GROUP)) {
      const evidence = yield* evidenceOfRunPaths(units, store, placesIn(key, group), selection);
      for (const path of group) {
        const rows = evidence.get(path) ?? [];
        if (!checkedPath(checkout, graphDirectory, path)) {
          const plan = revertPlan(path, rows, selection, 'path-refused');
          for (const reason of ['committed', 'overwritten', 'unproven'] as const) {
            const changes = reason === 'committed' ? plan.file.committed.map((row) => row.id) : plan.file[reason];
            if (changes.length > 0) skipped.push({ path, changes, reason });
          }
          continue;
        }
        yield* record.turn(
          checkout.projectId,
          [`${checkout.root}/${path}`],
          Effect.gen(function* () {
            const { plan, state } = yield* read(checkout, key, selection, path, rows);
            const bytes = yield* Effect.result(working(yield* FileSystem.FileSystem, checkout.root, path));
            if (bytes._tag === 'Failure') {
              yield* Effect.logWarning('a revert skips a path whose working file could not be read', {
                path,
                reason: bytes.failure.message,
              });
              skipped.push({ path, changes: plan.changes, reason: 'unreadable' });
              return;
            }
            for (const reason of ['committed', 'atHead', 'overwritten', 'unproven'] as const) {
              const changes = reason === 'committed' ? plan.file.committed.map((row) => row.id) : plan.file[reason];
              if (changes.length > 0)
                skipped.push({
                  path,
                  changes,
                  reason: reason === 'atHead' ? 'at-head' : reason === 'unproven' && plan.file.unavailable !== null ? 'unreadable' : reason,
                });
            }
            if (plan.file.notRecreated.length > 0) skipped.push({ path, changes: plan.file.notRecreated, reason: 'deleted-file' });
            if (plan.changes.length === 0 || plan.after === bytes.success) return;
            const before = bytes.success ?? '';
            const after = plan.after ?? '';
            const hunk = workspaceChangeHunk(before, after);
            const place = placeIn(key, path);
            const approved = Effect.gen(function* () {
              if ((yield* headOf(checkout)) !== head) return false;
              return place !== null && (yield* stateOfRuns(units, store, place, selection)) === state;
            });
            const outcome = yield* record.land(
              { work: { projectId: checkout.projectId, threadId: selection.threadId } },
              [
                {
                  path: `${checkout.root}/${path}`,
                  origin: 'write',
                  before: contentDigest(before),
                  after: contentDigest(after),
                  beforeText: before,
                  afterText: after,
                  at: new Date(yield* Clock.currentTimeMillis),
                  reverts: plan.changes,
                  hunk,
                },
              ],
              writes.replace({ root: checkout.root, path, before: bytes.success, after: plan.after ?? '' }, approved),
            );
            if (outcome._tag === 'moved') skipped.push({ path, changes: plan.changes, reason: 'moved' });
            else {
              reverted.push({ path, changes: plan.changes, lines: plan.lines });
              if (outcome._tag !== 'written' || !outcome.kept) skipped.push({ path, changes: plan.changes, reason: 'unrecorded' });
            }
          }),
        );
      }
    }
    return { reverted, skipped };
  });
  return { runFiles, revertLines };
}

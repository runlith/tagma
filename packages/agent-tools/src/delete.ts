import { dirname } from 'node:path';
import { Effect, FileSystem, type PlatformError } from 'effect';
import { Tool, ToolAnswer, ToolFailed, everyClaim } from '@runlith/agent/tool';
import type { ToolCaller } from '@runlith/agent/contracts';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import type { PermissionSubject } from '@runlith/agent/permissions';
import { ASKS_IN_REVIEW } from '@runlith/agent/permissions';
import { pathSubject } from '@runlith/agent/permissions/pathSubject';
import type { Entries } from '@runlith/files/entries';
import { type Entry, fileFailure } from '@runlith/files/replace';
import { prepareToolEffect, runToolEffect, unboundTool } from './ToolEdge';
import type { PreparedPath, ResolvedToolOptions, ToolFactoryOptions } from './workspace';
import { admitPreparedPath, preparedPath, resolveToolOptions } from './workspace/runtime';
import { DESCRIPTION_DELETE } from './descriptions';
import { displayPath } from './display';
import { REFUSALS } from './refusals';
import { removalInput, type RemovalSelection, type RemovalTarget } from './removal/model';
import { selectRemoval } from './removal/selection';
import { admitRoot, removalIssue } from './removal/execute';
import { CHUNK, LANES, type Leaf, type Outcome, removeLeaves } from './removal/leaves';
import { removeTree, type Settled } from './removal/tree';
import { makeReport, type RemovalJournal } from './removal/report';
import { inBasis } from './changed';

export type PreparedRemoval = { readonly selection: RemovalSelection; readonly paths: readonly PreparedPath[] };

type RemovalCall = {
  readonly journal: RemovalJournal;
  answer?: ToolAnswer;
  readonly done: Set<number>;
  nextIssue: number;
  removed: number;
};

const CONFIRMED_PATHS = 20;

const KIND_LABELS: Readonly<Record<Entry['kind'], string>> = {
  file: 'File',
  directory: 'Directory',
  link: 'Symbolic link',
  special: 'Special file',
};

const keyOf = (toolCallId: string, caller: ToolCaller): string =>
  JSON.stringify([caller.ownerId, caller.agentId, caller.thread?.threadId ?? null, caller.thread?.runId ?? null, toolCallId]);

const groupsOf = (targets: readonly RemovalTarget[]): readonly (readonly number[])[] => {
  const groups: number[][] = [];
  for (const [index, target] of targets.entries()) {
    const last = groups.at(-1);
    const previous = last === undefined ? undefined : targets[last[0]!];
    if (
      last !== undefined &&
      previous !== undefined &&
      !target.tree &&
      !previous.tree &&
      last.length < CHUNK &&
      dirname(previous.path) === dirname(target.path)
    )
      last.push(index);
    else groups.push([index]);
  }
  return groups;
};

const removeTargets = Effect.fnUntraced(function* (input: {
  readonly at: ResolvedToolOptions;
  readonly entries: Entries;
  readonly selection: RemovalSelection;
  readonly paths: readonly PreparedPath[];
  readonly indexes: readonly number[];
  readonly report: (index: number, outcome: Outcome) => Effect.Effect<void, PlatformError.PlatformError>;
  readonly shown: (display: ToolDisplay) => void;
}) {
  const { at, entries, selection, paths, indexes, report } = input;
  const admitted = yield* Effect.forEach(
    indexes,
    (index) =>
      admitPreparedPath(at, paths[index], { allowMissing: true }).pipe(
        Effect.matchEffect({
          onFailure: (failure) =>
            Effect.as(report(index, { status: 'failed', issue: removalIssue(selection.targets[index]!.path, 'resolve', failure) }), null),
          onSuccess: () => Effect.succeed(index),
        }),
      ),
    { concurrency: LANES },
  );
  const standing = admitted.filter((index): index is number => index !== null);
  const indexOf = new Map(standing.map((index) => [selection.targets[index]!.path, index] as const));
  const leaves: Leaf[] = standing.map((index) => {
    const target = selection.targets[index]!;
    return { path: target.path, kind: target.entry.kind, expected: target.entry, operands: target.operands };
  });
  yield* removeLeaves({
    resolved: at,
    entries,
    directories: [],
    leaves,
    settle: (leaf, outcome) => report(indexOf.get(leaf.path)!, outcome),
    shown: selection.targets.length === 1 ? (_leaf, display) => input.shown(display) : undefined,
  });
});

export function createDeleteTool(options: ToolFactoryOptions): Tool {
  const resolved = resolveToolOptions(options);
  const { files, entries, environment } = resolved.world;
  const retained = new Map<string, RemovalCall>();
  return Tool.make<typeof removalInput, PreparedRemoval>({
    approval: ASKS_IN_REVIEW,
    description: DESCRIPTION_DELETE,
    parameters: removalInput,
    refusals: {
      ...REFUSALS,
      'unsupported-option': 'Option not supported',
      'missing-operand': 'Nothing named to delete',
      'invalid-argument': 'Invalid argument',
      'invalid-operand': 'Invalid path',
      'resolve-failed': 'Path could not be resolved',
      'not-directory': 'Not a directory',
      unprepared: 'Deletion was not prepared',
      'partial-deletion': 'Deleted only in part',
    },
    display: {
      streamFields: ['args', 'workdir'],
      project: (input) => ({ form: 'none', title: input.args?.join(' '), subtitle: input.workdir }),
    },
    prepare: (input) =>
      files === undefined || entries === undefined
        ? unboundTool('delete', 'filesystem')
        : prepareToolEffect(
            files,
            Effect.gen(function* () {
              const selection = yield* selectRemoval(resolved, entries, input);
              const fs = yield* FileSystem.FileSystem;
              const subjectRoot = yield* fs.realPath(resolved.cwd).pipe(
                Effect.mapError(
                  (failure) =>
                    new ToolFailed({
                      code: 'resolve-failed',
                      reason: `Cannot resolve the workspace for deletion: ${fileFailure(failure)}`,
                    }),
                ),
              );
              const paths: PreparedPath[] = [];
              const subjects: PermissionSubject[] = [];
              for (const target of selection.targets) {
                const prepared = yield* preparedPath(resolved, target.path, 'write', true);
                paths.push(prepared.path);
                subjects.push({ ...pathSubject('write', subjectRoot, target.path), entry: true, tree: target.tree ? true : undefined });
              }
              return { subjects, prepared: { selection, paths } };
            }),
          ),
    claims: () => Effect.succeed(everyClaim('write')),
    execute: (_input, call) =>
      files === undefined || entries === undefined
        ? unboundTool('delete', 'filesystem')
        : runToolEffect(
            'delete',
            files,
            Effect.gen(function* () {
              const prepared = call.prepared;
              if (prepared === undefined)
                return yield* new ToolFailed({
                  code: 'unprepared',
                  reason: 'Deletion has no admitted selection. Prepare this call before executing it.',
                });
              const { selection, paths } = prepared;
              const at = resolved.at(call.caller);
              const journal = yield* makeReport(environment.tmp, selection.options.verbose);
              const state: RemovalCall = { journal, done: new Set(), nextIssue: 0, removed: 0 };
              retained.set(keyOf(call.toolCallId, call.caller), state);
              let display: ToolDisplay | undefined;
              const initial = Effect.gen(function* () {
                for (let index = state.nextIssue; index < selection.issues.length; index++) {
                  const issue = selection.issues[index]!;
                  const absent = selection.options.force && (issue.code === 'not-found' || issue.code === 'no-match');
                  yield* journal
                    .append({
                      path: issue.path,
                      kind: 'selection',
                      operands: issue.operands ?? [issue.path],
                      status: absent ? 'absent' : 'failed',
                      issue,
                    })
                    .pipe(
                      Effect.tap(() =>
                        Effect.sync(() => {
                          state.nextIssue = index + 1;
                        }),
                      ),
                      Effect.uninterruptible,
                    );
                }
              });
              const report = (index: number, outcome: Outcome) => {
                const target = selection.targets[index]!;
                return journal
                  .append(
                    outcome.status === 'failed'
                      ? {
                          path: target.path,
                          kind: target.entry.kind,
                          operands: target.operands,
                          status: selection.options.force && outcome.issue.code === 'not-found' ? 'absent' : 'failed',
                          issue: outcome.issue,
                        }
                      : {
                          path: target.path,
                          kind: target.entry.kind,
                          operands: target.operands,
                          status: 'removed',
                          record: outcome.record,
                          issue:
                            outcome.pending === null
                              ? undefined
                              : { path: target.path, stage: 'record', code: 'confirmation-pending', reason: outcome.pending },
                        },
                  )
                  .pipe(
                    Effect.tap(() =>
                      Effect.sync(() => {
                        state.done.add(index);
                      }),
                    ),
                  );
              };
              const tree = (index: number) => {
                const target = selection.targets[index]!;
                const settled: Settled = (row, root) =>
                  root
                    ? journal.append(row).pipe(
                        Effect.tap(() =>
                          Effect.sync(() => {
                            state.done.add(index);
                            state.removed = 0;
                          }),
                        ),
                        Effect.uninterruptible,
                      )
                    : journal.entry(row);
                return admitRoot(at, entries, target, paths[index]!).pipe(
                  Effect.matchEffect({
                    onFailure: (failure) => {
                      const issue = removalIssue(target.path, 'resolve', failure);
                      return settled(
                        {
                          path: target.path,
                          kind: target.entry.kind,
                          operands: target.operands,
                          status: selection.options.force && issue.code === 'not-found' ? 'absent' : 'failed',
                          issue,
                          removed: 0,
                        },
                        true,
                      );
                    },
                    onSuccess: () =>
                      removeTree(at, entries, target, selection.options, selection.nested, settled, (removed) => {
                        state.removed = removed;
                      }),
                  }),
                );
              };
              const run = Effect.gen(function* () {
                yield* initial;
                for (const group of groupsOf(selection.targets)) {
                  state.removed = 0;
                  if (selection.targets[group[0]!]!.tree) {
                    yield* tree(group[0]!);
                    continue;
                  }
                  yield* removeTargets({
                    at,
                    entries,
                    selection,
                    paths,
                    indexes: group,
                    report,
                    shown: (shown) => {
                      display = shown;
                    },
                  });
                }
                state.answer = yield* journal.answer('completed', display);
                return state.answer;
              });
              const stopped = Effect.gen(function* () {
                yield* initial;
                for (const [index, target] of selection.targets.entries()) {
                  if (state.done.has(index)) continue;
                  yield* journal.append({
                    path: target.path,
                    kind: target.entry.kind,
                    operands: target.operands,
                    status: 'unprocessed',
                    removed: target.tree ? state.removed : undefined,
                  });
                  state.removed = 0;
                }
                state.answer = yield* journal.answer('cancelled', display);
              }).pipe(
                Effect.catchTag('PlatformError', (failure) =>
                  Effect.sync(() => {
                    state.answer = journal.snapshot(
                      'unknown',
                      display,
                      `The partial report could not be completed: ${fileFailure(failure)}`,
                    );
                  }),
                ),
              );
              return yield* inBasis(
                at,
                selection.targets.map((target) => target.path),
                run,
              ).pipe(
                Effect.onInterrupt(() => stopped),
                Effect.catchTag('PlatformError', (failure) =>
                  Effect.sync(() => {
                    state.answer = journal.snapshot(
                      'unknown',
                      display,
                      `Report storage failed; further deletions stopped: ${fileFailure(failure)}`,
                    );
                    return state.answer;
                  }),
                ),
              );
            }),
            call,
          ),
    settleEffect: ({ toolCallId, caller }) =>
      Effect.sync(() => {
        const state = retained.get(keyOf(toolCallId, caller));
        return state?.answer === undefined ? { status: 'unknown' as const } : { status: 'completed' as const, output: state.answer };
      }),
    settled: ({ toolCallId, caller }) => {
      const key = keyOf(toolCallId, caller);
      const state = retained.get(key);
      retained.delete(key);
      if (state !== undefined) Effect.runFork(state.journal.dispose());
    },
    mutates: true,
    confirmation: {
      prompt: (input, prepared) => {
        const targets = prepared?.selection.targets;
        if (targets === undefined) return { summary: `Delete ${input.args.join(' ')}?` };
        const named = targets.slice(0, CONFIRMED_PATHS).map((target) => ({
          label: target.tree ? 'Directory and everything in it' : KIND_LABELS[target.entry.kind],
          value: displayPath(resolved.cwd, target.path),
        }));
        const more = targets.length - named.length;
        return {
          summary: targets.length === 1 ? `Delete ${named[0]!.value}?` : `Delete ${targets.length} paths?`,
          facts: more === 0 ? named : [...named, { label: 'More', value: `${more} more paths` }],
          consequence: 'Symbolic links are unlinked; their targets are untouched.',
        };
      },
      confirmLabel: 'Delete',
    },
  });
}

import { Effect, FileSystem } from 'effect';
import { Tool, ToolAnswer, ToolFailed, everyClaim } from '@runlith/agent/tool';
import type { ToolCaller } from '@runlith/agent/contracts';
import type { ToolDisplay } from '@runlith/agent/tool/display';
import type { PermissionSubject } from '@runlith/agent/permissions';
import { ASKS_IN_REVIEW } from '@runlith/agent/permissions';
import { pathSubject } from '@runlith/agent/permissions/pathSubject';
import { type Entry, fileFailure } from '@runlith/files/replace';
import { prepareToolEffect, runToolEffect, unboundTool } from './ToolEdge';
import type { PreparedPath, ToolFactoryOptions } from './workspace';
import { preparedPath, resolveToolOptions } from './workspace/runtime';
import { DESCRIPTION_DELETE } from './descriptions';
import { displayPath } from './display';
import { REFUSALS } from './refusals';
import { removalInput, type RemovalResult, type RemovalSelection, type RemovalStage, type RemovalTarget } from './removal/model';
import { selectRemoval } from './removal/selection';
import { admitRoot, removeTarget, removalIssue } from './removal/execute';
import { removeTree } from './removal/tree';
import { makeReport, type RemovalJournal } from './removal/report';
import { inBasis } from './changed';

export type PreparedRemoval = { readonly selection: RemovalSelection; readonly paths: readonly PreparedPath[] };

type RemovalCall = { readonly journal: RemovalJournal; answer?: ToolAnswer; next: number; nextIssue: number; removed: number };

const CONFIRMED_PATHS = 20;

const KIND_LABELS: Readonly<Record<Entry['kind'], string>> = {
  file: 'File',
  directory: 'Directory',
  link: 'Symbolic link',
  special: 'Special file',
};

const keyOf = (toolCallId: string, caller: ToolCaller): string =>
  JSON.stringify([caller.ownerId, caller.agentId, caller.thread?.threadId ?? null, caller.thread?.runId ?? null, toolCallId]);

export function createDeleteTool(options: ToolFactoryOptions): Tool {
  const resolved = resolveToolOptions(options);
  const { files, environment } = resolved.world;
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
      files === undefined
        ? unboundTool('delete', 'filesystem')
        : prepareToolEffect(
            files,
            Effect.gen(function* () {
              const selection = yield* selectRemoval(resolved, input);
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
      files === undefined
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
              const journal = yield* makeReport(environment.tmp, selection.options.verbose);
              const state: RemovalCall = { journal, next: 0, nextIssue: 0, removed: 0 };
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
              const tree = (target: RemovalTarget, path: PreparedPath, index: number) => {
                const at = resolved.at(call.caller);
                const settled = (row: RemovalResult, root: boolean) =>
                  root
                    ? journal.append(row).pipe(
                        Effect.tap(() =>
                          Effect.sync(() => {
                            state.next = index + 1;
                            state.removed = 0;
                          }),
                        ),
                        Effect.uninterruptible,
                      )
                    : journal.entry(row);
                return admitRoot(at, target, path).pipe(
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
                      removeTree(at, target, selection.options, selection.nested, settled, (removed) => {
                        state.removed = removed;
                      }),
                  }),
                );
              };
              const run = Effect.gen(function* () {
                yield* initial;
                for (let index = 0; index < selection.targets.length; index++) {
                  const target = selection.targets[index]!;
                  state.removed = 0;
                  if (target.tree) {
                    yield* tree(target, paths[index]!, index);
                    continue;
                  }
                  const path = paths[index]!;
                  let stage: RemovalStage = 'resolve';
                  yield* removeTarget(
                    resolved.at(call.caller),
                    target,
                    path,
                    selection.targets.length === 1,
                    (next) => {
                      stage = next;
                    },
                    (removed) => {
                      display = removed.display ?? display;
                      state.next = index + 1;
                      return journal.append({
                        path: target.path,
                        kind: target.entry.kind,
                        operands: target.operands,
                        status: 'removed',
                        record: removed.record.pending !== null ? 'pending' : removed.record.kept ? 'recorded' : 'outside',
                        issue:
                          removed.record.pending === null
                            ? undefined
                            : { path: target.path, stage: 'record', code: 'confirmation-pending', reason: removed.record.pending },
                      });
                    },
                  ).pipe(
                    Effect.matchEffect({
                      onFailure: (failure) => {
                        if (state.next > index) return Effect.fail(failure);
                        const issue = removalIssue(target.path, stage, failure);
                        return journal.append({
                          path: target.path,
                          kind: target.entry.kind,
                          operands: target.operands,
                          status: selection.options.force && issue.code === 'not-found' ? 'absent' : 'failed',
                          issue,
                        });
                      },
                      onSuccess: () => Effect.void,
                    }),
                    Effect.tap(() =>
                      Effect.sync(() => {
                        state.next = index + 1;
                      }),
                    ),
                  );
                }
                state.answer = yield* journal.answer('completed', display);
                return state.answer;
              });
              const stopped = Effect.gen(function* () {
                yield* initial;
                for (let index = state.next; index < selection.targets.length; index++) {
                  const target = selection.targets[index]!;
                  yield* journal.append({
                    path: target.path,
                    kind: target.entry.kind,
                    operands: target.operands,
                    status: 'unprocessed',
                    removed: target.tree ? (index === state.next ? state.removed : 0) : undefined,
                  });
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
                resolved.at(call.caller),
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

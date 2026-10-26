import { Data, Effect, FileSystem, Schema } from 'effect';
import { Tool } from '@runlith/agent/tool';
import { ToolFailed } from '@runlith/agent/tool';
import { prepareToolEffect, runToolEffect, unboundTool } from './ToolEdge';
import type { PreparedPath, ResolvedToolOptions, ToolFactoryOptions } from './workspace';
import { workspaceKey } from './workspace/paths';
import {
  admitPreparedPath,
  namedPath,
  pathClaims,
  preparedPath,
  realParent,
  resolveToolOptions,
  withDirectoryLocks,
  withFileWriteLocks,
} from './workspace/runtime';
import { displayPath } from './display';
import { aliasRefusal, entryIdentity, isLink, orAbsent, storedOf, storedPath } from './namespace';
import { inTurns, recordedSentence, recordingMove } from './changed';
import { DESCRIPTION_RENAME } from './descriptions';
import { REFUSALS, refused } from './refusals';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '@runlith/agent/permissions';

const renameInputSchema = Schema.Struct({
  from: Schema.String.annotate({ description: 'The file to move, absolute or relative to the workspace root' }),
  to: Schema.String.annotate({ description: 'Where it lands, absolute or relative to the workspace root' }),
});

type Params = typeof renameInputSchema.Type;

const betweenPermits = Effect.fn('RenameTool.permits')(function* <A, E, R>(
  root: string,
  from: string,
  to: string,
  work: Effect.Effect<A, E, R>,
) {
  const paths = [workspaceKey(root, from), workspaceKey(root, to)];
  const parents = [...new Set(yield* Effect.forEach(paths, realParent))].sort();
  const files = [...new Set(paths)].sort();
  return yield* withDirectoryLocks(parents, withFileWriteLocks(root, files, work));
});

const readSource = Effect.fn('RenameTool.source')(function* (resolved: ResolvedToolOptions, from: string) {
  const fs = yield* FileSystem.FileSystem;
  const identity = yield* entryIdentity(from);
  if (identity.kind === 'alias' || identity.kind === 'taken') {
    return yield* refused('aliased', aliasRefusal(resolved.cwd, from, storedOf(identity)));
  }
  if (yield* isLink(from)) {
    return yield* refused(
      'wrong-kind',
      `Not a regular file: ${displayPath(resolved.cwd, from)} is a symlink, and moving one is a different act.`,
    );
  }
  const info = yield* orAbsent(fs.stat(from));
  if (!info) {
    return yield* refused('not-found', `File not found: ${displayPath(resolved.cwd, from)}`);
  }
  if (info.type !== 'File') {
    return yield* refused(
      'wrong-kind',
      `Not a regular file: ${displayPath(resolved.cwd, from)} is a ${info.type.toLowerCase()}, and moving one is a different act.`,
    );
  }
  const text = yield* decodedText(fs, from);
  if (text === null) {
    return yield* refused(
      'not-text',
      `Not text: ${displayPath(resolved.cwd, from)} cannot be recorded as lines, and this move is recorded. Move it with the shell and land it by hand.`,
    );
  }
  return text;
});

class NotUtf8 extends Data.TaggedError('NotUtf8') {}

const decodedText = Effect.fn('RenameTool.text')(function* (fs: FileSystem.FileSystem, path: string) {
  const bytes = yield* fs.readFile(path);
  return yield* Effect.try({
    try: () => ({ bytes, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }),
    catch: () => new NotUtf8(),
  }).pipe(Effect.catchTag('NotUtf8', () => Effect.succeed(null)));
});

const checkDestination = Effect.fn('RenameTool.destination')(function* (resolved: ResolvedToolOptions, from: string, to: string) {
  const identity = yield* entryIdentity(to);
  if (identity.kind === 'exact') {
    return yield* refused(
      'target-exists',
      `${displayPath(resolved.cwd, to)} already exists. A move never replaces a file: those bytes are somebody's work.`,
    );
  }
  if (identity.kind === 'taken' || (identity.kind === 'alias' && storedPath(to, identity.stored) !== from)) {
    return yield* refused('aliased', aliasRefusal(resolved.cwd, to, storedOf(identity)));
  }
});

type PreparedMove = { readonly from: PreparedPath; readonly to: PreparedPath };

const run = Effect.fn('RenameTool.execute')(function* (resolved: ResolvedToolOptions, params: Params, prepared: PreparedMove | undefined) {
  const fs = yield* FileSystem.FileSystem;
  const from = yield* admitPreparedPath(resolved, prepared?.from, { allowMissing: true });
  const to = yield* admitPreparedPath(resolved, prepared?.to, { allowMissing: true });
  if (from === to) {
    return yield* refused('call-shape', 'from and to are the same path: there is nothing to move.');
  }
  const source = yield* readSource(resolved, from);
  yield* checkDestination(resolved, from, to);
  const kept = yield* recordingMove(resolved, from, to, source).pipe(
    Effect.catchTag('PlatformError', (cause) =>
      Effect.fail(
        new ToolFailed({
          reason: `Could not move ${displayPath(resolved.cwd, from)} to ${displayPath(resolved.cwd, to)}: ${cause.message}`,
        }),
      ),
    ),
  );
  const moved = `${displayPath(resolved.cwd, from)} → ${displayPath(resolved.cwd, to)}`;
  return new Tool.ToolAnswer(
    `Moved ${moved}.${recordedSentence(kept)}`,
    { form: 'none', title: moved },
    { shown: [{ path: to, entry: true, as: 'wrote' }] },
  );
});

export function createRenameTool(options: ToolFactoryOptions): Tool {
  const resolved = resolveToolOptions(options);
  const { cwd, world } = resolved;
  const files = world.files;
  return Tool.make<typeof renameInputSchema, PreparedMove>({
    approval: ASKS_IN_REVIEW,
    description: DESCRIPTION_RENAME,
    refusals: REFUSALS,
    parameters: renameInputSchema,
    display: {
      streamFields: ['from', 'to'],
      project: (input) => ({
        form: 'none',
        title:
          input.from === undefined
            ? undefined
            : input.to === undefined
              ? displayPath(cwd, input.from)
              : `${displayPath(cwd, input.from)} → ${displayPath(cwd, input.to)}`,
      }),
    },
    claims: (input) => pathClaims(resolved, [input.from, input.to], 'write', true),
    prepare: Effect.fnUntraced(function* (input) {
      const from = yield* preparedPath(resolved, yield* namedPath('from', input.from), 'write', true);
      const to = yield* preparedPath(resolved, yield* namedPath('to', input.to), 'write', true);
      return { subjects: [from.subject, to.subject], prepared: { from: from.path, to: to.path } };
    }),
    execute: (params, call) =>
      files === undefined
        ? unboundTool('rename', 'filesystem')
        : runToolEffect(
            'rename',
            files,
            betweenPermits(
              cwd,
              call.prepared?.from.target ?? params.from,
              call.prepared?.to.target ?? params.to,
              inTurns(
                resolved.at(call.caller),
                [call.prepared?.from.target ?? params.from, call.prepared?.to.target ?? params.to],
                run(resolved.at(call.caller), params, call.prepared),
              ),
            ),
          ),
    mutates: true,
    confirmation: {
      prompt: (input) => ({ summary: `Move ${input.from} to ${input.to}?` }),
      prepare: (input) =>
        files === undefined
          ? unboundTool('rename', 'filesystem')
          : prepareToolEffect(
              files,
              Effect.gen(function* () {
                const to = yield* admitPreparedPath(resolved, (yield* preparedPath(resolved, input.to, 'write')).path, {
                  allowMissing: true,
                });
                const identity = yield* entryIdentity(to);
                return {
                  summary: `Move ${input.from} to ${input.to}?`,
                  consequence:
                    identity.kind === 'free'
                      ? 'The destination is free.'
                      : `Something already stands at ${displayPath(cwd, to)}; the move will refuse.`,
                };
              }),
            ),
      confirmLabel: 'Move',
    },
  });
}

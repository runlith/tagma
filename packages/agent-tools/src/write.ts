import * as path from 'node:path';
import { Effect, FileSystem, type PlatformError, Schema } from 'effect';
import type { PermissionSubject } from '@runlith/agent/permissions';
import { Tool } from '@runlith/agent/tool';
import { prepareToolEffect, runToolEffect, unboundTool } from './ToolEdge';
import { ToolFailed } from '@runlith/agent/tool';
import type { PreparedPath, ToolFactoryOptions } from './workspace';
import { admitPreparedPath, namedPath, pathClaims, preparedPath, resolveToolOptions, withNamedEntry } from './workspace/runtime';
import { binaryFile, fileCode, displayPath, filePatch } from './display';
import { aliasRefusal, entryIdentity, orAbsent, storedOf } from './namespace';
import { inTurn, recordedSentence, recording, recordingBytes } from './changed';
import { withoutAddedProse } from './prose';
import { bytesDigest, contentOf, withBom } from '@runlith/files/content';
import { DESCRIPTION_WRITE } from './descriptions';
import { REFUSALS, refused } from './refusals';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '@runlith/agent/permissions';

const writeInputSchema = Schema.Struct({
  path: Schema.String.annotate({
    description: 'The absolute path to the file to write (must be absolute, not relative)',
  }),
  content: Schema.optional(Schema.String.annotate({ description: 'The content to write to the file. Use either this or fromFile.' })),
  fromFile: Schema.optional(
    Schema.String.annotate({
      description: 'A file that already holds the content: its bytes are read now and written to path. Use either this or content.',
    }),
  ),
});

type Params = typeof writeInputSchema.Type;

type PreparedSource = PreparedPath & { readonly held: string };
type PreparedWrite = { readonly file: PreparedPath; readonly source: PreparedSource | null };

const readSource = Effect.fn('WriteTool.readSource')(function* (resolved: ReturnType<typeof resolveToolOptions>, source: string) {
  const fs = yield* FileSystem.FileSystem;
  return bytesDigest(yield* fs.readFile(source).pipe(unreadableSource(resolved, source)));
});

const BYTES_TWICE = 'Give content or fromFile, not both: one is the bytes themselves, the other the file already holding them.';

const writeBytes = Effect.fn('WriteTool.bytes')(function* (
  resolved: ReturnType<typeof resolveToolOptions>,
  params: Params,
  source: PreparedSource | null | undefined,
) {
  const { content, fromFile } = params;
  if (content !== undefined && fromFile !== undefined) {
    return yield* refused('call-shape', BYTES_TWICE);
  }
  if (content !== undefined) return new TextEncoder().encode(content);
  if (fromFile === undefined) {
    return yield* refused(
      'call-shape',
      'Nothing to write: pass content with the bytes, or fromFile with the path of a file that holds them.',
    );
  }
  const fs = yield* FileSystem.FileSystem;
  const target = yield* admitPreparedPath(resolved, source ?? undefined);
  const bytes = yield* fs.readFile(target).pipe(unreadableSource(resolved, target));
  if (source !== null && source !== undefined && bytesDigest(bytes) !== source.held) {
    return yield* refused(
      'file-changed',
      `${source.target} holds different bytes than the ones this call was allowed over. Call it again so the content is read and allowed together.`,
    );
  }
  return bytes;
});

const run = Effect.fn('WriteTool.execute')(function* (
  resolved: ReturnType<typeof resolveToolOptions>,
  params: Params,
  prepared: PreparedWrite | undefined,
) {
  const fs = yield* FileSystem.FileSystem;
  const filepath = yield* admitPreparedPath(resolved, prepared?.file, { allowMissing: true });
  const bytes = yield* writeBytes(resolved, params, prepared?.source);
  const identity = yield* entryIdentity(filepath);
  if (identity.kind === 'alias' || identity.kind === 'taken') {
    return yield* refused('aliased', aliasRefusal(resolved.cwd, filepath, storedOf(identity)));
  }
  const standing = yield* orAbsent(fs.readFile(filepath)).pipe(
    Effect.catchTag('PlatformError', (error) =>
      Effect.fail(
        new ToolFailed({
          reason: `Cannot tell what stands at ${displayPath(resolved.cwd, filepath)}: the filesystem answered ${error.reason._tag} reading it. Nothing was written.`,
        }),
      ),
    ),
  );
  const after = contentOf(bytes);
  yield* fs.makeDirectory(path.dirname(filepath), { recursive: true });
  const root = prepared?.file.resource?.root ?? resolved.cwd;
  const resource = prepared?.file.resource?.path;
  const wrote = standing !== undefined ? 'Wrote file successfully.' : 'Wrote file successfully. (created)';
  const shown = { shown: [{ path: filepath, as: 'wrote' as const }] };
  if (after.kind !== 'text') {
    const kept = yield* recordingBytes(resolved, filepath, standing, bytes, resource);
    return new Tool.ToolAnswer(`${wrote}${recordedSentence(kept)}`, binaryFile(root, filepath, bytes.byteLength), shown);
  }
  const before = standing === undefined ? undefined : contentOf(standing);
  const was = before?.kind === 'text' ? withBom(before) : '';
  const landing = yield* withoutAddedProse(resolved, filepath, was, withBom(after));
  const kept =
    before !== undefined && before.kind !== 'text'
      ? yield* recordingBytes(resolved, filepath, standing, new TextEncoder().encode(landing.text), resource)
      : yield* recording(resolved, 'write', filepath, {
          standing: standing === undefined ? { absent: true } : { bytes: standing },
          before: was,
          after: landing.text,
          resource,
        });
  return new Tool.ToolAnswer(
    `${wrote}${landing.sentence}${recordedSentence(kept)}`,
    before?.kind === 'text'
      ? filePatch(root, filepath, was, landing.text)
      : fileCode(root, filepath, landing.text, standing === undefined ? 'created' : 'wrote'),
    shown,
  );
});

const unreadableSource =
  (resolved: ReturnType<typeof resolveToolOptions>, target: string) =>
  <A, R>(read: Effect.Effect<A, PlatformError.PlatformError, R>): Effect.Effect<A, ToolFailed, R> =>
    read.pipe(
      Effect.catchTag('PlatformError', (error) => {
        const reason = `Cannot read ${displayPath(resolved.cwd, target)}, the file to copy from: the filesystem answered ${error.reason._tag}. Nothing was written.`;
        return Effect.fail(error.reason._tag === 'NotFound' ? refused('not-found', reason) : new ToolFailed({ reason }));
      }),
    );

export function createWriteTool(options: ToolFactoryOptions): Tool {
  const resolved = resolveToolOptions(options);
  const { cwd, world } = resolved;
  const files = world.files;
  const writeTool = Tool.make<typeof writeInputSchema, PreparedWrite>({
    approval: ASKS_IN_REVIEW,
    description: DESCRIPTION_WRITE,
    refusals: REFUSALS,
    parameters: writeInputSchema,
    display: {
      streamFields: ['path'],
      project: (input) => ({ form: 'none', title: input.path === undefined ? undefined : displayPath(cwd, input.path) }),
    },
    recovery: { content: 'content', destination: 'path' },
    claims: (input) =>
      Effect.map(
        Effect.all([
          pathClaims(resolved, [input.path], 'write'),
          pathClaims(resolved, input.fromFile === undefined ? [] : [input.fromFile], 'read'),
        ]),
        ([written, read]) => [...written, ...read],
      ),
    prepare: Effect.fnUntraced(function* (input) {
      if (input.content !== undefined && input.fromFile !== undefined) return yield* refused('call-shape', BYTES_TWICE);
      const file = yield* preparedPath(resolved, yield* namedPath('path', input.path), 'write');
      const source = input.fromFile === undefined ? null : yield* preparedPath(resolved, input.fromFile, 'read');
      const held = source === null || files === undefined ? '' : yield* prepareToolEffect(files, readSource(resolved, source.path.target));
      if (source === null) {
        const plain: PreparedWrite = { file: file.path, source: null };
        return { subjects: [file.subject] as readonly PermissionSubject[], prepared: plain };
      }
      const copy: PreparedWrite = { file: file.path, source: { ...source.path, held } };
      return { subjects: [file.subject, source.subject] as readonly PermissionSubject[], prepared: copy };
    }),
    execute: (params, call) =>
      files === undefined
        ? unboundTool('write', 'filesystem')
        : runToolEffect(
            'write',
            files,
            withNamedEntry(
              cwd,
              call.prepared?.file.resource?.path ?? call.prepared?.file.target ?? params.path,
              inTurn(
                resolved.at(call.caller),
                call.prepared?.file.resource?.path ?? call.prepared?.file.target ?? params.path,
                run(resolved.at(call.caller), params, call.prepared),
              ),
            ),
            call,
          ),
    mutates: true,
    confirmation: {
      prompt: (input) => ({ summary: `Write ${input.path}?` }),
      prepare: (input) =>
        files === undefined
          ? unboundTool('write', 'filesystem')
          : prepareToolEffect(
              files,
              Effect.gen(function* () {
                const fs = yield* FileSystem.FileSystem;
                const named = input.fromFile === undefined ? null : (yield* preparedPath(resolved, input.fromFile, 'read')).path;
                const source: PreparedSource | null =
                  named === null
                    ? null
                    : {
                        ...named,
                        held: bytesDigest(yield* fs.readFile(named.target).pipe(unreadableSource(resolved, named.target))),
                      };
                const filepath = yield* admitPreparedPath(resolved, (yield* preparedPath(resolved, input.path, 'write')).path, {
                  allowMissing: true,
                });
                const existing = yield* orAbsent(fs.readFile(filepath)).pipe(
                  Effect.catchTag('PlatformError', (error) =>
                    Effect.fail(
                      new ToolFailed({
                        reason: `Cannot tell what stands at ${displayPath(resolved.cwd, filepath)}: the filesystem answered ${error.reason._tag} reading it. Nothing was written.`,
                      }),
                    ),
                  ),
                );
                const bytes = yield* writeBytes(resolved, input, source);
                const content = contentOf(bytes);
                const before = existing === undefined ? undefined : contentOf(existing);
                return {
                  summary: `Write ${input.path}?`,
                  facts: [{ label: 'Content', value: content.kind === 'text' ? withBom(content) : `${bytes.byteLength} bytes · binary` }],
                  consequence:
                    existing === undefined
                      ? 'Creates a new file.'
                      : before?.kind === 'text'
                        ? `Replaces the existing ${withBom(before).split('\n').length}-line file.`
                        : `Replaces the existing ${existing.byteLength}-byte binary file.`,
                };
              }),
            ),
      confirmLabel: 'Write',
    },
  });
  return writeTool;
}

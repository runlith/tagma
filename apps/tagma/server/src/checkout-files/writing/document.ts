import { readFile, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { Clock, Effect, FileSystem, Result } from 'effect';
import { type ChangeSide, changeFrom } from '@runlith/files/change';
import { bytesDigest, contentDigest, contentOf, versionContentLimit, withBom } from '@runlith/files/content';
import { type LineHunk, workspaceChangeHunk } from '@runlith/files/hunk';
import { applyLineEdits } from '@runlith/files/lines';
import { replaced, type Standing } from '@runlith/files/replace';
import { Git } from '@runlith/git/Git';
import { normalizedAt } from '@runlith/git/working';
import { GateRefusal, type GitRefusal } from '../../platform/contract/wire/refusal.js';
import { gitRefusal } from '../../platform/git/readings.js';
import { Intake } from '../../change-record/contract/service/intake.js';
import { OPERATOR } from '../../workspace/contract/wire/checkout.js';
import type { ProjectRoot } from '../../workspace/contract/wire/coverage.js';
import type { Documents, FileRefusal, Save, Saved } from '../contract/service/documents.js';
import { textOf, type Current } from '../documents/current.js';
import { INLINE_CHARS } from '../documents/edits.js';
import type { OpenDocuments, Writing, Wrote } from '../documents/open.js';
import type { LooseFile, Targets } from '../tree/target.js';
import type { FilesWorker } from '../worker/client.js';
import { refusalOf, writeRefusal } from './refusals.js';

const INLINE_BYTES = 256 * 1024;

const BOM = '\uFEFF';

type Read = { readonly kind: 'absent' } | { readonly kind: 'file'; readonly bytes: Uint8Array };

type Refused = GateRefusal<FileRefusal>;

const codeOf = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;

const refuse = (code: FileRefusal, reason: string, unblock: string): Refused => new GateRefusal(code, reason, [unblock]);

const unread = (path: string, cause: unknown): Refused =>
  refuse('files', `${path} could not be read: ${String(cause)}`, 'read the report and retry');

const readAt = (path: string, shown: string): Effect.Effect<Read, Refused> =>
  Effect.flatMap(
    Effect.result(Effect.tryPromise({ try: () => stat(path), catch: (cause) => cause })),
    (found): Effect.Effect<Read, Refused> => {
      if (found._tag === 'Failure') {
        return codeOf(found.failure) === 'ENOENT' ? Effect.succeed({ kind: 'absent' } as const) : Effect.fail(unread(path, found.failure));
      }
      if (!found.success.isFile()) return Effect.fail(refuse('not-a-file', `${shown} is not a file`, 'save a file'));
      if (found.success.size > versionContentLimit) {
        return Effect.fail(refuse('too-large', `${shown} is larger than the change record keeps texts of`, 'edit it outside Tagma'));
      }
      return Effect.map(
        Effect.tryPromise({ try: () => readFile(path), catch: (cause) => unread(path, cause) }),
        (bytes) => ({ kind: 'file', bytes }) as const,
      );
    },
  );

const lineCount = (text: string): number => {
  let count = 1;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count += 1;
  return count;
};

const appliedOf = (save: Save, base: string): Result.Result<string, string> => {
  if ((save.edits === undefined) === (save.text === undefined)) return Result.fail('give exactly one of edits and text');
  if (save.edits !== undefined) return applyLineEdits(base, save.edits);
  return applyLineEdits(base, [
    { from: 0, to: lineCount(base.startsWith(BOM) ? base.slice(1) : base), lines: (save.text as string).split('\n') },
  ]);
};

const answered = (answer: Saved, wrote: Wrote | null = null): Writing<Saved> => ({ answer, wrote });

export const makeDocumentSaves = Effect.fnUntraced(function* (input: {
  readonly documents: OpenDocuments;
  readonly targets: Targets;
  readonly worker: FilesWorker;
}) {
  const intake = yield* Intake;
  const git = yield* Git;
  const files = yield* FileSystem.FileSystem;
  const { documents, targets, worker } = input;

  const ask = (question: Parameters<FilesWorker['ask']>[0]) =>
    Effect.mapError(worker.ask(question), (failure) =>
      refuse('worker-unavailable', failure.message, 'retry; the worker restarts on the next ask'),
    );

  const hashed = (bytes: Uint8Array): Effect.Effect<string, Refused> => {
    if (bytes.length <= INLINE_BYTES) return Effect.succeed(bytesDigest(bytes));
    return Effect.flatMap(ask({ kind: 'hash', bytes }), (reply) =>
      reply.kind === 'hashed'
        ? Effect.succeed(reply.digest)
        : Effect.fail(refuse('files', 'the worker answered another question', 'retry')),
    );
  };

  const changed = (
    before: string,
    after: string,
    normalized: boolean,
  ): Effect.Effect<{ readonly afterDigest: string; readonly hunk: LineHunk | undefined }, Refused> => {
    if (before.length + after.length <= INLINE_CHARS) {
      return Effect.succeed({ afterDigest: contentDigest(after), hunk: workspaceChangeHunk(before, after, normalized) });
    }
    return Effect.flatMap(ask({ kind: 'change', before, after, normalized }), (reply) =>
      reply.kind === 'changed'
        ? Effect.succeed({ afterDigest: reply.digest, hunk: reply.hunk ?? undefined })
        : Effect.fail(refuse('files', 'the worker answered another question', 'retry')),
    );
  };

  const normalized = (abs: string, before: string, after: string): Effect.Effect<boolean, GateRefusal<GitRefusal>> => {
    if (!before.includes('\r') && !after.includes('\r')) return Effect.succeed(false);
    const name = basename(abs);
    return Effect.map(Effect.mapError(normalizedAt(git, dirname(abs), [name]), gitRefusal), (ends) => ends.has(name));
  };

  const digestAt = (abs: string, shown: string): Effect.Effect<string | null, Refused> =>
    Effect.flatMap(readAt(abs, shown), (now) => (now.kind === 'absent' ? Effect.succeed(null) : hashed(now.bytes)));

  const prepare = Effect.fnUntraced(function* (abs: string, save: Save) {
    const read = yield* readAt(abs, save.path);
    const digest = read.kind === 'absent' ? null : yield* hashed(read.bytes);
    if (save.base !== digest) return { kind: 'done', writing: answered({ status: 'moved', digest }) } as const;
    const content = read.kind === 'absent' ? null : contentOf(read.bytes);
    if (content !== null && content.kind !== 'text') {
      return yield* refuse('not-text', `${save.path} is not UTF-8 text`, 'edit it outside Tagma');
    }
    const before = content === null ? '' : withBom(content);
    const applied = appliedOf(save, before);
    if (Result.isFailure(applied)) {
      return yield* refuse(
        'edits-invalid',
        `the edits do not apply to ${save.path}: ${applied.failure}`,
        'send line edits of the text the document feed sent',
      );
    }
    const after = applied.success;
    if (read.kind === 'file' && after === before) {
      return { kind: 'done', writing: answered({ status: 'ok', digest: digest as string, kept: false, unconfirmed: null }) } as const;
    }
    const bytes = new TextEncoder().encode(after);
    if (bytes.length > versionContentLimit) {
      return yield* refuse('too-large', `${save.path} would be larger than the change record keeps texts of`, 'save less text');
    }
    const standing: Standing = read.kind === 'absent' ? { absent: true } : { bytes: read.bytes };
    const was: Current =
      content === null || digest === null ? { kind: 'gone' } : textOf(digest, content.text, read.kind === 'file' ? read.bytes.length : 0);
    return { kind: 'write', read, digest, before, after, bytes, standing, was } as const;
  });

  const loose = Effect.fnUntraced(function* (abs: string, save: Save) {
    const prepared = yield* prepare(abs, save);
    if (prepared.kind === 'done') return prepared.writing;
    const { after, bytes, standing, was } = prepared;
    const afterDigest = yield* hashed(bytes);
    const wrote = yield* replaced(abs, standing, bytes).pipe(
      Effect.provideService(FileSystem.FileSystem, files),
      Effect.mapError((failure) => writeRefusal(abs, failure)),
    );
    if (!wrote) return answered({ status: 'moved', digest: yield* digestAt(abs, save.path) });
    return answered(
      { status: 'ok', digest: afterDigest, kept: false, unconfirmed: null },
      { before: was, after: textOf(afterDigest, after.startsWith(BOM) ? after.slice(1) : after, bytes.length, save.write) },
    );
  });

  const attempt = Effect.fnUntraced(function* (place: ProjectRoot, abs: string, save: Save) {
    const prepared = yield* prepare(abs, save);
    if (prepared.kind === 'done') return prepared.writing;
    const { read, digest, before, after, bytes, standing, was } = prepared;
    const inGit = yield* normalized(abs, before, after);
    const { afterDigest, hunk } = yield* changed(before, after, inGit);
    const beforeSide: ChangeSide = {
      digest: digest ?? contentDigest(''),
      text: before,
      bytes: read.kind === 'absent' ? 0 : read.bytes.length,
    };
    const fact = changeFrom(
      read.kind === 'absent' ? 'write' : 'edit',
      abs,
      new Date(yield* Clock.currentTimeMillis),
      beforeSide,
      { digest: afterDigest, text: after, bytes: bytes.length },
      hunk,
    );
    const landed = yield* intake.land(
      { projectId: place.projectId, holder: OPERATOR },
      [fact],
      replaced(abs, standing, bytes).pipe(
        Effect.provideService(FileSystem.FileSystem, files),
        Effect.mapError((failure) => writeRefusal(abs, failure)),
      ),
    );
    if (landed._tag === 'moved') return answered({ status: 'moved', digest: yield* digestAt(abs, save.path) });
    return answered(
      {
        status: 'ok',
        digest: afterDigest,
        kept: landed._tag === 'written' ? landed.kept : true,
        unconfirmed: landed._tag === 'unconfirmed' ? landed.reason : null,
      },
      { before: was, after: textOf(afterDigest, after.startsWith(BOM) ? after.slice(1) : after, bytes.length, save.write) },
    );
  });

  const save: Documents['Service']['save'] = Effect.fn('Documents.save')(function* (place, save) {
    yield* Effect.annotateCurrentSpan({ path: save.path });
    const target = yield* targets.of(place, save.path, 'follow');
    return yield* intake
      .turn(place.projectId, [target.abs], documents.holding(place, target, attempt(place, target.abs, save)))
      .pipe(Effect.mapError(refusalOf));
  });

  return {
    save,

    saveLoose: (file: LooseFile, save: Save): Effect.Effect<Saved, Refused> =>
      documents.holdingLoose(file, loose(file.abs, save)).pipe(Effect.withSpan('Documents.saveLoose', { attributes: { path: file.abs } })),
  };
});

import { lstat, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Effect } from 'effect';
import { contentDigest } from '@runlith/files/content';
import { Git } from '@runlith/git/Git';
import { filesUnder } from '@runlith/git/entries';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { gitRefusal } from '../../platform/git/readings.js';
import { Intake, type IntakeFact } from '../../change-record/contract/service/intake.js';
import { OPERATOR } from '../../workspace/contract/wire/checkout.js';
import type { EntryRefusal } from '../contract/service/entries.js';
import type { FilesWorker } from '../worker/client.js';
import { refusalOf, writeRefusal } from '../writing/refusals.js';

const DIGEST_BATCH = 200;

export const EMPTY = contentDigest('');

export type Refused = GateRefusal<EntryRefusal>;

export const refuse = (code: EntryRefusal, reason: string, unblock: string): Refused => new GateRefusal(code, reason, [unblock]);

export type Kind = 'file' | 'directory' | 'link';

export const codeOf = (cause: unknown): string | undefined =>
  typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;

const said = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export const fsAct = <A>(path: string, act: () => Promise<A>): Effect.Effect<A, Refused> =>
  Effect.tryPromise({ try: act, catch: (cause) => writeRefusal(path, { message: said(cause) }) });

export const kindAt = (path: string): Effect.Effect<Kind | null, Refused> =>
  Effect.flatMap(Effect.result(Effect.tryPromise({ try: () => lstat(path), catch: (cause) => cause })), (read) => {
    if (read._tag === 'Success') {
      const entry = read.success;
      return Effect.succeed(entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : 'file');
    }
    const code = codeOf(read.failure);
    if (code === 'ENOENT') return Effect.succeed(null);
    if (code === 'ENOTDIR')
      return Effect.fail(refuse('not-a-directory', `a file stands on the way to ${path}`, 'name a path through directories'));
    return Effect.fail(refuse('files', `${path} could not be read: ${String(read.failure)}`, 'read the report and retry'));
  });

export const parentsOf = (path: string): Effect.Effect<void, Refused> =>
  Effect.flatMap(kindAt(dirname(path)), (kind) =>
    kind === 'directory'
      ? Effect.void
      : kind === null
        ? Effect.asVoid(fsAct(path, () => mkdir(dirname(path), { recursive: true })))
        : Effect.fail(refuse('not-a-directory', `${dirname(path)} is not a directory`, 'name a path through directories')),
  );

export const moved = (from: string, to: string): Effect.Effect<void, Refused> =>
  Effect.tryPromise({
    try: () => rename(from, to),
    catch: (cause) =>
      codeOf(cause) === 'EXDEV'
        ? refuse('cross-device', `${from} and ${to} are on different volumes`, 'move it within one volume, or copy it outside Tagma')
        : writeRefusal(from, { message: said(cause) }),
  });

export const underneath = (path: string, parent: string): boolean => path === parent || path.startsWith(`${parent}/`);

export const outermost = (paths: readonly string[]): readonly string[] => {
  const sorted = [...new Set(paths)].sort();
  const kept: string[] = [];
  for (const path of sorted) if (!kept.some((parent) => underneath(path, parent))) kept.push(path);
  return kept;
};

export const undone = (original: Refused, left: readonly string[]): Refused =>
  left.length === 0
    ? original
    : refuse(
        original.code,
        `${original.reason}; these could not be put back and stand where the act left them: ${left.join(', ')}`,
        'move them back by hand, then retry',
      );

export const makeEntryRecord = Effect.fnUntraced(function* (input: { readonly worker: FilesWorker }) {
  const intake = yield* Intake;
  const git = yield* Git;
  const { worker } = input;

  return {
    committable: (root: string, relatives: readonly string[]): Effect.Effect<readonly string[], Refused> =>
      relatives.length === 0 ? Effect.succeed([]) : Effect.mapError(filesUnder(git, root, relatives, { others: true }), gitRefusal),

    digests: Effect.fnUntraced(function* (held: readonly string[]) {
      const batches: (readonly string[])[] = [];
      for (let at = 0; at < held.length; at += DIGEST_BATCH) batches.push(held.slice(at, at + DIGEST_BATCH));
      const found = new Map<string, string>();
      for (const batch of batches) {
        const reply = yield* Effect.mapError(worker.ask({ kind: 'digest', paths: batch }), (failure) =>
          refuse('worker-unavailable', failure.message, 'retry; the worker restarts on the next ask'),
        );
        if (reply.kind !== 'digested') return yield* refuse('worker-unavailable', 'the worker answered another question', 'retry');
        for (const [at, digest] of reply.digests.entries()) {
          if (digest === null) continue;
          if (typeof digest !== 'string')
            return yield* refuse('files', `${batch[at]} could not be read: ${digest.unread}`, 'read the report and retry');
          found.set(batch[at] as string, digest);
        }
      }
      return found;
    }),

    turns: <A, R>(projectId: number, held: readonly string[], work: Effect.Effect<A, Refused, R>): Effect.Effect<A, Refused, R> =>
      Effect.mapError(intake.turn(projectId, held, work, 'entry'), refusalOf),

    land: (
      projectId: number,
      facts: readonly IntakeFact[],
      write: Effect.Effect<boolean, Refused>,
      lost: () => Refused,
    ): Effect.Effect<string | null, Refused> =>
      intake
        .land(
          { projectId, holder: OPERATOR },
          facts.map((fact) => ({ ...fact, target: 'entry' })),
          write,
        )
        .pipe(
          Effect.mapError(refusalOf),
          Effect.flatMap((landed) =>
            landed._tag === 'moved' ? Effect.fail(lost()) : Effect.succeed(landed._tag === 'unconfirmed' ? landed.reason : null),
          ),
        ),
  };
});

export type EntryRecord = Effect.Success<ReturnType<typeof makeEntryRecord>>;

import { workerLink } from '@runlith/utils/worker';
import { Data, Effect } from 'effect';

type Known = { readonly stamp: string; readonly digest: string | null };

export type DigestAsk = {
  readonly id: number;
  readonly root: string;
  readonly paths: readonly string[];
  readonly known: Known | null;
};

export type DigestAnswer =
  | { readonly id: number; readonly stamp: string; readonly digest: string | null }
  | { readonly id: number; readonly failed: string };

class DigestUnread extends Data.TaggedError('DigestUnread')<{ readonly root: string; readonly reason: string }> {
  override get message(): string {
    return `the files of ${this.root} could not be hashed: ${this.reason}`;
  }
}

type DigestPurpose = 'outputs' | 'process' | 'sources' | 'asked' | 'revision';

type Held = Known & { readonly paths: readonly string[] };

const same = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((path, at) => path === right[at]);

export const makeDigests = Effect.gen(function* () {
  const link = yield* Effect.acquireRelease(
    Effect.sync(() =>
      workerLink<DigestAsk, DigestAnswer>(
        'plugin digest worker',
        () => new Worker(new URL('./digest.worker.ts', import.meta.url), { type: 'module' }),
      ),
    ),
    (standing) => standing.shutdown('the plugins closed'),
  );
  const held = new Map<string, Held>();

  const digest = Effect.fn('PluginDigests.digest')(function* (root: string, paths: readonly string[], purpose: DigestPurpose) {
    const key = `${purpose}\u0000${root}`;
    const standing = held.get(key);
    const known = standing !== undefined && same(standing.paths, paths) ? standing : null;
    const answer = yield* link
      .ask((id) => ({ id, root, paths, known: known === null ? null : { stamp: known.stamp, digest: known.digest } }))
      .pipe(
        Effect.retry({ times: 1 }),
        Effect.mapError((gone) => new DigestUnread({ root, reason: gone.reason })),
      );
    if ('failed' in answer) return yield* new DigestUnread({ root, reason: answer.failed });
    held.set(key, { paths, stamp: answer.stamp, digest: answer.digest });
    return answer.digest;
  });

  const forget = (root: string): void => {
    for (const purpose of ['outputs', 'process', 'sources', 'asked', 'revision'] satisfies DigestPurpose[])
      held.delete(`${purpose}\u0000${root}`);
  };

  return { digest, forget };
});

export type Digests = Effect.Success<typeof makeDigests>;

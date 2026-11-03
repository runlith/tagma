import { Effect, Stream } from 'effect';
import { workerLink, type WorkerUnavailable } from '@runlith/utils/worker';
import type { Digest } from '@runlith/executions/protocol/artifact';
import type { ProofAsk, ProofAnswer } from '../contract/wire/proof.js';

const proof = workerLink<ProofAsk, ProofAnswer>(
  'installation proof worker',
  () => new Worker(new URL('./proof.worker.ts', import.meta.url), { type: 'module' }),
);

export const decodeProof = (root: string, text: string) => proof.ask((id) => ({ id, _tag: 'Decode', root, text }));

export const streamedProof = Effect.fn('installation.hash')(function* <E>(
  stream: Stream.Stream<Uint8Array, E>,
): Effect.fn.Return<{ readonly bytes: number; readonly digest: Digest }, E | WorkerUnavailable> {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const opened = yield* Effect.acquireRelease(
        proof.ask((id) => ({ id, _tag: 'Begin' })),
        (answer) =>
          Effect.sync(() => {
            if (answer._tag === 'Begun') proof.tell({ id: 0, _tag: 'Drop', session: answer.session } satisfies ProofAsk);
          }),
      );
      if (opened._tag !== 'Begun') return yield* Effect.die('the installation proof worker did not open a hash');
      const session = opened.session;
      yield* Stream.runForEach(stream, (bytes) => proof.ask((id) => ({ id, _tag: 'Chunk', session, bytes })));
      const answer = yield* proof.ask((id) => ({ id, _tag: 'End', session }));
      if (answer._tag !== 'Hashed') return yield* Effect.die('the installation proof worker did not finish a hash');
      return { bytes: answer.bytes, digest: answer.digest };
    }),
  );
});

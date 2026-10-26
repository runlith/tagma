import { Effect } from 'effect';
import type { Keyed } from '../../keyed';
import type { ThreadBorderFailed, ThreadPortFailure } from '../../ThreadBorder';
import { ThreadStorageFailed } from '../../persisted';
import type { ThreadTx, ThreadWriteTx } from '../../ThreadPorts';
import { ThreadActReusedError, type ThreadTransitionStorage } from '../../transition/port';
import { decodeRecord, isRefusal, refusalFailure, type KeyedAnswer, type KeyedRecord } from './answers';

export class Claim {
  private found: KeyedRecord | null = null;

  constructor(
    private readonly transitions: ThreadTransitionStorage<ThreadTx, ThreadWriteTx>,
    private readonly threadId: string,
    private readonly admitted: Keyed | undefined,
  ) {}

  get check(): ((tx: ThreadWriteTx) => Effect.Effect<boolean, ThreadPortFailure>) | undefined {
    const admitted = this.admitted;
    if (admitted === undefined) return undefined;
    return (tx) =>
      Effect.flatMap(
        this.transitions.readRecord(this.threadId, admitted.evidence, tx),
        (reading): Effect.Effect<boolean, ThreadPortFailure> => {
          if (reading.kind !== 'present') return Effect.succeed(true);
          if (reading.digest !== admitted.digest) {
            return Effect.fail(new ThreadActReusedError({ threadId: this.threadId, evidence: admitted.evidence }));
          }
          const record = decodeRecord(reading.result);
          if (record === null) {
            return Effect.fail(
              new ThreadStorageFailed({
                call: 'claim',
                cause: new Error(`Thread ${this.threadId}: the record under this key holds no answer a claim can replay.`),
              }),
            );
          }
          this.found = record;
          return Effect.succeed(false);
        },
      );
  }

  record(answer: KeyedAnswer, tx: ThreadWriteTx): Effect.Effect<void, ThreadPortFailure> {
    const admitted = this.admitted;
    if (admitted === undefined) return Effect.void;
    return this.transitions.writeRecord(this.threadId, admitted.evidence, { digest: admitted.digest, result: answer }, tx);
  }

  replayed(): Effect.Effect<KeyedAnswer | null, ThreadBorderFailed> {
    const found = this.found;
    if (found === null) return Effect.succeed(null);
    return isRefusal(found) ? Effect.fail(refusalFailure(found)) : Effect.succeed(found);
  }
}

import { Deferred, Effect } from 'effect';
import type { Judged } from '../contract/service/holdings.js';

export type Request = readonly [path: string, answer: Deferred.Deferred<Judged | null>];

export class Requests {
  private pending = new Map<string, Deferred.Deferred<Judged | null>[]>();

  private answering = new Map<string, Deferred.Deferred<Judged | null>[]>();

  get empty(): boolean {
    return this.pending.size === 0 && this.answering.size === 0;
  }

  admit(paths: readonly string[]): readonly Request[] {
    return paths.map((path) => {
      const answer = Deferred.makeUnsafe<Judged | null>();
      this.pending.set(path, [...(this.pending.get(path) ?? []), answer]);
      return [path, answer] as const;
    });
  }

  begin(paths: readonly string[]): void {
    for (const path of paths) {
      this.answering.set(path, this.pending.get(path) ?? []);
      this.pending.delete(path);
    }
  }

  defer(paths: readonly string[]): void {
    for (const path of paths) {
      const owed = this.answering.get(path);
      if (owed === undefined) continue;
      this.answering.delete(path);
      if (owed.length > 0) this.pending.set(path, [...owed, ...(this.pending.get(path) ?? [])]);
    }
  }

  wait(requests: readonly Request[]): Effect.Effect<ReadonlyMap<string, Judged>> {
    const answered = new Map<string, Judged>();
    return Effect.as(
      Effect.forEach(
        requests,
        ([path, answer]) =>
          Effect.map(Deferred.await(answer), (judged) => {
            if (judged !== null) answered.set(path, judged);
          }),
        { discard: true },
      ),
      answered,
    );
  }

  answer(path: string, judged: Judged | null): Effect.Effect<void> {
    const owed = this.answering.get(path) ?? [];
    this.answering.delete(path);
    return Effect.forEach(owed, (answer) => Deferred.succeed(answer, judged), { discard: true });
  }

  fail(): Effect.Effect<void> {
    const waiting = [this.answering, this.pending];
    this.answering = new Map();
    this.pending = new Map();
    return Effect.gen(function* () {
      for (const queue of waiting) for (const owed of queue.values()) for (const answer of owed) yield* Deferred.succeed(answer, null);
    });
  }
}

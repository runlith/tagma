import { Cause, Effect, Exit } from 'effect';
import type { EscapeNotice, FileSubject } from '../contract/wire/checks.js';
import { checkoutKey } from '../checkout.js';
import type { RemeasureGraph } from './driver.js';
import { fileCheck } from './rule.js';

type EditChecks = {
  readonly graphOf: RemeasureGraph;
  readonly delay: number;
  readonly fork: (effect: Effect.Effect<void>) => void;
  readonly tell: (notice: EscapeNotice) => Effect.Effect<void>;
};

export const editChecks = ({ graphOf, delay, fork, tell }: EditChecks) => {
  const edits = new Map<string, { readonly subject: FileSubject; readonly paths: Set<string> }>();
  return (op: string, subject: FileSubject): Effect.Effect<void> =>
    Effect.sync(() => {
      const key = `${checkoutKey(subject)}\0${op}\0${subject.caller?._tag === 'Thread' ? subject.caller.threadId : ''}`;
      const waiting = edits.get(key);
      if (waiting !== undefined) {
        for (const path of subject.paths) waiting.paths.add(path);
        return;
      }
      edits.set(key, { subject, paths: new Set(subject.paths) });
      fork(
        Effect.gen(function* () {
          yield* Effect.sleep(delay);
          const held = edits.get(key);
          edits.delete(key);
          if (held === undefined) return;
          const gathered = { ...held.subject, paths: [...held.paths].sort() };
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const opened = yield* Effect.exit(graphOf(gathered.projectId, gathered.root));
            if (Exit.isSuccess(opened)) {
              const checked = yield* Effect.exit(Effect.provide(fileCheck(op, gathered), opened.value));
              if (Exit.isFailure(checked)) {
                yield* Effect.logWarning(`the rules triggered after ${op} could not run; the edit was not checked`, {
                  checkout: subject.root,
                  paths: gathered.paths,
                  cause: Cause.pretty(checked.cause),
                });
                return;
              }
              for (const notice of checked.value) {
                const delivered = yield* Effect.exit(tell(notice));
                if (Exit.isFailure(delivered))
                  yield* Effect.logWarning(`a crossing found after ${op} could not be told to its holder`, {
                    checkout: subject.root,
                    cause: Cause.pretty(delivered.cause),
                  });
              }
              return;
            }
            yield* Effect.logWarning(
              attempt + 1 < 3
                ? `the graph for rules triggered after ${op} did not open; another reading is scheduled`
                : `the graph for rules triggered after ${op} did not open after three attempts; the edit was not checked`,
              { checkout: subject.root, paths: gathered.paths, cause: Cause.pretty(opened.cause) },
            );
            if (attempt + 1 < 3) yield* Effect.sleep(delay);
          }
        }).pipe(Effect.scoped),
      );
    });
};

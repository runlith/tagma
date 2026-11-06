import { workerLink } from '@runlith/utils/worker';
import { Data, Effect, FiberMap } from 'effect';
import type { CompileAnswer, CompileAsk, CompileCancel } from './compile.js';

export class ViewsUnprepared extends Data.TaggedError('ViewsUnprepared')<{
  readonly reason: string;
  readonly file: string | null;
  readonly moved: boolean;
}> {
  override get message(): string {
    return this.reason;
  }
}

export const unprepared = (reason: string, file: string | null = null) => Effect.fail(new ViewsUnprepared({ reason, file, moved: false }));

const IDLE = '5 minutes';

export const makeCompiler = Effect.gen(function* () {
  const resting = yield* FiberMap.make<'idle'>();
  const link = yield* Effect.acquireRelease(
    Effect.sync(() =>
      workerLink<CompileAsk, CompileAnswer>(
        'view compile worker',
        () => new Worker(new URL('./compile.worker.ts', import.meta.url), { type: 'module' }),
      ),
    ),
    (standing) => standing.shutdown('the plugin views closed'),
  );
  let asking = 0;

  const compiled = Effect.fn('PluginViews.compile')(function* (ask: (id: number) => CompileAsk) {
    asking += 1;
    yield* FiberMap.remove(resting, 'idle');
    let asked: number | null = null;
    const answer = yield* link
      .ask((id) => {
        asked = id;
        return ask(id);
      })
      .pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            if (asked !== null) link.tell({ kind: 'cancel', id: asked } satisfies CompileCancel);
          }),
        ),
        Effect.ensuring(
          Effect.suspend(() => {
            asking -= 1;
            return asking > 0
              ? Effect.void
              : FiberMap.run(resting, 'idle', Effect.sleep(IDLE).pipe(Effect.andThen(Effect.sync(() => link.close('it rested')))));
          }),
        ),
        Effect.catchTag('WorkerUnavailable', (gone) => unprepared(gone.message)),
      );
    return answer.ok ? answer : yield* new ViewsUnprepared({ reason: answer.message, file: answer.file, moved: answer.moved });
  });

  return { compiled };
});

export type Compiler = Effect.Success<typeof makeCompiler>;

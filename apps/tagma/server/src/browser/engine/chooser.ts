import { type CdpEvent, eventParams, type Session } from '@runlith/cdp/session';
import { Effect, PubSub, Semaphore } from 'effect';

type FileChoice = { readonly node: number; readonly child: string | undefined; readonly multiple: boolean };
type Pending = { choice: FileChoice | null };

export const makeChooser = Effect.fnUntraced(function* (session: Session) {
  const counts = new Map<string, number>();
  const lock = yield* Semaphore.make(1);
  const changes = yield* Effect.acquireRelease(PubSub.unbounded<FileChoice | null>(), PubSub.shutdown);
  let current: FileChoice | null = null;
  let pending: Pending | null = null;

  const intercept = (child?: string) =>
    Effect.acquireRelease(
      lock.withPermits(1)(
        Effect.gen(function* () {
          const key = child ?? '';
          const count = counts.get(key) ?? 0;
          if (count === 0) yield* session.send('Page.setInterceptFileChooserDialog', { enabled: true }, child);
          counts.set(key, count + 1);
        }),
      ),
      () =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const key = child ?? '';
            const count = counts.get(key) ?? 0;
            if (count > 1) {
              counts.set(key, count - 1);
              return;
            }
            counts.delete(key);
            yield* session.post('Page.setInterceptFileChooserDialog', { enabled: false }, child);
          }),
        ),
    );

  return {
    changes,
    current: () => current,
    intercept,
    arm: Effect.fnUntraced(function* (children: readonly string[]) {
      yield* intercept();
      for (const child of children) yield* intercept(child);
      return yield* Effect.acquireRelease(
        Effect.sync(() => {
          const next: Pending = { choice: null };
          pending = next;
          return next;
        }),
        () =>
          Effect.sync(() => {
            pending = null;
          }),
      );
    }),
    arrive: Effect.fnUntraced(function* (event: CdpEvent) {
      const opened = yield* eventParams('Page.fileChooserOpened', event);
      if (opened.backendNodeId === undefined) return yield* Effect.logWarning('browser: the file chooser has no input node');
      const choice: FileChoice = { node: opened.backendNodeId, child: event.child, multiple: opened.mode === 'selectMultiple' };
      if (pending !== null) {
        pending.choice = choice;
        return;
      }
      current = choice;
      yield* PubSub.publish(changes, choice);
    }),
    take: Effect.fnUntraced(function* () {
      const choice = current;
      current = null;
      if (choice !== null) yield* PubSub.publish(changes, null);
      return choice;
    }),
    supply: (choice: FileChoice, files: readonly string[]) =>
      session.send('DOM.setFileInputFiles', { files: [...files], backendNodeId: choice.node }, choice.child),
  };
});

export type Chooser = Effect.Success<ReturnType<typeof makeChooser>>;

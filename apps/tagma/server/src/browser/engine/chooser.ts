import { type CdpEvent, eventParams, type Session } from '@runlith/cdp/session';
import { Deferred, Effect, PubSub, Semaphore } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { PageId } from '../contract/wire/ids.js';

type FileChoice = { readonly node: number; readonly child: string | undefined; readonly multiple: boolean };
type FileField = { readonly node: number; readonly child: string | undefined };
type Pending = {
  readonly stamp: number | undefined;
  readonly expected: FileField | null;
  readonly ready: Deferred.Deferred<FileChoice | null>;
  active: boolean;
  choice: FileChoice | null;
  supplied: boolean;
};

export const makeChooser = Effect.fnUntraced(function* (session: Session, page: PageId, operated: () => number | undefined) {
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
    arm: Effect.fnUntraced(function* (children: readonly string[], expected: FileField | null) {
      const stamp = operated();
      yield* intercept();
      for (const child of children) yield* intercept(child);
      const ready = yield* Deferred.make<FileChoice | null>();
      const next = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const next: Pending = { stamp, expected, ready, active: false, choice: null, supplied: false };
          pending = next;
          return next;
        }),
        (next) =>
          Effect.gen(function* () {
            if (pending === next) pending = null;
            if (next.choice === null || next.supplied || current !== null) return;
            current = next.choice;
            yield* PubSub.publish(changes, current);
          }),
      );
      const check = Effect.suspend(() =>
        next.stamp === operated()
          ? Effect.void
          : Effect.fail(
              new GateRefusal(
                'operator-input',
                `operator input interrupted the upload on page ${page}; its chooser remains with the operator`,
                ['snapshot_page — read the page again before uploading'],
              ),
            ),
      );
      return {
        check,
        begin: Effect.gen(function* () {
          yield* check;
          if (current !== null)
            return yield* new GateRefusal('action-failed', 'the page has an unanswered operator file chooser', [
              'answer the file chooser before uploading',
            ]);
          next.active = true;
        }),
        wait: Deferred.await(ready),
        choice: () => next.choice,
      };
    }),
    arrive: Effect.fnUntraced(function* (event: CdpEvent) {
      const opened = yield* eventParams('Page.fileChooserOpened', event);
      if (opened.backendNodeId === undefined) return yield* Effect.logWarning('browser: the file chooser has no input node');
      const choice: FileChoice = { node: opened.backendNodeId, child: event.child, multiple: opened.mode === 'selectMultiple' };
      const next = pending;
      if (
        next !== null &&
        next.active &&
        next.stamp === operated() &&
        (next.expected === null || (next.expected.node === choice.node && next.expected.child === choice.child))
      ) {
        next.choice = choice;
        yield* Deferred.succeed(next.ready, choice);
        return;
      }
      current = choice;
      yield* PubSub.publish(changes, choice);
      if (next !== null) yield* Deferred.succeed(next.ready, null);
    }),
    take: Effect.fnUntraced(function* () {
      const choice = current;
      current = null;
      if (choice !== null) yield* PubSub.publish(changes, null);
      return choice;
    }),
    supply: Effect.fnUntraced(function* (choice: FileChoice, files: readonly string[]) {
      yield* session.send('DOM.setFileInputFiles', { files: [...files], backendNodeId: choice.node }, choice.child);
      if (pending?.choice === choice) pending.supplied = true;
    }),
  };
});

export type Chooser = Effect.Success<ReturnType<typeof makeChooser>>;

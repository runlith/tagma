import { randomUUID } from 'node:crypto';
import { Clock, Effect, Exit, FileSystem, Path } from 'effect';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { hostRefusal, Pages } from '../contract/service/pages.js';
import { BrowserPlace, capturesOf } from '../contract/service/place.js';
import type { PageId } from '../contract/wire/ids.js';
import type { Analysis } from './analysis.js';
import type { Drive } from './drive.js';
import { holdStrain } from './emulate.js';
import { unknownPage } from './refusal.js';

const KEPT = 4;
const EXTENSION = '.heapsnapshot';

const failed = (reason: string, file: string | null) =>
  new GateRefusal(
    'heap-failed',
    `the page heap was not captured: ${reason}`,
    file === null
      ? ['capture_page with what: heap again']
      : [`the snapshot stays at ${file}; Chrome DevTools opens it`, 'capture_page with what: heap again'],
  );

export const makeHeap = Effect.fnUntraced(function* (input: { readonly drive: Drive; readonly analysis: Analysis }) {
  const { drive, analysis } = input;
  const pages = yield* Pages;
  const files = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const place = yield* BrowserPlace;

  return Effect.fn('Automation.heap')(function* (page: PageId, limit: number, thread: string | null) {
    return yield* drive
      .drive(
        page,
        thread,
        (_state, attached) =>
          Effect.gen(function* () {
            const dir = path.join(capturesOf(path, place, page), 'heap');
            yield* files.makeDirectory(dir, { recursive: true, mode: 0o700 });
            const entries = yield* files.readDirectory(dir);
            const names = entries.filter((name) => name.endsWith(EXTENSION)).sort();
            const sidecars = new Set(entries.filter((name) => name.endsWith(`${EXTENSION}.json`)));
            const previous = names.filter((name) => sidecars.has(`${name}.json`)).at(-1);
            const file = path.join(dir, `${yield* Clock.currentTimeMillis}-${randomUUID()}${EXTENSION}`);
            const partial = `${file}.partial`;
            let written = false;
            const captured = Effect.gen(function* () {
              yield* files.writeFile(partial, new Uint8Array(), { mode: 0o600 });
              const pausedMs = yield* Effect.scoped(
                Effect.gen(function* () {
                  yield* holdStrain(attached, { factor: 1, paused: true }).pipe(Effect.provideService(Pages, pages));
                  const host = yield* pages.hold(page);
                  const started = yield* Clock.currentTimeMillis;
                  const lost = Effect.flatMap(attached.session.ended, (end) =>
                    end === 'lost' ? Effect.fail(failed('the browser host was lost', null)) : Effect.never,
                  );
                  yield* Effect.raceFirst(host.pages.heap(page, partial), lost).pipe(
                    Effect.catchTags({
                      PageMissing: () => Effect.fail(unknownPage(page)),
                      HostLost: (failure) => Effect.fail(hostRefusal(failure)),
                      HostRefused: (failure) => Effect.fail(hostRefusal(failure)),
                    }),
                  );
                  return (yield* Clock.currentTimeMillis) - started;
                }).pipe(Effect.uninterruptible),
              );
              yield* files.rename(partial, file);
              written = true;
              const bytes = Number((yield* files.stat(file)).size);
              const removed = names.slice(0, Math.max(0, names.length + 1 - KEPT)).map((name) => path.join(dir, name));
              for (const old of removed) {
                yield* files.remove(old, { force: true });
                yield* files.remove(`${old}.json`, { force: true });
              }
              const report = yield* analysis
                .heap(file, {
                  previous: previous === undefined ? undefined : path.join(dir, `${previous}.json`),
                  sidecar: `${file}.json`,
                  limit,
                })
                .pipe(Effect.catchTag('HeapUnreadable', (failure) => Effect.fail(failed(failure.message, file))));
              return {
                ...report,
                page: pages.glance(page, false),
                path: file,
                bytes,
                pausedMs,
                previous: previous === undefined ? null : path.join(dir, previous),
                removed,
              };
            });
            return yield* captured.pipe(
              Effect.onExit((exit) =>
                Exit.isFailure(exit) && !written
                  ? files
                      .remove(partial, { force: true })
                      .pipe(
                        Effect.catchTag('PlatformError', (failure) =>
                          Effect.logWarning(`browser: a partial heap snapshot was not removed: ${failure.message}`),
                        ),
                      )
                  : Effect.void,
              ),
            );
          }),
        { replays: false },
      )
      .pipe(Effect.catchTag('PlatformError', (failure) => Effect.fail(failed(failure.message, null))));
  });
});

import { it } from '@runlith/effect-test';
import { Data, Deferred, Effect, Schema, type Scope } from 'effect';
import type { BrowserContextOptions } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { onFailure, recorded } from './artifacts.ts';
import { session, type ElectronLaunch, type Lane, type Session } from './engines.ts';

export type BrowserTest = Session & { readonly artifacts: string };
export type Options = { readonly lanes?: readonly Lane[]; readonly context?: BrowserContextOptions; readonly electron?: ElectronLaunch };

const selected = (options: Options): readonly Lane[] => {
  const filter = process.env.E2E_LANES?.split(',');
  return (options.lanes ?? ['chromium']).filter((lane) => filter === undefined || filter.includes(lane));
};

const PageException = Schema.Struct({ name: Schema.String, message: Schema.String, stack: Schema.String });
class PageFailed extends Data.TaggedError('PageFailed')<{ readonly message: string }> {}
const errorScript = `(() => {
  const report = (error) => {
    if (!(error instanceof Error)) return;
    void globalThis.__runlithE2eError({ name: error.name, message: error.message, stack: error.stack ?? '' });
  };
  addEventListener('error', (event) => report(event.error));
  addEventListener('unhandledrejection', (event) => report(event.reason));
})()`;

const prepared = Effect.fn('e2e.recording')(function* (lane: Lane, options: Options, artifacts: string) {
  const fixture = yield* session(lane, options.context, {}, options.electron);
  const failed = yield* Deferred.make<never, PageFailed>();
  yield* Effect.promise(() =>
    fixture.context.exposeBinding('__runlithE2eError', (_source, value: unknown) => {
      const error = Schema.decodeUnknownSync(PageException)(value);
      Deferred.doneUnsafe(failed, Effect.fail(new PageFailed({ message: error.stack || `${error.name}: ${error.message}` })));
    }),
  );
  yield* Effect.promise(() => fixture.context.addInitScript(errorScript));
  yield* Effect.promise(() => fixture.page.evaluate(errorScript));
  const console: string[] = [];
  fixture.page.on('console', (message) => console.push(`[${message.type()}] ${message.text()}`));
  fixture.page.on('pageerror', (error) => console.push(`[pageerror] ${error.stack || `${error.name}: ${error.message}`}`));
  yield* Effect.promise(() => fixture.context.tracing.start({ screenshots: true, snapshots: true, sources: true }));
  const stop = onFailure(async (directory) => {
    const results = await Promise.allSettled([
      fixture.page.screenshot({ path: join(directory, 'screenshot.png'), timeout: 0 }),
      writeFile(join(directory, 'console.log'), console.join('\n')),
      fixture.context.tracing.stop({ path: join(directory, 'trace.zip') }),
    ]);
    const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
    if (failures.length > 0) throw new AggregateError(failures, 'browser failure artifacts were incomplete');
  });
  yield* Effect.addFinalizer(() => Effect.sync(stop));
  return { ...fixture, artifacts, failed };
});

const execute = <E>(name: string, lane: Lane, options: Options, body: (fixture: BrowserTest) => Effect.Effect<void, E, Scope.Scope>) =>
  recorded(name, (artifacts) =>
    Effect.gen(function* () {
      const fixture = yield* prepared(lane, options, artifacts);
      yield* Effect.raceFirst(body(fixture), Deferred.await(fixture.failed));
      yield* Effect.promise(() => fixture.context.tracing.stop());
    }),
  );

const register = (name: string, body: (fixture: BrowserTest) => Promise<void>, options: Options = {}): void =>
  registerEffect(name, (fixture) => Effect.promise(() => body(fixture)), options);

const registerEffect = <E>(
  name: string,
  body: (fixture: BrowserTest) => Effect.Effect<void, E, Scope.Scope>,
  options: Options = {},
): void => {
  for (const lane of selected(options)) {
    const title = `${name} [${lane}]`;
    it.live(title, () => execute(title, lane, options, body));
  }
};

export const e2e = Object.assign(register, { effect: registerEffect });

import {
  _electron,
  chromium,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type CDPSession,
  type Page,
} from 'playwright-core';
import { cachedExecutable } from '@runlith/chrome-for-testing/build';
import { claim, holding } from '@runlith/testbed/fixture';
import { kind, own, shared, type Taking } from '@runlith/testbed/worlds';
import { Context, Data, Effect, FileSystem, type Scope } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';

export type Lane = 'chromium' | 'webkit' | 'electron';

export type ElectronTarget = NonNullable<Parameters<typeof _electron.launch>[0]>;
export type ElectronLaunch = ElectronTarget | (() => ElectronTarget);

type PageSession = {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly cdp: CDPSession | undefined;
};

export type BrowserSession = PageSession & {
  readonly lane: Exclude<Lane, 'electron'>;
  readonly browser: Browser;
  readonly electron: undefined;
};

export type ElectronSession = PageSession & {
  readonly lane: 'electron';
  readonly browser: null;
  readonly electron: Awaited<ReturnType<typeof _electron.launch>>;
};

export type Session = BrowserSession | ElectronSession;

export class BrowserUnavailable extends Data.TaggedError('BrowserUnavailable')<{ readonly message: string; readonly cause?: unknown }> {}

const attempted = <A>(message: string, work: () => Promise<A>) =>
  Effect.tryPromise({ try: work, catch: (cause) => new BrowserUnavailable({ message, cause }) });

const launch = async (lane: Exclude<Lane, 'electron'>, home: string): Promise<Browser> => {
  const context = await (lane === 'chromium' ? chromium : webkit).launchPersistentContext(join(home, 'profile'), {
    executablePath: lane === 'chromium' ? cachedExecutable() : undefined,
    headless: true,
    ignoreDefaultArgs: lane === 'chromium' ? ['--hide-scrollbars'] : undefined,
    timeout: 0,
    args: lane === 'chromium' ? ['--use-mock-keychain', '--password-store=basic'] : [],
    env: { ...process.env, BREAKPAD_DUMP_LOCATION: join(home, 'crashes') },
  });
  const browser = context.browser();
  if (browser === null) throw new Error(`${lane} did not expose its browser`);
  return browser;
};

const makeEngines = Effect.fn('e2e.engines')(function* (home: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(home, { recursive: true });
  const unclaim = claim(home);
  let active: { readonly lane: Exclude<Lane, 'electron'>; readonly browser: Browser } | undefined;
  yield* Effect.addFinalizer(() =>
    attempted('the browser did not close', async () => {
      if (active !== undefined) await active.browser.close();
      unclaim();
    }).pipe(Effect.orDie),
  );
  return {
    take: Effect.fn('e2e.engine')(function* (lane: Exclude<Lane, 'electron'>) {
      if (active?.lane === lane) return active.browser;
      if (active !== undefined) yield* attempted('the previous lane did not close', () => active!.browser.close());
      active = undefined;
      const profile = yield* files.makeTempDirectory({ directory: home, prefix: `${lane}-` });
      const stop = holding();
      const browser = yield* attempted(
        `${lane} is unavailable; fill the Chrome for Testing cache or run playwright-core install webkit`,
        () => launch(lane, profile),
      ).pipe(Effect.ensuring(Effect.sync(stop)));
      active = { lane, browser };
      return browser;
    }),
    home,
  };
});

class Engines extends Context.Service<Engines, Effect.Success<ReturnType<typeof makeEngines>>>()('e2e/Engines') {}
const engines = kind(Engines, (_params: null, home: string) => makeEngines(home).pipe(Effect.provide(BunFileSystem.layer)));

const electronSession = Effect.fn('e2e.electron')(function* (options: BrowserContextOptions, target: ElectronTarget = {}) {
  const files = yield* FileSystem.FileSystem;
  const executablePath = target.executablePath ?? process.env.E2E_ELECTRON_EXECUTABLE;
  if (executablePath === undefined)
    return yield* new BrowserUnavailable({ message: 'E2E_ELECTRON_EXECUTABLE must name the built desktop executable' });
  const profile = yield* files.makeTempDirectoryScoped({ prefix: 'e2e-electron-' });
  const app = yield* Effect.acquireRelease(
    attempted('the built desktop app did not launch', () =>
      _electron.launch({
        ...target,
        executablePath,
        args: ['--use-mock-keychain', `--user-data-dir=${profile}`, ...(target.args ?? [])],
        timeout: 0,
      }),
    ),
    (app) => attempted('the desktop app did not close', () => app.close()).pipe(Effect.orDie),
  );
  const context = app.context();
  context.setDefaultTimeout(0);
  context.setDefaultNavigationTimeout(0);
  const page = yield* attempted('the desktop app opened no window', () => app.firstWindow({ timeout: 0 }));
  if (options.viewport != null) yield* attempted('the desktop viewport could not change', () => page.setViewportSize(options.viewport!));
  const cdp = yield* attempted('the desktop CDP session did not open', () => context.newCDPSession(page));
  return { lane: 'electron' as const, browser: null, context, page, cdp, electron: app };
});

const makeSession = Effect.fn('e2e.session')(function* (
  lane: Lane = 'chromium',
  options: BrowserContextOptions = {},
  taking: Taking = {},
  electron?: ElectronLaunch,
): Effect.fn.Return<Session, BrowserUnavailable, Scope.Scope> {
  if (lane === 'electron')
    return yield* electronSession(options, typeof electron === 'function' ? electron() : electron).pipe(
      Effect.provide(BunFileSystem.layer),
      Effect.orDie,
    );
  const held = yield* (taking.own === undefined ? shared(engines, null) : own(engines, null, taking.own)).pipe(Effect.orDie);
  const browser = yield* held.take(lane).pipe(Effect.orDie);
  const context = yield* Effect.acquireRelease(
    attempted('a fresh browser context did not open', () => browser.newContext({ serviceWorkers: 'block', ...options })),
    (context) => attempted('the browser context did not close', () => context.close()).pipe(Effect.orDie),
  );
  context.setDefaultTimeout(0);
  context.setDefaultNavigationTimeout(0);
  const page = yield* attempted('a page did not open', () => context.newPage());
  const cdp = lane === 'chromium' ? yield* attempted('a CDP session did not open', () => context.newCDPSession(page)) : undefined;
  return { lane, browser, context, page, cdp, electron: undefined };
});

export function session(
  lane: 'electron',
  options?: BrowserContextOptions,
  taking?: Taking,
  electron?: ElectronLaunch,
): Effect.Effect<ElectronSession, BrowserUnavailable, Scope.Scope>;
export function session(
  lane?: Exclude<Lane, 'electron'>,
  options?: BrowserContextOptions,
  taking?: Taking,
): Effect.Effect<BrowserSession, BrowserUnavailable, Scope.Scope>;
export function session(
  lane: Lane,
  options?: BrowserContextOptions,
  taking?: Taking,
  electron?: ElectronLaunch,
): Effect.Effect<Session, BrowserUnavailable, Scope.Scope>;
export function session(lane: Lane = 'chromium', options?: BrowserContextOptions, taking?: Taking, electron?: ElectronLaunch) {
  return makeSession(lane, options, taking, electron);
}

import { basename } from 'node:path';
import { Clock, Deferred, Duration, Effect } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { drive } from '../platform/contract/service/drives.js';
import { Editors, type Listing, type Target } from './contract/service/editors.js';
import { type Command, EditorHost, type Launcher } from './contract/service/host.js';
import { EDITORS, type EditorEntry, FILE, LINE, ROOT } from './contract/wire/catalog.js';

const FRESH = Duration.minutes(5);
const RETRY = Duration.seconds(30);

type Found = { readonly entry: EditorEntry; readonly launcher: Launcher | null; readonly icon: string | null };

type Search = {
  readonly found: ReadonlyMap<string, Found>;
  readonly failure: string | null;
  readonly failed: readonly { readonly id: string; readonly reason: string }[];
};

const filled = (token: string, target: Target, file: string): string => token.replaceAll(FILE, file).replaceAll(LINE, String(target.line));

const linkPath = (file: string): string =>
  file
    .replaceAll('\\', '/')
    .split('/')
    .filter((part, at) => at > 0 || part !== '')
    .map((part) => `/${encodeURIComponent(part).replaceAll('%3A', ':')}`)
    .join('');

export const commandOf = (
  entry: EditorEntry,
  launcher: Launcher | null,
  target: Target,
  opener: (url: string) => Command,
): Command | null => {
  if (launcher !== null) {
    const args = entry.args.flatMap((token) =>
      token === ROOT ? (target.root === null ? [] : [target.root]) : [filled(token, target, target.file)],
    );
    return { program: launcher.program, args: [...launcher.prefix, ...args] };
  }
  return entry.link === undefined ? null : opener(filled(entry.link, target, linkPath(target.file)));
};

export const makeEditors = Effect.gen(function* () {
  const host = yield* EditorHost;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const search = Effect.match(host.find(EDITORS), {
    onFailure: (lookup): Search => ({ found: new Map(), failure: lookup.message, failed: [] }),
    onSuccess: (sightings): Search => {
      const found = new Map<string, Found>();
      const failed: { readonly id: string; readonly reason: string }[] = [];
      for (const sighting of sightings) {
        const entry = EDITORS.find((one) => one.id === sighting.id);
        if (entry === undefined) continue;
        if (sighting.found === 'installed') found.set(entry.id, { entry, launcher: sighting.launcher, icon: sighting.icon });
        if (sighting.found === 'failed') failed.push({ id: entry.id, reason: sighting.reason });
      }
      return { found, failure: null, failed };
    },
  }).pipe(
    Effect.tap((searched) =>
      Effect.all([
        searched.failure === null
          ? Effect.void
          : Effect.logWarning('the installed editors could not be found', { reason: searched.failure }),
        Effect.forEach(searched.failed, (one) => Effect.logWarning('an editor could not be checked and is left out', one)),
      ]),
    ),
    Effect.withSpan('Editors.search'),
  );

  const scope = yield* Effect.scope;
  let last: { readonly searched: Search; readonly until: number } | null = null;
  let running: Deferred.Deferred<Search> | null = null;

  const again = Effect.suspend(() => {
    if (running !== null) return Effect.succeed(running);
    const done = Deferred.makeUnsafe<Search>();
    running = done;
    const settle = Effect.flatMap(search, (searched) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) => {
        last = { searched, until: now + Duration.toMillis(searched.failure === null ? FRESH : RETRY) };
        running = null;
        return Deferred.succeed(done, searched);
      }),
    );
    return Effect.as(Effect.forkIn(settle, scope), done);
  });

  const current = Effect.gen(function* () {
    const standing = last;
    if (standing === null) return yield* Deferred.await(yield* again);
    if ((yield* Clock.currentTimeMillis) >= standing.until) yield* again;
    return standing.searched;
  });

  const stale = Effect.asVoid(again);

  yield* drive('editors-search', stale);

  const launch = Effect.fn('Editors.launch')(function* (command: Command) {
    const handle = yield* spawner.spawn(
      ChildProcess.make(command.program, [...command.args], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }),
    );
    yield* handle.unref;
    return yield* handle.exitCode;
  }, Effect.scoped);

  return Editors.of({
    list: Effect.map(current, (searched): Listing => ({
      editors: EDITORS.flatMap((entry) => {
        const found = searched.found.get(entry.id);
        return found === undefined ? [] : [{ id: entry.id, name: entry.name, icon: found.icon }];
      }),
      failure: searched.failure,
    })),
    open: Effect.fn('Editors.open')(function* (editor, target) {
      const found = (yield* current).found.get(editor);
      const name = found?.entry.name ?? EDITORS.find((entry) => entry.id === editor)?.name ?? editor;
      const command = found === undefined ? null : commandOf(found.entry, found.launcher, target, host.opener);
      if (command === null)
        return yield* new GateRefusal('editor-missing', `${name} is not installed on this machine`, ['pick an editor read_editors lists']);
      const file = basename(target.file);
      const exit = yield* launch(command).pipe(
        Effect.tapError(() => stale),
        Effect.mapError(
          (failure) =>
            new GateRefusal(
              failure.reason._tag === 'NotFound' ? 'editor-missing' : 'editor-failed',
              `${name} could not be started to open ${file}: ${failure.message}`,
              ['pick another editor', 'open the file in the editor yourself'],
            ),
        ),
      );
      if (exit === 0) return;
      yield* stale;
      return yield* new GateRefusal('editor-failed', `${name} did not open ${file}: ${command.program} exited with ${exit}`, [
        'pick another editor',
        'open the file in the editor yourself',
      ]);
    }),
  });
});

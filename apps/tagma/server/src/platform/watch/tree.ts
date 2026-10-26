import { access } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { Clock, Effect, Fiber, Option } from 'effect';
import { OPERATION_PATHS } from '@runlith/git/status';
import { FileWatcher, WatchTickets, type WatchChange } from '../contract/service/watch.js';
import { WATCH_RESCANS, type WatchedPlace, type WatchReading, type WatchRescan } from '../contract/wire/watch.js';
import { byDepth, excludesFile, ignoredAmong, ignoredUnder } from './ignored.js';
import { type SharedWatch, sharedWatch } from './subscriptions.js';

export type TreeMovement = 'tree' | 'head' | 'index' | 'refs' | 'config' | 'ignore' | 'operation';

export type TreeRescan = WatchRescan;

export type WatchEvent = { readonly paths: readonly string[] } | { readonly rescan: TreeRescan; readonly paths?: readonly string[] };

export type TreeShift =
  | { readonly movement: TreeMovement; readonly paths: readonly string[] }
  | { readonly movement: TreeMovement; readonly rescan: TreeRescan; readonly paths?: readonly string[] };

const CONFIG = 'config';

const EXCLUDE = 'info/exclude';

const GITIGNORE = '.gitignore';

const OBJECTS = '.git/objects';

const GIT_MARKS: ReadonlyMap<string, TreeMovement> = new Map([
  ['HEAD', 'head'],
  ['logs/HEAD', 'head'],
  ['index', 'index'],
  ['packed-refs', 'refs'],
  [CONFIG, 'config'],
  [EXCLUDE, 'ignore'],
  ...OPERATION_PATHS.map((path) => [path, 'operation'] as const),
] as const);

const isRefLock = (path: string): boolean => /\.lock(?:\/|$)/.test(path);

const gitMovement = (inside: string): TreeMovement | null =>
  GIT_MARKS.get(inside) ?? (inside.startsWith('refs/') && !isRefLock(inside) ? 'refs' : null);

const gitMovementsUnder = (directory: string): readonly TreeMovement[] => {
  const under = (mark: string) => directory === '' || mark === directory || mark.startsWith(`${directory}/`);
  const movements = new Set<TreeMovement>();
  for (const [mark, movement] of GIT_MARKS) if (under(mark)) movements.add(movement);
  if (under('refs')) movements.add('refs');
  return [...movements];
};

export type TreeWatch = {
  readonly watching: () => boolean;
  readonly mode: () => 'watching' | 'polling';
  readonly close: () => void;
};

const GIT = '.git';

export const watchEventOf = (change: WatchChange): WatchEvent => {
  const named = [sep === '\\' ? change.path.replaceAll('\\', '/') : change.path];
  return change.kind === 'update' ? { paths: named } : { rescan: 'rename', paths: named };
};

export const mayTouch = (event: WatchEvent, name: string): boolean =>
  event.paths === undefined || event.paths.length === 0 || event.paths.includes(name);

export const mayReference = (event: WatchEvent): boolean =>
  ('rescan' in event && event.rescan !== 'rename') ||
  event.paths === undefined ||
  event.paths.length === 0 ||
  event.paths.some((path) => !isRefLock(path));

const present = (path: string): Effect.Effect<boolean> =>
  Effect.promise(() =>
    access(path).then(
      () => true,
      () => false,
    ),
  );

type Watched = {
  readonly at: string;
  readonly recursive: boolean;
  readonly required?: boolean;
  ignore?: readonly string[];
  readonly created?: (directory: string) => void;
  readonly dropped?: (subtree: string) => void;
  readonly listen: (event: WatchEvent) => void;
};

type Heard = {
  readonly at: string;
  readonly recursive: boolean;
  readonly required: boolean;
  readonly ignore: () => readonly string[];
  readonly created: (directory: string) => void;
  readonly dropped: (subtree: string) => void;
  readonly listen: (event: WatchEvent) => void;
  readonly since: number;
  events: number;
  readonly rescans: Record<WatchRescan, number>;
};

type Group = {
  readonly places: readonly Heard[];
  readonly hold: () => void;
  readonly resume: Effect.Effect<void>;
};

type Closing = { readonly place: Heard; readonly done: Promise<void> };

const standing = new Set<Group>();

const parked = new Set<Group>();

const closing = new Set<Closing>();

const closes = (place: Heard, done: Promise<void>): void => {
  const entry: Closing = { place, done };
  closing.add(entry);
  void done.then(() => closing.delete(entry));
};

const heard = (place: Watched, since: number): Heard => {
  const counted: Heard = {
    at: place.at,
    recursive: place.recursive,
    required: place.required === true,
    ignore: () => place.ignore ?? [],
    created: (directory) => place.created?.(directory),
    dropped: (subtree) => place.dropped?.(subtree),
    since,
    events: 0,
    rescans: Object.fromEntries(WATCH_RESCANS.map((rescan) => [rescan, 0])) as Record<WatchRescan, number>,
    listen: (event) => {
      if ('rescan' in event) counted.rescans[event.rescan] += 1;
      else counted.events += 1;
      place.listen(event);
    },
  };
  return counted;
};

const activity = (place: WatchedPlace): number => place.events + WATCH_RESCANS.reduce((sum, rescan) => sum + place.rescans[rescan], 0);

export const watchReading = (limit: number): WatchReading => {
  const places: WatchedPlace[] = [];
  for (const [groups, state] of [
    [standing, 'watching'],
    [parked, 'parked'],
  ] as const) {
    for (const group of groups) {
      for (const place of group.places) {
        places.push({
          at: place.at,
          recursive: place.recursive,
          state,
          since: place.since,
          events: place.events,
          rescans: { ...place.rescans },
        });
      }
    }
  }
  places.sort((left, right) => activity(right) - activity(left));
  return { places: places.slice(0, limit), total: places.length };
};

const withheld: string[] = [];

const inside = (path: string, root: string): boolean => {
  const way = relative(root, path);
  return way === '' || (way !== '..' && !way.startsWith(`..${sep}`) && !isAbsolute(way));
};

const covers = (root: string, place: Heard): boolean => inside(place.at, root) || (place.recursive && inside(root, place.at));

const barred = (group: Group): boolean => group.places.some((place) => withheld.some((root) => covers(root, place)));

export const withholding = <A, E, R>(roots: readonly string[], work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.suspend(() => {
      withheld.push(...roots);
      for (const group of [...standing]) if (barred(group)) group.hold();
      const waits = [...closing].filter(({ place }) => roots.some((root) => covers(root, place))).map(({ done }) => done);
      return waits.length === 0 ? Effect.void : Effect.promise(() => Promise.all(waits));
    }),
    () => work,
    () =>
      Effect.suspend(() => {
        for (const root of roots) {
          const at = withheld.indexOf(root);
          if (at >= 0) withheld.splice(at, 1);
        }
        return Effect.forEach(
          [...parked].filter((group) => !barred(group)),
          (group) => group.resume,
          { discard: true },
        );
      }),
  );

type Opened = { readonly watch: TreeWatch; readonly reopen: Effect.Effect<void> };

const watchGroup = Effect.fnUntraced(function* (asked: readonly Watched[]) {
  const since = yield* Clock.currentTimeMillis;
  const places = asked.map((place) => heard(place, since));
  const granted = Option.getOrUndefined(yield* Effect.serviceOption(WatchTickets));
  const watcher = Option.getOrUndefined(yield* Effect.serviceOption(FileWatcher));
  const watchers: { readonly place: Heard; readonly shared: SharedWatch; readonly release: () => void }[] = [];
  let intended = 0;
  let lost = false;
  let closed = false;
  let held = false;
  let opening = false;
  const shut = (): void => {
    standing.delete(group);
    for (const { place, shared, release } of watchers.splice(0)) {
      const leaves = shared.release();
      if (leaves !== null) closes(place, leaves);
      release();
    }
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    parked.delete(group);
    shut();
  };
  const ended = (place: Heard, rescan: WatchRescan): void => {
    lost = true;
    place.listen({ rescan });
    close();
  };
  const open = Effect.gen(function* () {
    opening = true;
    intended = 0;
    standing.add(group);
    if (barred(group)) {
      group.hold();
      return;
    }
    for (const place of places) {
      const there = yield* present(place.at);
      if (closed || held) return;
      if (!there) {
        if (!place.required) continue;
        return ended(place, 'lost');
      }
      intended += 1;
      if (watcher === undefined) return ended(place, 'polling');
      const release = granted === undefined ? () => undefined : yield* granted.grant();
      if (closed || held) {
        release?.();
        return;
      }
      if (release === null) return ended(place, 'polling');
      const shared = sharedWatch(watcher, place.at, place.recursive, place.ignore(), {
        heard: (change) => {
          if (closed || held) return;
          if (change.directory === true) place.created(change.path);
          place.listen(watchEventOf(change));
        },
        dropped: (subtree) => {
          if (closed || held) return;
          if (subtree === null) return place.listen({ rescan: 'unnamed' });
          place.listen(watchEventOf({ kind: 'create', path: subtree, directory: true }));
          place.dropped(subtree);
        },
        failed: () => {
          if (lost || closed || held) return;
          ended(place, 'error');
        },
      });
      watchers.push({ place, shared, release });
      const opened = yield* Effect.promise(() => shared.opened);
      if (closed || held || lost) return;
      if (!opened) return ended(place, 'lost');
    }
    if (watchers.length === 0) standing.delete(group);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        opening = false;
      }),
    ),
  );
  const group: Group = {
    places,
    hold: () => {
      if (closed || lost || held) return;
      held = true;
      parked.add(group);
      shut();
    },
    resume: Effect.suspend(() => {
      if (closed || !held) return Effect.void;
      held = false;
      parked.delete(group);
      return Effect.andThen(
        open,
        Effect.sync(() => {
          if (closed || lost || held) return;
          for (const place of places) place.listen({ rescan: 'unnamed' });
        }),
      );
    }),
  };
  yield* Effect.onInterrupt(open, () => Effect.sync(close));
  const watch: TreeWatch = {
    watching: () => !closed && !lost && !held && !opening && intended > 0 && watchers.length === intended,
    mode: () => (!closed && !lost && !held && intended > 0 ? 'watching' : 'polling'),
    close,
  };
  const reopen = Effect.suspend(() => {
    if (closed || lost) return Effect.void;
    if (held) return Effect.void;
    group.hold();
    return group.resume;
  });
  return { watch, reopen } satisfies Opened;
});

export const watchAll = (asked: readonly Watched[]): Effect.Effect<TreeWatch> => Effect.map(watchGroup(asked), ({ watch }) => watch);

const ownExcluded = (gitInside: boolean): readonly string[] => (gitInside ? [OBJECTS] : []);

export const excludedOf = Effect.fnUntraced(function* (tree: string, gitInside: boolean) {
  const listed = yield* ignoredUnder(tree).pipe(
    Effect.match({
      onFailure: (failure) => {
        console.warn(`[watch] the directories git ignores under ${tree} could not be read, so none is kept out: ${failure.message}`);
        return [];
      },
      onSuccess: (directories) => directories,
    }),
  );
  return [...ownExcluded(gitInside), ...topmost(listed)];
});

const newlyIgnored = Effect.fnUntraced(function* (tree: string, created: readonly string[]) {
  return yield* ignoredAmong(tree, created).pipe(
    Effect.match({
      onFailure: (failure) => {
        console.warn(
          `[watch] whether git ignores directories created under ${tree} could not be read, so they stay watched: ${failure.message}`,
        );
        return [];
      },
      onSuccess: (directories) => directories,
    }),
  );
});

const within = (set: ReadonlySet<string>, path: string): boolean => {
  let cut = path.length;
  while (cut > 0) {
    if (set.has(path.slice(0, cut))) return true;
    cut = path.lastIndexOf('/', cut - 1);
  }
  return false;
};

const topmost = (paths: readonly string[]): readonly string[] => {
  const kept = new Set<string>();
  for (const path of [...paths].sort(byDepth)) if (!within(kept, path)) kept.add(path);
  return [...kept];
};

const sameList = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((entry, at) => entry === right[at]);

export const watchTree = Effect.fnUntraced(function* (
  places: { readonly tree: string; readonly gitDir: string | null; readonly commonDir: string | null },
  moved: (shift: TreeShift) => void,
): Effect.fn.Return<TreeWatch> {
  const gitInside = places.gitDir !== null && places.gitDir.startsWith(`${places.tree}/`);
  const context = yield* Effect.context<never>();
  let working: Fiber.Fiber<void> | null = null;
  let relistWanted = places.gitDir !== null;
  let excludesWanted = places.gitDir !== null;
  let excludesReady = true;
  let external: TreeWatch | null = null;
  let externalPlace: string | null = null;
  let closed = false;
  let started = false;
  const created = new Set<string>();
  let opened: Opened | null = null;
  const treePlace: Watched = {
    at: places.tree,
    recursive: true,
    required: true,
    ignore: [],
    created: (directory) => {
      if (places.gitDir === null || directory === GIT || directory.startsWith(`${GIT}/`)) return;
      if (within(kept, directory)) return;
      created.add(directory);
      schedule();
    },
    dropped: (subtree) => {
      if (places.gitDir === null) return;
      if (subtree !== GIT && !subtree.startsWith(`${GIT}/`)) {
        relistWanted = true;
        schedule();
        return;
      }
      for (const movement of gitMovementsUnder(subtree.slice(GIT.length + 1))) tell({ movement, rescan: 'rename', paths: [subtree] });
    },
    listen: (event) => {
      if ('rescan' in event) {
        const inside = event.rescan === 'rename' ? event.paths?.[0] : undefined;
        if (inside !== undefined && inside.startsWith(`${GIT}/`)) {
          const says = gitMovement(inside.slice(GIT.length + 1));
          if (says !== null) tell({ movement: says, paths: event.paths ?? [] });
          return;
        }
        tell({ movement: 'tree', rescan: event.rescan, paths: event.paths });
        return;
      }
      const file = event.paths[0];
      if (file === undefined) {
        tell({ movement: 'tree', rescan: 'unnamed' });
        return;
      }
      if (file !== GIT && !file.startsWith(`${GIT}/`)) {
        tell({ movement: 'tree', paths: event.paths });
        return;
      }
      const says = gitMovement(file.slice(GIT.length + 1));
      if (says !== null) tell({ movement: says, paths: event.paths });
    },
  };
  let kept: ReadonlySet<string> = new Set(treePlace.ignore);
  const excluded = (now: readonly string[]) =>
    Effect.suspend(() => {
      if (sameList(now, treePlace.ignore ?? [])) return Effect.void;
      treePlace.ignore = now;
      kept = new Set(now);
      return opened === null ? Effect.void : opened.reopen;
    });
  const followExcludes = Effect.fnUntraced(function* () {
    const file = yield* excludesFile(places.tree).pipe(
      Effect.match({
        onFailure: (failure) => {
          console.warn(`[watch] the excludes file for ${places.tree} could not be resolved: ${failure.message}`);
          return undefined;
        },
        onSuccess: (path) => path,
      }),
    );
    if (closed) return;
    excludesReady = file !== undefined;
    if (file === undefined) {
      moved({ movement: 'ignore', rescan: 'polling' });
      return;
    }
    if (file === null) {
      const changed = externalPlace !== null;
      external?.close();
      external = null;
      externalPlace = null;
      if (started && changed) moved({ movement: 'ignore', paths: [] });
      return;
    }
    const parent = dirname(file);
    let at = parent;
    while (!(yield* present(at)) && dirname(at) !== at) at = dirname(at);
    const name = relative(at, file).split(sep)[0];
    const key = `${at}\0${file}`;
    if (externalPlace === key && external?.watching()) return;
    const next = yield* watchAll([
      {
        at,
        recursive: false,
        required: true,
        listen: (event) => {
          if (!mayTouch(event, name ?? '')) return;
          if (at !== parent && (!('rescan' in event) || event.rescan === 'rename' || event.rescan === 'unnamed')) {
            excludesWanted = true;
            schedule();
          }
          if ('rescan' in event) tell({ movement: 'ignore', rescan: event.rescan, paths: [file] });
          else tell({ movement: 'ignore', paths: [file] });
        },
      },
    ]);
    if (closed) {
      next.close();
      return;
    }
    external?.close();
    external = next;
    externalPlace = key;
    relistWanted = true;
    if (started) moved({ movement: 'ignore', paths: [file] });
  });
  const work: Effect.Effect<void> = Effect.gen(function* () {
    for (;;) {
      if (closed) return;
      if (excludesWanted) {
        excludesWanted = false;
        yield* followExcludes();
        continue;
      }
      if (relistWanted) {
        relistWanted = false;
        created.clear();
        yield* excluded(yield* excludedOf(places.tree, gitInside));
        continue;
      }
      const asked = [...created].filter((directory) => !within(kept, directory));
      created.clear();
      if (asked.length === 0) return;
      const ignored = topmost(yield* newlyIgnored(places.tree, asked));
      if (ignored.length === 0) continue;
      const own = ownExcluded(gitInside);
      const current = treePlace.ignore ?? [];
      yield* excluded([...own, ...[...current.filter((entry) => !own.includes(entry)), ...ignored].sort(byDepth)]);
    }
  });
  const schedule = (): void => {
    if (closed || !started || working !== null) return;
    const running = Effect.runForkWith(context)(work);
    working = running;
    running.addObserver(() => {
      if (working !== running) return;
      working = null;
      if (excludesWanted || relistWanted || created.size > 0) schedule();
    });
  };
  const ignoreMoved = (shift: TreeShift): boolean =>
    shift.movement === 'ignore' ||
    shift.movement === 'config' ||
    ('rescan' in shift && shift.rescan === 'unnamed') ||
    (shift.movement === 'tree' && (shift.paths ?? []).some((path) => path === GITIGNORE || path.endsWith(`/${GITIGNORE}`)));
  const tell = (shift: TreeShift): void => {
    moved(shift);
    if (places.gitDir === null || !ignoreMoved(shift)) return;
    relistWanted = true;
    if (shift.movement === 'config' || ('rescan' in shift && shift.rescan === 'unnamed')) excludesWanted = true;
    schedule();
  };
  const shift =
    (movement: TreeMovement, name?: string, path = name) =>
    (event: WatchEvent): void => {
      if (name !== undefined && !mayTouch(event, name)) return;
      if (movement === 'refs' && !mayReference(event)) return;
      const paths = path !== undefined && event.paths !== undefined && event.paths.length > 0 ? [path] : event.paths;
      if ('rescan' in event) tell({ movement, rescan: event.rescan, paths });
      else tell({ movement, paths: paths ?? [] });
    };
  const watched: Watched[] = [treePlace];
  if (places.gitDir !== null && !gitInside) {
    const head = shift('head', 'HEAD');
    const index = shift('index', 'index');
    const operation = shift('operation');
    watched.push({
      at: places.gitDir,
      recursive: false,
      required: true,
      listen: (event) => {
        head(event);
        index(event);
        if (OPERATION_PATHS.some((path) => mayTouch(event, path))) operation(event);
      },
    });
    watched.push({ at: join(places.gitDir, 'logs'), recursive: false, listen: shift('head', 'HEAD', 'logs/HEAD') });
  }
  if (places.commonDir !== null && !places.commonDir.startsWith(`${places.tree}/`)) {
    const config = shift('config', CONFIG);
    const packed = shift('refs', 'packed-refs');
    watched.push({
      at: places.commonDir,
      recursive: false,
      listen: (event) => {
        config(event);
        packed(event);
      },
    });
    watched.push({ at: join(places.commonDir, 'refs'), recursive: true, listen: shift('refs') });
    watched.push({ at: join(places.commonDir, 'info'), recursive: false, listen: shift('ignore', 'exclude', EXCLUDE) });
  }
  const group = yield* Effect.andThen(work, watchGroup(watched)).pipe(Effect.onInterrupt(() => Effect.sync(() => external?.close())));
  opened = group;
  started = true;
  if (excludesWanted || relistWanted || created.size > 0) schedule();
  return {
    watching: () => group.watch.watching() && excludesReady && (external === null || external.watching()),
    mode: () =>
      group.watch.mode() === 'watching' && excludesReady && (external === null || external.mode() === 'watching') ? 'watching' : 'polling',
    close: () => {
      closed = true;
      group.watch.close();
      external?.close();
      const running = working;
      working = null;
      relistWanted = false;
      excludesWanted = false;
      created.clear();
      if (running !== null) Effect.runFork(Fiber.interrupt(running));
    },
  };
});

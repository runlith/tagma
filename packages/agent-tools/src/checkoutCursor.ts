import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect, type FileSystem } from 'effect';
import { headOnDisk, type IndexEntries, indexMoved, indexOnDisk } from '@runlith/git/disk';
import { Git } from '@runlith/git/Git';
import { commitOf } from '@runlith/git/repository';
import { pathspecFits } from '@runlith/git/status';
import { isCookie } from '@runlith/watch/cookie';
import type { ChangeSource, Heard } from './changeSource';
import { type CheckoutFrontier, checkoutState, type Head, messageOf, quoted, type Seen, type StateReading } from './checkoutState';
import type { ResolvedToolOptions } from './workspace';

type GitPlace = {
  readonly gitDir: string;
  readonly commonDir: string;
  readonly configs: readonly string[];
  readonly rules: readonly string[];
};

type Basis = {
  readonly generation: number;
  readonly position: string;
  readonly state: ReadonlyMap<string, string>;
  readonly presence: ReadonlyMap<string, boolean | null>;
  readonly seen: ReadonlyMap<string, Seen>;
  readonly head: string | null;
  readonly indexStamp: string;
  readonly index: IndexEntries | null;
  readonly rules: string;
  readonly heard: ReadonlyMap<string, Heard>;
};

export type CursorReading = { readonly reading: StateReading; readonly head: Head; readonly heard: ReadonlyMap<string, Heard> };

const bases = new WeakMap<CheckoutFrontier, Basis>();

const places = new Map<string, { readonly place: GitPlace; readonly configs: string }>();

const KEPT_HEARD = 4096;

const GIT = '.git';

const GITIGNORE = '.gitignore';

const stampOf = (path: string): Effect.Effect<string> =>
  Effect.promise(() =>
    stat(path).then(
      (info) => `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.ino}`,
      () => '-',
    ),
  );

type Unread = { readonly unreadable: string };

const configsOf = (commonDir: string): readonly string[] => {
  const xdg = process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config');
  const global = process.env['GIT_CONFIG_GLOBAL'];
  return [join(commonDir, 'config'), ...(global !== undefined ? [global] : [join(homedir(), '.gitconfig'), join(xdg, 'git', 'config')])];
};

const gitPlaceOf = Effect.fn('CheckoutBaselines.gitPlace')(function* (tree: string): Effect.fn.Return<GitPlace | Unread, never, Git> {
  const held = places.get(tree);
  if (held !== undefined && held.configs === (yield* Effect.forEach(held.place.configs, stampOf)).join('\0')) return held.place;
  const git = yield* Git;
  const dirs = yield* git.run(['rev-parse', '--absolute-git-dir', '--git-common-dir'], { cwd: tree }).pipe(Effect.result);
  if (dirs._tag === 'Failure') return { unreadable: `git could not be run: ${quoted(messageOf(dirs.failure))}` };
  const [gitDir, common] = dirs.success.stdout.trim().split('\n');
  if (dirs.success.status !== 0 || gitDir === undefined || common === undefined) {
    return { unreadable: `git named no git directory for ${quoted(tree)}` };
  }
  const commonDir = resolve(tree, common);
  const configs = configsOf(commonDir);
  const stamped = (yield* Effect.forEach(configs, stampOf)).join('\0');
  const configured = yield* git.run(['config', '--path', '--get', 'core.excludesFile'], { cwd: tree }).pipe(Effect.result);
  if (configured._tag === 'Failure') return { unreadable: `git could not be run: ${quoted(messageOf(configured.failure))}` };
  const named = configured.success.status === 0 ? configured.success.stdout.trim() : '';
  const excludes =
    named !== '' ? resolve(tree, named) : join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'git', 'ignore');
  const place: GitPlace = { gitDir, commonDir, configs, rules: [join(commonDir, 'info', 'exclude'), excludes, ...configs] };
  places.set(tree, { place, configs: stamped });
  return place;
});

const headOf = Effect.fn('CheckoutBaselines.head')(function* (tree: string, place: GitPlace): Effect.fn.Return<Head, never, Git> {
  const onDisk = yield* Effect.promise(() => headOnDisk(place.gitDir, place.commonDir));
  if (onDisk !== undefined) return { commit: onDisk };
  const read = yield* commitOf(yield* Git, tree, 'HEAD').pipe(Effect.result);
  return read._tag === 'Failure' ? { unread: quoted(read.failure.message) } : { commit: read.success };
});

const headMoved = Effect.fn('CheckoutBaselines.headMoved')(function* (
  tree: string,
  from: string,
  to: string,
): Effect.fn.Return<readonly string[] | Unread, never, Git> {
  const ran = yield* (yield* Git).run(['diff', '--name-only', '-z', '--no-renames', from, to], { cwd: tree }).pipe(Effect.result);
  if (ran._tag === 'Failure') return { unreadable: `git could not be run: ${quoted(messageOf(ran.failure))}` };
  if (ran.success.status !== 0 || ran.success.overflow) return { unreadable: `git named no paths between ${from} and ${to}` };
  return ran.success.stdout.split('\0').filter((name) => name !== '');
});

const touches = (name: string, scopes: ReadonlySet<string>): boolean => {
  if (scopes.has(name)) return true;
  for (let at = name.indexOf('/'); at !== -1; at = name.indexOf('/', at + 1)) if (scopes.has(name.slice(0, at))) return true;
  return false;
};

const ruleMoved = (name: string): boolean => name === GITIGNORE || name.endsWith(`/${GITIGNORE}`);

type Scope = {
  readonly paths: readonly string[] | null;
  readonly named: readonly string[];
  readonly rulesMoved: boolean;
  readonly heard: Map<string, Heard>;
};

const scopeOf = Effect.fn('CheckoutBaselines.cursorScope')(function* (
  tree: string,
  source: ChangeSource,
  basis: Basis,
  head: string | null,
  index: IndexEntries | null,
): Effect.fn.Return<Scope, never, Git> {
  const heard = new Map(basis.heard);
  const paths = new Set<string>();
  const whole = (rulesMoved: boolean): Scope => ({ paths: null, named: [...paths], rulesMoved, heard });
  const changed = yield* source.changedSince(tree, basis.position);
  if (changed === null) return whole(false);
  let rulesMoved = false;
  for (const change of changed) {
    if (change.path === GIT || change.path.startsWith(`${GIT}/`) || isCookie(change.path)) continue;
    if (ruleMoved(change.path)) rulesMoved = true;
    paths.add(change.path);
    if (change.heard === null) continue;
    heard.delete(change.path);
    heard.set(change.path, change.heard);
  }
  for (const name of heard.keys()) {
    if (heard.size <= KEPT_HEARD) break;
    heard.delete(name);
  }
  if (rulesMoved) return whole(true);
  if (head !== basis.head) {
    if (head === null || basis.head === null) return whole(false);
    const moved = yield* headMoved(tree, basis.head, head);
    if ('unreadable' in moved) return whole(false);
    for (const name of moved) paths.add(name);
  }
  if (index === null || basis.index === null) return whole(false);
  if (index !== basis.index) for (const name of indexMoved(basis.index, index)) paths.add(name);
  return pathspecFits(paths) ? { paths: [...paths], named: [...paths], rulesMoved: false, heard } : whole(false);
});

export const cursorReading = Effect.fn('CheckoutBaselines.cursorReading')(function* (
  tree: string,
  resolved: ResolvedToolOptions,
  frontier: CheckoutFrontier,
  source: ChangeSource,
): Effect.fn.Return<CursorReading, never, FileSystem.FileSystem | Git> {
  const place = yield* gitPlaceOf(tree);
  if ('unreadable' in place) return { reading: place, head: { unread: place.unreadable }, heard: new Map() };
  const known = bases.get(frontier);
  const basis = known !== undefined && known.generation === frontier.generation ? known : undefined;
  bases.delete(frontier);
  const rules = (yield* Effect.forEach(place.rules, stampOf)).join('\0');
  if (basis !== undefined && basis.rules !== rules) yield* source.rulesMoved(tree);
  const position = (yield* source.settle(tree)) ? yield* source.mark(tree) : null;
  if (position === null) {
    return { reading: yield* checkoutState(tree, resolved, frontier, null), head: yield* headFallback(tree), heard: new Map() };
  }
  const indexStamp = yield* stampOf(join(place.gitDir, 'index'));
  const head = yield* headOf(tree, place);
  const commit = 'commit' in head ? head.commit : null;
  const index =
    basis !== undefined && basis.indexStamp === indexStamp
      ? basis.index
      : yield* Effect.promise(() => indexOnDisk(place.gitDir, commit !== null && commit.length === 64 ? 32 : 20));
  const scope =
    basis === undefined || basis.rules !== rules || !('commit' in head) ? null : yield* scopeOf(tree, source, basis, commit, index);
  const heard = scope?.heard ?? new Map(basis?.heard ?? []);
  if (basis === undefined || scope === null || scope.paths === null) {
    if (scope?.rulesMoved === true) yield* source.rulesMoved(tree);
    const marked = scope?.rulesMoved === true ? ((yield* source.settle(tree)) ? yield* source.mark(tree) : null) : position;
    const reading = yield* checkoutState(tree, resolved, frontier, null, scope?.named);
    if ('state' in reading && marked !== null)
      remember(frontier, { position: marked, reading, head: commit, indexStamp, index, rules, heard });
    return { reading, head, heard };
  }
  const fresh = scope.paths.length === 0 ? null : yield* checkoutState(tree, resolved, frontier, scope.paths);
  if (fresh !== null && 'unreadable' in fresh) return { reading: fresh, head, heard };
  const scopes = new Set(scope.paths);
  const state = new Map<string, string>();
  const presence = new Map<string, boolean | null>();
  const seen = new Map<string, Seen>();
  for (const [name, digest] of basis.state) {
    if (touches(name, scopes)) continue;
    state.set(name, digest);
    presence.set(name, basis.presence.get(name) ?? null);
    const stood = basis.seen.get(name);
    if (stood !== undefined) seen.set(name, stood);
  }
  if (fresh !== null) {
    for (const [name, digest] of fresh.state) state.set(name, digest);
    for (const [name, present] of fresh.presence) presence.set(name, present);
    for (const [name, standing] of fresh.seen) seen.set(name, standing);
  }
  frontier.keep();
  const reading = { state, presence, seen };
  remember(frontier, { position, reading, head: commit, indexStamp, index, rules, heard });
  return { reading, head, heard };
});

const headFallback = Effect.fn('CheckoutBaselines.headFallback')(function* (tree: string): Effect.fn.Return<Head, never, Git> {
  const read = yield* commitOf(yield* Git, tree, 'HEAD').pipe(Effect.result);
  return read._tag === 'Failure' ? { unread: quoted(messageOf(read.failure)) } : { commit: read.success };
});

const remember = (
  frontier: CheckoutFrontier,
  taken: {
    readonly position: string;
    readonly reading: {
      readonly state: Map<string, string>;
      readonly presence: Map<string, boolean | null>;
      readonly seen: Map<string, Seen>;
    };
    readonly head: string | null;
    readonly indexStamp: string;
    readonly index: IndexEntries | null;
    readonly rules: string;
    readonly heard: ReadonlyMap<string, Heard>;
  },
): void => {
  const seen = new Map([...taken.reading.seen].map(([name, one]) => [name, one.bytes === null ? one : { ...one, bytes: null }]));
  bases.set(frontier, {
    generation: frontier.generation,
    position: taken.position,
    state: new Map(taken.reading.state),
    presence: new Map(taken.reading.presence),
    seen,
    head: taken.head,
    indexStamp: taken.indexStamp,
    index: taken.index,
    rules: taken.rules,
    heard: taken.heard,
  });
};

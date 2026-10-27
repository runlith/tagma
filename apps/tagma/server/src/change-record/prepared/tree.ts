import { lstat } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, FileSystem } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { TextAt } from '@runlith/git/entries';
import { type FileAt, stagedTextsAt, workingFilesAt } from '@runlith/git/working';
import { troubleOf } from '@runlith/git/repository';
import { contentDigest } from '@runlith/files/content';
import type { MachineStore, StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { runGit, OwnGitFailed, configuredGit, readingFailed } from '../../platform/git/ownGit.js';
import { overlayOwn } from './overlay.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ActorRef } from '../../platform/contract/wire/actor.js';
import { placesIn } from '../../workspace/roots/proof.js';
import type {
  ChangeInput,
  LandingOrigin,
  PreparedFns,
  PreparedReads,
  PreparedRow,
  PreparedEntries,
  PreparedHashes,
  PreparedMerge,
} from '../contract/service/prepared.js';
import { rawSides, stagedSides } from './sides.js';
import { listingUnder, standing } from '@runlith/files/working';
import { contentOf, contentText, type Content, type TextContent } from '../lines/folding.js';
import { walkCut, type Walks, type WalkUnfinished } from '../lines/walks.js';
import { selectFold, type SelectedSpan } from '../lines/selection.js';
import type { Landed } from '../lines/landed.js';
import type { Judged } from '../contract/service/holdings.js';
import { OPERATOR, holderKey } from '../../workspace/contract/wire/checkout.js';
import { programmaticPaths } from './programmatic.js';
import { bearsNobody, wholeAt } from './carriers.js';
import { checkDependencies, type DependencyRoot } from './dependencies.js';

const OPERATOR_KEY = holderKey(OPERATOR);

type StoreShape = Context.Service.Shape<typeof MachineStore>;

type UnitsShape = Context.Service.Shape<typeof MachineUnits>;

export const WEIGHED_BYTES = 4_000_000;

export const nul = (paths: readonly string[]): string => paths.map((path) => `${path}\0`).join('');

export const named = (listing: string): readonly string[] => listing.split('\0').filter((path) => path !== '');

const UNWEIGHABLE = Symbol('unweighable');

type Readable = Uint8Array | null | typeof UNWEIGHABLE;

const lstatAt = (path: string) =>
  Effect.tryPromise({ try: () => lstat(path), catch: (cause) => cause }).pipe(
    Effect.catchIf(
      (cause) => typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT',
      () => Effect.succeed(undefined),
    ),
  );

const workingBytes = Effect.fn('prepared.workingText')(function* (root: string, path: string, present: boolean) {
  if (!present) return null;
  const files = yield* FileSystem.FileSystem;
  const at = join(root, path);
  return yield* Effect.gen(function* (): Effect.fn.Return<Readable, unknown> {
    const stat = yield* lstatAt(at);
    if (stat === undefined) return null;
    if (!stat.isFile() || stat.size > WEIGHED_BYTES) return UNWEIGHABLE;
    return yield* files.readFile(at);
  }).pipe(Effect.match({ onFailure: (): Readable => UNWEIGHABLE, onSuccess: (bytes) => bytes }));
}, Effect.provide(BunFileSystem.layer));

export type Whole<Row extends PreparedRow> = {
  readonly path: string;
  readonly land: 'whole';
  readonly holders: readonly string[];
  readonly accountable: boolean;
  readonly rows: readonly Row[];
  readonly ids: readonly string[];
};

export type Planned<Row extends PreparedRow> =
  | Whole<Row>
  | {
      readonly path: string;
      readonly land: 'own';
      readonly text: string;
      readonly working: string;
      readonly positions: readonly SelectedSpan[];
      readonly lines: readonly number[];
      readonly landed: Landed | null;
      readonly holders: readonly string[];
      readonly ids: readonly string[];
    };

export type Built<Row extends PreparedRow> = {
  readonly base: string | null;
  readonly plan: readonly Planned<Row>[];
  readonly changed: readonly string[];
  readonly tree: string;
  readonly hashes: ReadonlyMap<string, PreparedHashes>;
  readonly entries: PreparedEntries;
};

export type Landing<Row extends PreparedRow> = {
  readonly projectId: number;
  readonly git: Git['Service'];
  readonly root: string;
  readonly store: StoreShape;
  readonly units: UnitsShape;
  readonly reads: PreparedReads<Row>;
  readonly fns: PreparedFns;
  readonly origin: LandingOrigin;
  readonly act: ActorRef;
  readonly checkout: string;
  readonly input: ChangeInput;
  readonly carriers: ReadonlySet<string>;
  readonly paths: readonly string[];
  readonly explicit: ReadonlySet<string>;
  readonly pairs: ReadonlyMap<string, ReadonlySet<string>>;
  readonly message: string;
  readonly index: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly job: string;
};

export const build = Effect.fn('prepared.build')(function* <Row extends PreparedRow>(
  landing: Landing<Row>,
  base: string | null,
  merge: PreparedMerge | undefined,
): Effect.fn.Return<Built<Row>, OwnGitFailed | StoreFailure | GateRefusal<'tree-mid-merge' | 'walk-cut' | 'lines-held'>> {
  const { git, root, index } = landing;
  const env = { GIT_INDEX_FILE: index };
  const held = yield* heldOf(landing);
  const programmatic = yield* programmaticPaths(
    landing,
    landing.paths.filter((path) => !wholeAt(landing.input.whole, path, root)),
  );
  const weighed = held.flatMap((one) =>
    one.shared && !wholeAt(landing.input.whole, one.path, root) && !programmatic.has(one.path) ? [one.path] : [],
  );
  const bases = new Map<string, FileAt>();
  if (base !== null && weighed.length > 0) {
    const texts = yield* workingFilesAt(configuredGit(git, 'submit-base'), root, base, weighed, { capture: WEIGHED_BYTES });
    for (const [at, path] of weighed.entries()) {
      const text = texts[at];
      if (text !== undefined) bases.set(path, text);
    }
  }
  const onDisk = listingUnder(root);
  const stood = new Map(
    yield* Effect.forEach(held, (one) => Effect.map(standing(one.path, onDisk), (answer) => [one.path, answer] as const), {
      concurrency: PLANS_AT_ONCE,
    }),
  );
  for (const [path, answer] of stood)
    if (answer !== 'stands' && answer !== 'absent')
      return yield* new GateRefusal('walk-cut', `whether ${path} stands on disk cannot be read: ${answer.unread}`, [
        `make its directory readable, then submit again`,
        `land without ${path} (paths)`,
      ]);
  const present = (path: string): boolean => stood.get(path) === 'stands';
  const working = new Map(
    yield* Effect.forEach(weighed, (path) => Effect.map(workingBytes(root, path, present(path)), (bytes) => [path, bytes] as const)),
  );
  const planned = yield* Effect.forEach(
    held,
    (one) =>
      Effect.result(
        Effect.mapError(planPath(landing, base, one, bases, working, programmatic.has(one.path)), (refusal) => ({
          path: one.path,
          refusal,
        })),
      ),
    { concurrency: PLANS_AT_ONCE },
  );
  const refused = planned.flatMap((one) => (one._tag === 'Failure' ? [one.failure] : []));
  if (refused.length > 0) return yield* together(refused, landing.pairs);
  let plan = planned.flatMap((one) => (one._tag === 'Success' && one.success !== null ? [one.success] : []));
  const selected = plan.filter((one): one is Own<Row> => one.land === 'own');
  const judgedByPath = new Map(held.map((one) => [one.path, one]));
  const dependencyRoots = selected.flatMap((one): DependencyRoot[] => {
    const held = judgedByPath.get(one.path);
    return held?.shared === true && held.judged !== undefined
      ? [{ path: one.path, working: one.working, selected: one.text, positions: one.positions, lines: one.lines, judged: held.judged }]
      : [];
  });
  if (plan.length > 0)
    yield* checkDependencies(landing, base, plan, dependencyRoots, WEIGHED_BYTES).pipe(Effect.provide(BunFileSystem.layer));
  if (merge !== undefined && selected.length > 0) {
    const staged = yield* workingFilesAt(
      configuredGit(git, 'submit-merge-base'),
      root,
      merge.tree,
      selected.map((one) => one.path),
      { capture: WEIGHED_BYTES },
    );
    const inputs = selected.map((one, at) => {
      const base = readable(bases.get(one.path));
      const index = readable(staged[at]);
      return base instanceof Uint8Array && index instanceof Uint8Array ? { base, selected: one.text, staged: index } : null;
    });
    const unweighed = () => unproven(selected.map((one) => one.path).join(', '), NO_PARTNERS);
    if (inputs.some((one) => one === null)) return yield* unweighed();
    const texts = yield* overlayOwn(inputs.filter((one) => one !== null));
    if (texts.some((one) => one.kind === 'unweighable')) return yield* unweighed();
    const overlaid = new Map<string, string>();
    for (const [at, one] of selected.entries()) {
      const answer = texts[at];
      const text = answer?.kind === 'overlaid' ? answer.text : null;
      if (text === null)
        return yield* new GateRefusal('walk-cut', `the selected regions of ${one.path} cannot be placed unambiguously in the merge index`, [
          `carry ${one.path} as it stands (whole: ${JSON.stringify([one.path])}), or resolve its working file against the index and submit again`,
        ]);
      overlaid.set(one.path, text);
    }
    plan = plan.map((one) => (one.land === 'own' ? { ...one, text: overlaid.get(one.path)!, landed: null } : one));
  }
  const from = merge?.tree ?? base;
  yield* runGit(git, 'submit-read-tree', ['-C', root, 'read-tree', ...(from === null ? ['--empty'] : [from])], { env });
  const gone = plan.filter((one) => !present(one.path));
  const staying = plan.filter((one) => present(one.path));
  const indexedModes = new Map<string, string>();
  if (merge !== undefined) {
    for (const cut of landing.fns.pathChunks(
      staying.filter((one) => !wholeAt(landing.input.whole, one.path, root)).map((one) => one.path),
    )) {
      const listed = yield* runGit(git, 'submit-merge-modes', ['-C', root, 'ls-files', '--stage', '-z', '--', ...cut], {
        env: { ...env, GIT_LITERAL_PATHSPECS: '1' },
      });
      for (const entry of named(listed)) {
        const tab = entry.indexOf('\t');
        const mode = entry.slice(0, entry.indexOf(' '));
        if (mode === '100644' || mode === '100755') indexedModes.set(entry.slice(tab + 1), mode);
      }
    }
  }
  if (gone.length > 0) {
    yield* runGit(git, 'submit-unstage', ['-C', root, 'update-index', '--force-remove', '-z', '--stdin'], {
      env,
      stdin: nul(gone.map((one) => one.path)),
    });
  }
  if (staying.length > 0) {
    yield* runGit(git, 'submit-stage', ['-C', root, 'update-index', '--add', '--remove', '-z', '--stdin'], {
      env,
      stdin: nul(staying.map((one) => one.path)),
      cleans: true,
    });
  }
  const own = plan.flatMap((one) => (one.land === 'own' ? [one] : []));
  if (own.length > 0 || indexedModes.size > 0) {
    const modes = new Map<string, string>();
    const corrections = new Map<string, string>();
    const paths = (indexedModes.size > 0 ? staying : own).map((one) => one.path);
    for (const cut of landing.fns.pathChunks(paths)) {
      const listed = yield* runGit(git, 'submit-modes', ['-C', root, 'ls-files', '--stage', '-z', '--', ...cut], {
        env: { ...env, GIT_LITERAL_PATHSPECS: '1' },
      });
      for (const entry of named(listed)) {
        const tab = entry.indexOf('\t');
        const path = entry.slice(tab + 1);
        const [current = '', blob = ''] = entry.slice(0, tab).split(' ');
        const mode = current === '100644' || current === '100755' ? (indexedModes.get(path) ?? current) : current;
        modes.set(path, mode);
        if (mode !== current) corrections.set(path, `${mode} ${blob}\t${path}\0`);
      }
    }
    const entries: string[] = [];
    if (corrections.size > 0) {
      const ownPaths = new Set(own.map((one) => one.path));
      for (const [path, entry] of corrections) if (!ownPaths.has(path)) entries.push(entry);
    }
    if (own.length > 0) {
      const blobs = yield* ownBlobs(landing, own);
      for (const one of own) entries.push(`${modes.get(one.path) ?? '100644'} ${blobs.get(one.path)}\t${one.path}\0`);
    }
    if (entries.length > 0)
      yield* runGit(git, 'submit-own', ['-C', root, 'update-index', '-z', '--index-info'], { env, stdin: entries.join('') });
  }
  const tree = yield* runGit(git, 'submit-tree', ['-C', root, 'write-tree'], { env });
  const entries =
    base === null
      ? stagedSides(tree, yield* runGit(git, 'submit-changed', ['-C', root, 'ls-files', '--stage', '-z'], { env }))
      : rawSides(
          base,
          tree,
          yield* runGit(git, 'submit-changed', ['-C', root, 'diff-index', '--cached', '--raw', '--no-abbrev', '-z', base, '--'], { env }),
        );
  const hashes = new Map(
    held.map((one) => {
      const carried = new Set<string>();
      const peers = new Set<string>();
      for (const row of one.rows) {
        if (landing.carriers.has(row.threadId)) {
          if (row.beforeHash !== null) carried.add(row.beforeHash);
          if (row.afterHash !== null) carried.add(row.afterHash);
        } else if (row.afterHash !== null) peers.add(row.afterHash);
      }
      return [one.path, { carried, peers }] as const;
    }),
  );
  return { base, plan, changed: [...entries.after.keys()], tree, hashes, entries };
});

const ATTRIBUTES = '.gitattributes';

type Own<Row extends PreparedRow> = Extract<Planned<Row>, { readonly land: 'own' }>;

const hashedAlone = (path: string): boolean => posix.basename(path) === ATTRIBUTES || /[\r\n]/.test(path) || path.startsWith('"');

export const mirrorOf = (index: string): string => `${index}.tree`;

export const stagedOf = (index: string): string => `${index}.staged`;

export const stagedTexts = (git: Git['Service'], root: string, paths: readonly string[], index: string): Effect.Effect<readonly TextAt[]> =>
  stagedTextsAt(configuredGit(git, 'submit-staged-texts'), root, paths, stagedOf(index), { capture: WEIGHED_BYTES });

const mirrored = Effect.fn('prepared.mirror')(function* <Row extends PreparedRow>(root: string, tree: string, own: readonly Own<Row>[]) {
  const files = yield* FileSystem.FileSystem;
  const dirs = new Set<string>();
  for (const one of own) {
    for (let at = posix.dirname(one.path); ; at = posix.dirname(at)) {
      if (dirs.has(at)) break;
      dirs.add(at);
      if (at === '.' || at === '/') break;
    }
  }
  for (const dir of dirs) {
    const from = join(root, dir, ATTRIBUTES);
    const stat = yield* lstatAt(from);
    if (stat === undefined || !(stat.isFile() || stat.isSymbolicLink())) continue;
    const to = join(tree, dir, ATTRIBUTES);
    yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* files.makeDirectory(dirname(to), { recursive: true });
        if (stat.isSymbolicLink()) yield* files.symlink(yield* files.readLink(from), to);
        else yield* files.copyFile(from, to);
      }),
    );
  }
  for (const one of own) {
    const to = join(tree, one.path);
    yield* Effect.uninterruptible(
      Effect.andThen(files.makeDirectory(dirname(to), { recursive: true }), files.writeFileString(to, one.text)),
    );
  }
});

const unfiltered = Effect.fnUntraced(function* <Row extends PreparedRow>(git: Git['Service'], root: string, own: readonly Own<Row>[]) {
  const answer = yield* Effect.result(
    runGit(git, 'submit-filters', ['-C', root, 'check-attr', '-z', '--stdin', 'filter'], {
      stdin: nul(own.map((one) => one.path)),
      cleans: true,
    }),
  );
  const clean = new Set<string>();
  if (answer._tag === 'Failure') {
    yield* Effect.logWarning('the own texts are hashed one by one: their clean filters could not be read', {
      reason: answer.failure.message,
    });
    return clean;
  }
  const fields = answer.success.split('\0');
  for (let at = 0; at + 2 < fields.length; at += 3) if (fields[at + 2] === 'unspecified') clean.add(fields[at] as string);
  return clean;
});

const folded = (path: string): string => path.normalize('NFC').toUpperCase().toLowerCase();

const ownBlobs = Effect.fnUntraced(function* <Row extends PreparedRow>(
  landing: Landing<Row>,
  own: readonly Own<Row>[],
): Effect.fn.Return<ReadonlyMap<string, string>, OwnGitFailed, FileSystem.FileSystem> {
  const { git, root, index } = landing;
  const blobs = new Map<string, string>();
  const spellings = new Map<string, number>();
  for (const one of own) spellings.set(folded(one.path), (spellings.get(folded(one.path)) ?? 0) + 1);
  const candidates = own.filter((one) => !hashedAlone(one.path) && spellings.get(folded(one.path)) === 1);
  const clean = candidates.length === 0 ? new Set<string>() : yield* unfiltered(git, root, candidates);
  const batched = candidates.filter((one) => clean.has(one.path));
  if (batched.length > 0) {
    const tree = mirrorOf(index);
    const files = yield* FileSystem.FileSystem;
    const hashed = yield* Effect.acquireUseRelease(
      Effect.void,
      () =>
        Effect.gen(function* () {
          yield* mirrored(root, tree, batched).pipe(
            Effect.mapError(
              (cause) =>
                new OwnGitFailed({
                  op: 'submit-blobs',
                  message: `the own texts could not be written to hash: ${String(cause)}`,
                  ran: false,
                }),
            ),
          );
          return yield* runGit(
            git,
            'submit-blobs',
            ['-C', tree, `--git-dir=${landing.gitDir}`, `--work-tree=${tree}`, 'hash-object', '-w', '--stdin-paths'],
            {
              stdin: batched.map((one) => `${one.path}\n`).join(''),
              cleans: true,
            },
          );
        }),
      () => Effect.orDie(files.remove(tree, { recursive: true, force: true })),
    );
    const shas = hashed.split('\n');
    if (shas.length !== batched.length) {
      return yield* new OwnGitFailed({ op: 'submit-blobs', message: `git hashed ${shas.length} of ${batched.length} texts`, ran: true });
    }
    for (const [at, one] of batched.entries()) blobs.set(one.path, shas[at] as string);
  }
  for (const one of own) {
    if (blobs.has(one.path)) continue;
    blobs.set(
      one.path,
      yield* runGit(git, 'submit-blob', ['-C', root, 'hash-object', '-w', '--stdin', `--path=${one.path}`], {
        stdin: one.text,
        cleans: true,
      }),
    );
  }
  return blobs;
}, Effect.provide(BunFileSystem.layer));

type Held<Row extends PreparedRow> = {
  readonly path: string;
  readonly rows: readonly Row[];
  readonly holders: readonly string[];
  readonly judged: Judged | undefined;
  readonly shared: boolean;
};

const peersOf = (judged: Judged | undefined, carriers: ReadonlySet<string>): readonly string[] => {
  if (judged === undefined) return [];
  const verdict = judged.holding.verdict;
  return verdict.verdict === 'proven'
    ? verdict.hands
        .map((hand) => ({ key: holderKey(hand.holder), retired: hand.retired }))
        .filter((hand) => !carriers.has(hand.key) && !hand.retired)
        .map((hand) => hand.key)
    : verdict.writers.map(holderKey).filter((holder) => !carriers.has(holder));
};

const retiredOf = (judged: Judged): ReadonlySet<string> =>
  new Set(
    judged.holding.verdict.verdict === 'proven'
      ? judged.holding.verdict.hands.filter((hand) => hand.retired).map((hand) => holderKey(hand.holder))
      : [],
  );

const heldOf = Effect.fnUntraced(function* <Row extends PreparedRow>(
  landing: Landing<Row>,
): Effect.fn.Return<readonly Held<Row>[], StoreFailure | GateRefusal<'walk-cut'>> {
  const grouped = yield* landing.reads.evidenceInGroups(
    landing.units,
    landing.store,
    placesIn(landing.checkout, landing.paths),
    (evidence) => Effect.succeed([...evidence].map(([path, rows]) => ({ path, rows }))),
  );
  const byPath = new Map(grouped.map((one) => [one.path, one.rows] as const));
  const judged = yield* landing.fns.judged(landing, [...byPath.keys()]);
  return landing.paths.map((path): Held<Row> => {
    const one = judged.get(path);
    const holders = peersOf(one, landing.carriers);
    const verdict = one?.verdict;
    const external = verdict?.verdict === 'proven' && verdict.hands.some((hand) => landing.carriers.has(hand.holder)) && verdict.unheld;
    return { path, rows: byPath.get(path) ?? [], holders, judged: one, shared: holders.length > 0 || external };
  });
});

const readable = (file: FileAt | undefined): Readable => (file === undefined || file._tag === 'Failure' ? UNWEIGHABLE : file.success);

const sideOf = (walks: Walks, bytes: Uint8Array | null): Effect.Effect<Content, WalkUnfinished> =>
  bytes === null ? Effect.succeed(contentOf(null)) : walks.file(bytes, undefined, 'now');

const NO_PARTNERS: ReadonlySet<string> = new Set();

const omitted = (path: string, partners: ReadonlySet<string>): string =>
  partners.size === 0
    ? `land without ${path} (paths)`
    : `land without the move ${[path, ...partners].join(' and ')} (paths naming none of them), since naming either path carries both`;

const moved = (path: string, partners: ReadonlySet<string>): GateRefusal<'walk-cut'> =>
  new GateRefusal('walk-cut', `${path} moved between its judgement and this landing`, [
    'land again: the path is judged afresh',
    `carry ${path} as it stands (whole: ${JSON.stringify([path])}), or ${omitted(path, partners)}`,
  ]);

const unproven = (path: string, partners: ReadonlySet<string>): GateRefusal<'walk-cut'> =>
  new GateRefusal('walk-cut', `whose lines stand in ${path} is not proven, so its own lines cannot be cut out of it`, [
    `carry ${path} as it stands (whole: ${JSON.stringify([path])}), or ${omitted(path, partners)}`,
  ]);

const heldBy = (path: string, partners: ReadonlySet<string>, holders: readonly string[], reason: string): GateRefusal<'lines-held'> => {
  const carry = `carry ${path} as it stands (whole: ${JSON.stringify([path])}), naming those holders in carried, or carry their lines with taking`;
  const without = omitted(path, partners);
  return new GateRefusal(
    'lines-held',
    reason,
    holders.includes(OPERATOR_KEY)
      ? [`ask the operator to commit their lines in ${path}, or on their word land with taking: ['operator']`, carry, without]
      : [carry, without],
  );
};

type Refused = { readonly path: string; readonly refusal: GateRefusal<'walk-cut' | 'lines-held'> };

const together = (
  refused: readonly Refused[],
  pairs: ReadonlyMap<string, ReadonlySet<string>>,
): Effect.Effect<never, GateRefusal<'walk-cut' | 'lines-held'>> => {
  if (refused.length === 1) return Effect.fail((refused[0] as Refused).refusal);
  const code = refused.some((one) => one.refusal.code === 'lines-held') ? 'lines-held' : 'walk-cut';
  const paths = [...new Set(refused.flatMap((one) => [one.path, ...(pairs.get(one.path) ?? NO_PARTNERS)]))];
  return Effect.fail(
    new GateRefusal(code, `${refused.length} paths refuse this landing: ${refused.map((one) => one.refusal.reason).join('; ')}`, [
      `land without ${paths.join(', ')} (paths naming none of them)`,
      ...new Set(refused.flatMap((one) => one.refusal.unblock)),
    ]),
  );
};

const planPath = <Row extends PreparedRow>(
  landing: Landing<Row>,
  base: string | null,
  { path, rows, holders, judged, shared }: Held<Row>,
  bases: ReadonlyMap<string, FileAt>,
  working: ReadonlyMap<string, Readable>,
  programmatic: boolean,
): Effect.Effect<Planned<Row> | null, GateRefusal<'walk-cut' | 'lines-held'>> => {
  const { input, carriers } = landing;
  const partners = landing.pairs.get(path) ?? NO_PARTNERS;
  const whole: Whole<Row> = {
    path,
    land: 'whole',
    holders,
    accountable: !wholeAt(input.whole, path, landing.root) && !programmatic,
    rows,
    ids: rows.filter((row) => !row.unresolved).map((row) => row.id),
  };
  if (wholeAt(input.whole, path, landing.root) || programmatic || !shared || judged === undefined) return Effect.succeed(whole);
  if (judged.verdict.verdict === 'proven' && judged.verdict.lines === 'unweighed') {
    if (!judged.verdict.hands.some((hand) => carriers.has(hand.holder)))
      return Effect.fail(
        heldBy(path, partners, holders, `${path} was selected without attribution and also has lines of ${holders.join(', ')}`),
      );
    return holders.includes(OPERATOR_KEY)
      ? Effect.fail(heldBy(path, partners, holders, `${path} depends on the operator's uncommitted bytes`))
      : Effect.succeed(whole);
  }
  const bytes: Readable = working.has(path) ? (working.get(path) as Readable) : UNWEIGHABLE;
  const was: Readable = base === null ? null : readable(bases.get(path));
  const uncut = (): Effect.Effect<never, GateRefusal<'walk-cut' | 'lines-held'>> =>
    judged.holding.verdict.verdict === 'proven' && holders.length > 0
      ? Effect.fail(
          heldBy(path, partners, holders, `${path} cannot be cut by lines, so it lands whole, and ${holders.join(', ')} changed it too`),
        )
      : Effect.fail(unproven(path, partners));
  if (bytes === UNWEIGHABLE || was === UNWEIGHABLE) return uncut();
  return Effect.flatMap(
    Effect.mapError(Effect.all([sideOf(landing.fns.walks, was), sideOf(landing.fns.walks, bytes)]), (failure) =>
      walkCut(path, failure, `carry ${path} as it stands (whole: ${JSON.stringify([path])}), or ${omitted(path, partners)}`),
    ),
    ([head, now]) =>
      (head.kind === 'text' || head.kind === 'absent') && (now.kind === 'text' || now.kind === 'absent')
        ? cutOf(landing, path, partners, holders, judged, whole, head, now)
        : uncut(),
  );
};

const cutOf = <Row extends PreparedRow>(
  landing: Landing<Row>,
  path: string,
  partners: ReadonlySet<string>,
  holders: readonly string[],
  judged: Judged,
  whole: Whole<Row>,
  head: TextContent,
  now: TextContent,
): Effect.Effect<Planned<Row> | null, GateRefusal<'walk-cut' | 'lines-held'>> => {
  const { carriers } = landing;
  if (judged.digests === null || judged.digests.head !== head.digest || judged.digests.working !== now.digest)
    return Effect.fail(moved(path, partners));
  const nobody = bearsNobody(landing.origin, landing.explicit, path);
  const chosen = selectFold(judged.verdict, head, now, { holders: carriers, nobody }, retiredOf(judged));
  if ('refuse' in chosen) {
    if (chosen.refuse === 'walk-cut') return Effect.fail(unproven(path, partners));
    return Effect.fail(
      heldBy(
        path,
        partners,
        chosen.holders,
        `${path} has lines of ${chosen.holders.join(', ')} inside the regions this landing would carry`,
      ),
    );
  }
  if (chosen.kind === 'none')
    return landing.explicit.has(path)
      ? Effect.fail(heldBy(path, partners, holders, `${path} was selected without attribution and also has lines of ${holders.join(', ')}`))
      : Effect.succeed(null);
  if (chosen.kind === 'whole' || chosen.text === null)
    return Effect.succeed({ ...whole, holders: [...new Set([...holders, ...chosen.carried.holders])] });
  return Effect.succeed({
    path,
    land: 'own',
    text: chosen.text,
    working: contentText(now) ?? '',
    positions: chosen.positions,
    lines: chosen.lines.flatMap((line) => (line.kind === 'added' ? [line.at] : [])),
    landed: { digest: contentDigest(chosen.text), head: head.digest, working: now.digest, pieces: chosen.pieces },
    holders: chosen.carried.holders,
    ids: chosen.rows,
  });
};

const PLANS_AT_ONCE = 4;

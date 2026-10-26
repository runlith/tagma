import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { ByteSize, Clock, type Context, Deferred, Effect, Exit, Fiber, FileSystem, Option, Schema } from 'effect';
import { commitMetaAt, type MergeTree } from '@runlith/git/merge';
import { mergeTreeApart } from '@runlith/git/apart';
import { Git } from '@runlith/git/Git';
import { commandFor, type GitAnswerInvalid, type GitRefused, GitUnreadable, pathsAt, run, runEnded } from '@runlith/git/repository';
import type { TicketClass } from '@runlith/held/Capacity';
import { actingGit } from '../../platform/git/ownGit.js';
import { Capacity, HEAVY } from '../../platform/contract/service/capacity.js';
import { MERGE_CHECKS } from '../capacity.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { CheckDriver, CheckPreparation, type MergeChecks, type MergeVerdict } from '../contract/service/mergeChecks.js';
import { worktreeMerge } from '../store/tables.js';

type Failed = GitUnreadable | GitRefused | GitAnswerInvalid;

type ConfigInput = { readonly path: string; readonly stamp: string | null };
type Fingerprint = { readonly digest: string; readonly inputs: readonly ConfigInput[] | null };
type ConfigLine = { readonly origin: string; readonly key: string; readonly value: string | null };

const configLines = (text: string): readonly ConfigLine[] | null => {
  if (text === '') return [];
  const records = text.split('\0');
  if (records.pop() !== '' || records.length % 2 !== 0) return null;
  const lines: ConfigLine[] = [];
  for (let at = 0; at < records.length; at += 2) {
    const origin = records[at];
    const entry = records[at + 1];
    const cut = entry?.indexOf('\n') ?? -1;
    if (origin === undefined || entry === undefined || entry === '' || cut === 0) return null;
    lines.push({ origin, key: cut < 0 ? entry : entry.slice(0, cut), value: cut < 0 ? null : entry.slice(cut + 1) });
  }
  return lines;
};

const fingerprintSchema = Schema.Union([
  Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  Schema.fromJsonString(
    Schema.Struct({
      digest: Schema.String,
      inputs: Schema.NullOr(Schema.Array(Schema.Struct({ path: Schema.String, stamp: Schema.NullOr(Schema.String) }))),
    }),
  ),
]);

type Taken = {
  readonly dir: string;
  readonly tip: string;
  readonly base: string;
  readonly baseTime: number;
  readonly driverRevision: string;
  readonly fingerprint: string;
  readonly inputs: readonly ConfigInput[] | null;
  readonly takenAt: number;
  readonly merged: MergeTree | null;
  readonly held: boolean;
  readonly problem: string | null;
};

type Completed = Taken & { readonly merged: MergeTree };

type Witness = {
  readonly dir: string;
  readonly base: string;
  readonly tip: string;
  readonly fingerprint: string;
  readonly inputs: readonly ConfigInput[] | null;
};

type Flight = {
  readonly witness: Witness;
  readonly epoch: object;
  readonly done: Deferred.Deferred<Completed, Failed>;
  readonly behind: boolean;
  klass: TicketClass;
  started: boolean;
  generation: number;
  fiber: Fiber.Fiber<Completed, Failed> | null;
};

const mergedSchema = Schema.fromJsonString(
  Schema.Struct({
    tree: Schema.String,
    conflicts: Schema.Array(Schema.String),
    yielded: Schema.Array(Schema.String),
  }),
);

const unreadable = (dir: string, reason: string): GitUnreadable => new GitUnreadable({ command: commandFor(dir, ['merge-tree']), reason });

const keyOf = (witness: Witness, revision: string): string =>
  `${witness.dir}\0${witness.base}\0${witness.tip}\0${revision}\0${witness.fingerprint}`;

export const makeMergeChecks = Effect.gen(function* () {
  const git = actingGit(yield* Git, 'worktree-merge-check');
  const files = yield* FileSystem.FileSystem;
  const driver = Option.getOrNull(yield* Effect.serviceOption(CheckDriver));
  const preparation = Option.getOrNull(yield* Effect.serviceOption(CheckPreparation));
  const capacity = yield* Capacity;
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const scope = yield* Effect.scope;
  const context = yield* Effect.context<never>();
  const revision = JSON.stringify([driver?.revision ?? null, preparation?.revision ?? null]);
  const version = yield* Effect.cached(run(git, '.', ['version'], undefined));
  const kept = new Map<string, Taken | null>();
  const epochs = new Map<string, object>();
  const epochOf = (dir: string): object => {
    const epoch = epochs.get(dir) ?? {};
    epochs.set(dir, epoch);
    return epoch;
  };
  const current = (dir: string, epoch: object): Effect.Effect<void, GitUnreadable> =>
    epochs.get(dir) === epoch ? Effect.void : Effect.fail(unreadable(dir, 'the merge check was forgotten before it could answer'));
  const failed = new Map<string, Witness>();
  const fingerprints = new Map<string, string>();
  const valid = new Map<string, Taken | null>();
  const flights = new Map<string, Flight>();
  const byDir = new Map<string, Set<Flight>>();
  const listeners = new Set<(dir: string) => void>();

  const announce = (dir: string): void => {
    for (const listener of listeners) listener(dir);
  };

  const stamp = Effect.fn('MergeChecks.configStamp')(function* (dir: string, path: string): Effect.fn.Return<string | null, GitUnreadable> {
    const info = yield* files.stat(path).pipe(
      Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(null)),
      Effect.mapError((failure) => unreadable(dir, `the merge config witness ${path} could not be read: ${failure.message}`)),
    );
    if (info === null) return null;
    const inode = Option.getOrNull(info.ino);
    const mtime = Option.getOrNull(Option.map(info.mtime, (date) => date.getTime()));
    if (info.type === 'Directory') return JSON.stringify([info.type, info.dev, inode]);
    if (mtime === null) return yield* unreadable(dir, `the modification time of merge config ${path} is unavailable`);
    return JSON.stringify([info.type, info.dev, inode, ByteSize.toBigInt(info.size).toString(), mtime]);
  });

  const validate = Effect.fn('MergeChecks.validateConfig')(function* (
    taken: Witness,
    reads: Map<string, Effect.Effect<string | null, GitUnreadable>>,
  ): Effect.fn.Return<boolean, GitUnreadable> {
    if (taken.inputs === null) return false;
    for (const input of taken.inputs) {
      let reading = reads.get(input.path);
      if (reading === undefined) {
        reading = yield* Effect.cached(stamp(taken.dir, input.path));
        reads.set(input.path, reading);
      }
      if ((yield* reading) !== input.stamp) return false;
    }
    const known = fingerprints.get(taken.dir);
    return known === undefined || known === taken.fingerprint;
  });

  const restore = Effect.fn('MergeChecks.restore')(function* (dirs: readonly string[]): Effect.fn.Return<void, GitUnreadable> {
    const missing = [...new Set(dirs.filter((dir) => !kept.has(dir)))];
    if (missing.length === 0) return;
    const restoring = new Map(missing.map((dir) => [dir, epochOf(dir)]));
    const rows = yield* units
      .read((unit) => unit.run(db.select().from(worktreeMerge).where(inArray(worktreeMerge.dir, missing)).all()))
      .pipe(Effect.mapError((failure) => unreadable(missing[0] ?? '.', `the saved merge verdicts could not be read: ${failure.message}`)));
    const loaded = new Map<string, Taken>();
    for (const row of rows) {
      const merged =
        row.merged === null
          ? null
          : yield* Schema.decodeUnknownEffect(mergedSchema)(row.merged).pipe(
              Effect.mapError((failure) => unreadable(row.dir, `the saved merge tree could not be read: ${failure.message}`)),
            );
      const fingerprint = yield* Schema.decodeUnknownEffect(fingerprintSchema)(row.fingerprint).pipe(
        Effect.mapError((failure) => unreadable(row.dir, `the saved merge config witness could not be read: ${failure.message}`)),
      );
      loaded.set(row.dir, {
        ...row,
        merged,
        fingerprint: typeof fingerprint === 'string' ? fingerprint : fingerprint.digest,
        inputs: typeof fingerprint === 'string' ? null : fingerprint.inputs,
      });
    }
    for (const dir of missing) if (!kept.has(dir) && epochs.get(dir) === restoring.get(dir)) kept.set(dir, loaded.get(dir) ?? null);
  });

  const saved = Effect.fnUntraced(function* (dir: string): Effect.fn.Return<Taken | null, GitUnreadable> {
    yield* restore([dir]);
    const taken = kept.get(dir) ?? null;
    if (taken !== null) {
      const epoch = epochs.get(dir);
      const accepted = yield* validate(taken, new Map());
      if (epoch === undefined || epochs.get(dir) !== epoch || kept.get(dir) !== taken) return null;
      valid.set(dir, accepted ? taken : null);
    }
    return taken;
  });

  const save = Effect.fn('MergeChecks.save')(function* (taken: Taken, epoch: object): Effect.fn.Return<void, GitUnreadable> {
    const { inputs, ...fields } = taken;
    const row = {
      ...fields,
      fingerprint: JSON.stringify({ digest: taken.fingerprint, inputs }),
      merged: taken.merged === null ? null : JSON.stringify(taken.merged),
    };
    yield* units
      .write('worktree.merge-verdict', (unit) =>
        Effect.gen(function* () {
          yield* current(taken.dir, epoch);
          yield* unit.run(db.insert(worktreeMerge).values(row).onConflictDoUpdate({ target: worktreeMerge.dir, set: row }));
        }),
      )
      .pipe(Effect.mapError((failure) => unreadable(taken.dir, `the merge verdict could not be saved: ${failure.message}`)));
    yield* current(taken.dir, epoch);
    kept.set(taken.dir, taken);
    valid.set(taken.dir, inputs !== null ? taken : null);
  });

  const fingerprint = Effect.fn('MergeChecks.fingerprint')(function* (dir: string, epoch: object): Effect.fn.Return<Fingerprint, Failed> {
    const [commonDir = '', gitDir = ''] = yield* pathsAt(git, dir, ['--git-common-dir', '--git-dir'], undefined);
    const sources = new Set([join(commonDir, 'config'), join(gitDir, 'config.worktree'), join(gitDir, 'HEAD'), join(dir, '.git')]);
    const listing = yield* run(git, dir, ['config', '-z', '--show-origin', '--includes', '--list'], 256 * 1024);
    const lines = configLines(listing);
    if (lines === null) return yield* unreadable(dir, 'git config printed no origin/value pairs');
    let complete = true;
    const originPath = (origin: string): string | null => (origin.startsWith('file:') ? resolve(dir, origin.slice(5)) : null);
    for (const line of lines) {
      const path = originPath(line.origin);
      if (path !== null) sources.add(path);
      else if (line.origin !== 'command line:') complete = false;
      else if (/^(merge\.|diff\.renames$|include)/u.test(line.key)) complete = false;
    }
    const included = yield* runEnded(
      git,
      dir,
      ['config', '-z', '--show-origin', '--includes', '--type=path', '--get-regexp', '^include(if\\..*)?\\.path$'],
      256 * 1024,
      [1],
    );
    const includes = configLines(included.stdout);
    if (includes === null) return yield* unreadable(dir, 'git config printed no included path witnesses');
    for (const line of includes) {
      if (line.value === null) return yield* unreadable(dir, 'git config named an include without a path');
      const origin = originPath(line.origin);
      if (isAbsolute(line.value)) sources.add(line.value);
      else if (origin !== null) sources.add(resolve(dirname(origin), line.value));
      else complete = false;
    }
    const inputs = yield* Effect.forEach(sources, (path) => Effect.map(stamp(dir, path), (stamp) => ({ path, stamp })), { concurrency: 3 });
    const confirmed = yield* run(git, dir, ['config', '-z', '--show-origin', '--includes', '--list'], 256 * 1024);
    if (confirmed !== listing) return yield* unreadable(dir, 'the merge configuration changed while its witness was being read');
    const digest = createHash('sha256')
      .update(yield* version)
      .update('\0');
    for (const line of lines)
      if (/^(merge\.|diff\.renames$)/u.test(line.key))
        digest.update(line.value === null ? `${line.key}\0` : `${line.key}\n${line.value}\0`);
    const value = digest.digest('hex');
    yield* current(dir, epoch);
    fingerprints.set(dir, value);
    return { digest: value, inputs: complete ? inputs : null };
  });

  const matching = (taken: Taken | null, witness: Witness): taken is Taken =>
    taken !== null &&
    taken.tip === witness.tip &&
    taken.base === witness.base &&
    taken.driverRevision === revision &&
    taken.fingerprint === witness.fingerprint;

  const pending = (dir: string, tip: string, base?: string): Flight | undefined => {
    for (const one of byDir.get(dir) ?? []) if (one.witness.tip === tip && (base === undefined || one.witness.base === base)) return one;
    return undefined;
  };

  const verdict = (taken: Taken | null, dir: string, tip: string, base?: string): MergeVerdict => {
    const flying = pending(dir, tip);
    return {
      check:
        flying?.behind === true
          ? 'format-behind'
          : taken?.merged === null || taken === null
            ? 'unknown'
            : taken.merged.conflicts.length > 0
              ? 'conflicts'
              : 'clean',
      held: taken?.held ?? false,
      fact: {
        state:
          flying !== undefined
            ? 'queued'
            : taken === null
              ? 'untaken'
              : taken.tip === tip &&
                  (base === undefined || taken.base === base) &&
                  taken.driverRevision === revision &&
                  valid.get(dir) === taken
                ? 'current'
                : 'previous',
        head: taken?.tip ?? tip,
        base: taken?.base ?? base ?? null,
        baseTime: taken?.baseTime ?? null,
        takenAt: taken?.takenAt ?? null,
        driverRevision: taken?.driverRevision,
        fingerprint: taken?.fingerprint,
      },
    };
  };

  const measured = Effect.fnUntraced(function* (witness: Witness, epoch: object): Effect.fn.Return<Completed, Failed> {
    const { dir, base, tip } = witness;
    const meta = yield* commitMetaAt(git, dir, base);
    const baseTime = Number(meta.author.date.split(' ')[0]) * 1000;
    if (!Number.isFinite(baseTime)) return yield* unreadable(dir, `the commit date of ${base} could not be read`);
    const result = yield* Effect.result(
      Effect.gen(function* () {
        const prepared = preparation === null ? tip : yield* preparation.prepare(dir, base, tip);
        const merged = yield* mergeTreeApart(git, dir, base, prepared, driver === null ? {} : { driver });
        return { merged, held: merged.conflicts.length === 0 && merged.yielded.length === 0 && merged.tree === meta.tree };
      }),
    );
    const taken: Taken = {
      ...witness,
      baseTime,
      driverRevision: revision,
      takenAt: yield* Clock.currentTimeMillis,
      merged: result._tag === 'Success' ? result.success.merged : null,
      held: result._tag === 'Success' && result.success.held,
      problem: result._tag === 'Failure' ? result.failure.message : null,
    };
    yield* save(taken, epoch);
    if (result._tag === 'Failure') return yield* result.failure;
    return { ...taken, merged: result.success.merged };
  });

  const start = Effect.fnUntraced(function* (key: string, flight: Flight) {
    const generation = flight.generation;
    const work = capacity
      .ticket(
        {
          name: 'worktree-merge-check',
          class: flight.klass,
          needs: [
            { pool: HEAVY, units: 1 },
            { pool: MERGE_CHECKS, units: 1 },
          ],
        },
        Effect.suspend(() => {
          flight.started = true;
          return Effect.andThen(current(flight.witness.dir, flight.epoch), measured(flight.witness, flight.epoch));
        }),
      )
      .pipe(
        Effect.mapError((failure) =>
          failure._tag === 'CapacityBusy' || failure._tag === 'HoldStalled' ? unreadable(flight.witness.dir, failure.message) : failure,
        ),
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (generation !== flight.generation) return;
            if (flights.get(key) === flight) flights.delete(key);
            const siblings = byDir.get(flight.witness.dir);
            siblings?.delete(flight);
            if (siblings?.size === 0) byDir.delete(flight.witness.dir);
            if (Exit.hasInterrupts(exit) || epochs.get(flight.witness.dir) !== flight.epoch) {
              Deferred.doneUnsafe(
                flight.done,
                Effect.fail(unreadable(flight.witness.dir, 'the merge check was stopped before it answered')),
              );
              return;
            }
            if (Exit.isSuccess(exit)) failed.delete(flight.witness.dir);
            else failed.set(flight.witness.dir, flight.witness);
            Deferred.doneUnsafe(flight.done, exit);
            announce(flight.witness.dir);
          }),
        ),
        Effect.withSpan('MergeChecks.flight', { root: true }),
        Effect.interruptible,
      );
    flight.fiber = yield* Effect.forkIn(
      Effect.updateContext(work, (_: Context.Context<never>) => context),
      scope,
    );
  });

  const prioritize = Effect.fn('MergeChecks.prioritize')(function* (
    key: string,
    flying: Flight,
    klass: TicketClass,
  ): Effect.fn.Return<Flight> {
    if (klass === 'call' && flying.klass === 'background' && !flying.started) {
      flying.generation += 1;
      flying.klass = 'call';
      if (flying.fiber !== null) yield* Fiber.interrupt(flying.fiber);
      yield* start(key, flying);
    }
    return flying;
  }, Effect.uninterruptible);

  const flight = Effect.fnUntraced(function* (
    witness: Witness,
    klass: TicketClass,
    epoch: object,
    reuse: boolean,
  ): Effect.fn.Return<Flight | Completed, Failed> {
    yield* current(witness.dir, epoch);
    const key = keyOf(witness, revision);
    const flying = flights.get(key);
    if (flying !== undefined) return yield* prioritize(key, flying, klass);
    const behind = preparation !== null && (yield* preparation.behind(witness.dir, witness.base, witness.tip));
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* current(witness.dir, epoch);
        const raced = flights.get(key);
        if (raced !== undefined) return yield* prioritize(key, raced, klass);
        const landed = kept.get(witness.dir) ?? null;
        if (reuse && matching(landed, witness) && landed.merged !== null) return { ...landed, merged: landed.merged };
        const one: Flight = {
          witness,
          epoch,
          done: yield* Deferred.make<Completed, Failed>(),
          behind,
          klass,
          started: false,
          generation: 0,
          fiber: null,
        };
        flights.set(key, one);
        const siblings = byDir.get(witness.dir) ?? new Set<Flight>();
        siblings.add(one);
        byDir.set(witness.dir, siblings);
        yield* start(key, one);
        return one;
      }),
    );
  });

  const taken = Effect.fnUntraced(function* (dir: string, base: string, tip: string, fresh: boolean): Effect.fn.Return<Completed, Failed> {
    const epoch = epochOf(dir);
    const config = yield* fingerprint(dir, epoch);
    const witness = { dir, base, tip, fingerprint: config.digest, inputs: config.inputs };
    const standing = yield* saved(dir);
    const answer =
      !fresh && matching(standing, witness) && standing.merged !== null
        ? { ...standing, merged: standing.merged }
        : yield* flight(witness, 'call', epoch, !fresh);
    if ('done' in answer) return yield* Deferred.await(answer.done);
    const renewed = { ...answer, inputs: config.inputs, merged: answer.merged };
    if (JSON.stringify(answer.inputs) !== JSON.stringify(config.inputs)) yield* save(renewed, epoch);
    return renewed;
  });

  return {
    check: (dir, base, tip) => Effect.map(taken(dir, base, tip, false), (one) => one.merged),
    holds: (dir, base, tip) => Effect.map(taken(dir, base, tip, false), (one) => one.held),
    fresh: (dir, base, tip) => Effect.map(taken(dir, base, tip, true), (one) => one.merged),
    saved: Effect.fn('MergeChecks.saved')(function* (dirs) {
      yield* restore(dirs);
      const answer = new Map<string, MergeVerdict>();
      const reads = new Map<string, Effect.Effect<string | null, GitUnreadable>>();
      for (const dir of dirs) {
        const one = kept.get(dir);
        if (one != null) {
          const epoch = epochs.get(dir);
          const accepted = yield* validate(one, reads);
          if (epoch !== undefined && epochs.get(dir) === epoch && kept.get(dir) === one) {
            valid.set(dir, accepted ? one : null);
            answer.set(dir, verdict(one, dir, one.tip));
          }
        }
      }
      return answer;
    }),
    last: Effect.fn('MergeChecks.last')(function* (dir, tip, base) {
      return verdict(yield* saved(dir), dir, tip, base);
    }),
    standing: Effect.fn('MergeChecks.standing')(function* (dir, base, tip, start) {
      const epoch = epochOf(dir);
      let standing = yield* saved(dir);
      const known = fingerprints.get(dir);
      const unchanged =
        standing !== null &&
        standing.tip === tip &&
        standing.driverRevision === revision &&
        (standing.inputs === null || valid.get(dir) === standing) &&
        (known === undefined || known === standing.fingerprint);
      const failure = failed.get(dir);
      const alreadyFailed =
        failure?.tip === tip && failure.fingerprint === known && (failure.inputs === null || (yield* validate(failure, new Map())));
      if (start && !unchanged && !alreadyFailed && pending(dir, tip) === undefined) {
        const config = yield* fingerprint(dir, epoch);
        if (standing !== null && standing.tip === tip && standing.driverRevision === revision && standing.fingerprint === config.digest) {
          standing = { ...standing, inputs: config.inputs };
          yield* save(standing, epoch);
        } else {
          const witness = { dir, base, tip, fingerprint: config.digest, inputs: config.inputs };
          const answer = yield* flight(witness, 'background', epoch, true);
          if (!('done' in answer)) standing = kept.get(dir) ?? null;
        }
      }
      return verdict(standing, dir, tip, base);
    }),
    onTaken: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    forget: Effect.fn('MergeChecks.forget')(function* (dir) {
      epochs.delete(dir);
      const flying = [...(byDir.get(dir) ?? [])].flatMap((one) => (one.fiber === null ? [] : [one.fiber]));
      yield* Fiber.interruptAll(flying);
      yield* units
        .write('worktree.forget-merge-verdict', (unit) => unit.run(db.delete(worktreeMerge).where(eq(worktreeMerge.dir, dir))))
        .pipe(Effect.mapError((failure) => unreadable(dir, `the saved merge verdict could not be forgotten: ${failure.message}`)));
      epochs.delete(dir);
      kept.delete(dir);
      failed.delete(dir);
      fingerprints.delete(dir);
      valid.delete(dir);
    }),
  } satisfies MergeChecks;
});

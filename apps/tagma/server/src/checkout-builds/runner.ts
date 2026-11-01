import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from 'node:fs';
import { appendFile, mkdir, open, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect, Layer, PubSub, Schema, Stream } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { gitLayer } from '@runlith/git/Git';
import { makeCheckoutReading, type RunningRevision } from './reading.js';
import { OWN_GIT_VARIABLE } from '../platform/contract/service/credentials.js';
import { ownGitLayer } from '../platform/git/ownGit.js';
import {
  BUILD_COMMAND,
  BUILD_HOME_ENV,
  BUILD_SWAPPED_ENV,
  BUILD_WORKTREE_ENV,
  revisionLabel,
} from '../installation/contract/wire/layout.js';
import { currentVersion, releasesNewestFirst } from '../installation/closure/versions.js';
import { declaredSubmodules, SUBMODULE_PATHS } from '../installation/cut/source.js';
import { type InstallRefused, NextInstallation, type StopRefused } from '../installation/contract/service/next.js';
import type { NextFrame } from '../installation/contract/wire/next.js';
import {
  type BuildEnded,
  buildEndedSchema,
  buildFromSchema,
  type BuildRunning,
  buildRunningSchema,
  type BuildStep,
  type CheckoutFrame,
} from './record.js';
import { actsOf, backOf, installedOf, installingOf, offersOf, standingOf, updateOf } from './offers.js';
import { commandOf, endGroup } from './group.js';

const HOST = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

const submoduleRepositories = async (repository: string, env: Record<string, string | undefined>): Promise<readonly string[]> => {
  if (!existsSync(join(repository, '.gitmodules'))) return [];
  const listed = Bun.spawn(['git', '-C', repository, ...SUBMODULE_PATHS], { env, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
  const [output, code] = await Promise.all([new Response(listed.stdout).text(), listed.exited]);
  if (code !== 0) return [];
  const direct = declaredSubmodules(output).map((path) => join(repository, path));
  return [...direct, ...(await Promise.all(direct.map((nested) => submoduleRepositories(nested, env)))).flat()];
};

const TAIL_BYTES = 4096;
const TAIL_LINES = 20;

const SWAPPED_NOTE = 'build.swapped';

const heldSchema = Schema.Struct({ pid: Schema.Int, command: Schema.String });
type Held = typeof heldSchema.Type;

export type CheckoutBuildsOptions = {
  readonly checkout: string | undefined;
  readonly log: string;
  readonly worktrees: string;
  readonly installations?: string;
  readonly record?: string;
  readonly running?: RunningRevision | null;
  readonly restart?: () => Promise<string | null>;
  readonly runtime?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly landed?: () => Promise<string | null>;
  readonly now?: () => number;
};

const tookSchema = Schema.Struct({
  head: Schema.NullOr(Schema.Number),
  tree: Schema.NullOr(Schema.Number),
  back: Schema.NullOr(Schema.Number),
});
type Took = typeof tookSchema.Type;

const keptSchema = Schema.Struct({
  running: Schema.NullOr(buildRunningSchema),
  ended: Schema.NullOr(buildEndedSchema),
  took: tookSchema,
  held: Schema.NullOr(heldSchema),
  worktree: Schema.NullOr(Schema.String),
});

const decodeKept = Schema.decodeUnknownResult(Schema.fromJsonString(keptSchema));
const encodeKept = Schema.encodeSync(Schema.fromJsonString(keptSchema, { space: 2 }));
const isFrom = Schema.is(buildFromSchema);

// eslint-disable-next-line no-control-regex
const ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007|\r/g;

const tailOf = (path: string, from: number, lines: number): string[] => {
  let handle: number | null = null;
  try {
    handle = openSync(path, 'r');
    const size = fstatSync(handle).size;
    const start = Math.max(from, size - TAIL_BYTES);
    if (start >= size) return [];
    const bytes = Buffer.alloc(size - start);
    readSync(handle, bytes, 0, bytes.length, start);
    const text = bytes.toString('utf8').replace(ESCAPES, '');
    return text
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .slice(-lines);
  } catch {
    return [];
  } finally {
    if (handle !== null) closeSync(handle);
  }
};

const previousOf = (installations: string | undefined): string | null => {
  if (installations === undefined) return null;
  const standing = currentVersion(installations);
  const versions = releasesNewestFirst(installations);
  const at = standing === null ? -1 : versions.indexOf(standing);
  return at < 0 ? null : (versions[at + 1] ?? null);
};

const occupied = (busy: BuildRunning): InstallRefused => ({
  code: 'install-running',
  reason: `a build from ${busy.from} ${busy.revision} is running since ${busy.since}, and this call did not name it as the one to stop`,
  unblock: [
    "install_next again: it names the build that runs now, and stops it first with the operator's word",
    'tagma status — where it stands',
  ],
});

const restarting = (busy: BuildRunning): InstallRefused & StopRefused => ({
  code: 'install-restarting',
  reason: `the build from ${busy.from} ${busy.revision} landed and the restart onto it is already asked`,
  unblock: [
    'tagma status — where the server stands once the successor answers',
    'tagma update --back — step back onto the version kept beside it',
  ],
});

export const makeCheckoutBuilds = Effect.fnUntraced(function* (options: CheckoutBuildsOptions) {
  const source = yield* makeCheckoutReading({ path: options.checkout, running: options.running ?? null });
  const shifts = yield* Effect.acquireRelease(PubSub.sliding<void>(1), PubSub.shutdown);
  let running: { readonly record: BuildRunning; readonly offset: number } | null = null;
  let ended: BuildEnded | null = null;
  let took: Took = { head: null, tree: null, back: null };
  let finishing: Promise<void> | null = null;
  let group: Held | null = null;
  let cut: string | null = null;
  let stopping: Promise<void> | null = null;
  let offered: NextFrame | null = null;
  let offeredSource: CheckoutFrame | null = null;
  let offeredSince: string | null = null;
  let offeredStep: BuildStep | null = null;
  let revision = 0;

  const now = (): number => (options.now === undefined ? Date.now() : options.now());

  const runningRecord = (): BuildRunning | null =>
    running === null ? null : { ...running.record, tail: tailOf(options.log, running.offset, 1)[0] ?? null };

  const nextOf = (frame: CheckoutFrame): NextFrame => {
    if (offeredSource !== null && frame.revision < offeredSource.revision) frame = offeredSource;
    const building = running?.record ?? null;
    const since = building?.since ?? null;
    const step = building?.step ?? null;
    if (offered !== null && offeredSource?.revision === frame.revision && offeredSince === since && offeredStep === step) return offered;
    const denied = frame.issue?.reason ?? (building === null ? null : 'an installation is running');
    offered = {
      instance: frame.instance,
      pid: frame.pid,
      revision: ++revision,
      readAt: frame.readAt,
      readFrom: null,
      watched: frame.watched,
      issue: frame.issue,
      standing: standingOf(frame.checkout),
      offers: offersOf(frame.checkout, denied),
      update: updateOf(frame.checkout, denied),
      back: backOf(frame.checkout, previousOf(options.installations), denied),
      installing: building === null ? null : installingOf(building),
      installed: ended === null ? null : installedOf(ended),
      acts: actsOf(building),
    };
    offeredSource = frame;
    offeredSince = since;
    offeredStep = step;
    return offered;
  };

  const reading = Effect.map(source.read, (frame) => {
    const next = nextOf(frame);
    const record = runningRecord();
    return record === null ? next : { ...next, installing: installingOf(record) };
  });

  const changes =
    options.checkout === undefined
      ? Stream.concat(Stream.fromEffect(reading), Stream.never)
      : yield* Stream.share(
          Stream.merge(
            source.changes,
            Stream.mapEffect(Stream.fromPubSub(shifts), () => source.read),
          ).pipe(Stream.map(nextOf)),
          { capacity: 1, strategy: 'sliding', replay: 1 },
        );

  const reap = async (held: Held | null, worktree: string | null): Promise<void> => {
    if (held !== null && (await commandOf(held.pid)) === held.command) await endGroup(held.pid);
    const checkout = options.checkout;
    if (worktree === null || checkout === undefined) return;
    const env = { ...process.env, [OWN_GIT_VARIABLE]: '1' };
    await Bun.spawn(['git', '-C', checkout, 'worktree', 'remove', '--force', '--force', worktree], {
      env,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    }).exited.catch(() => undefined);
    await rm(worktree, { recursive: true, force: true }).catch(() => undefined);
    for (const repository of [checkout, ...(await submoduleRepositories(checkout, env))])
      await Bun.spawn(['git', '-C', repository, 'worktree', 'prune'], {
        env,
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
      }).exited.catch(() => undefined);
  };

  const halt = async (building: BuildRunning): Promise<BuildEnded | null> => {
    if (stopping === null) stopping = group === null ? Promise.resolve() : endGroup(group.pid);
    if (finishing !== null) await finishing;
    return ended !== null && ended.since === building.since ? ended : null;
  };

  const endedAs = (
    started: BuildRunning,
    outcome: BuildEnded['outcome'],
    build: string | null,
    detail: string,
    tail: readonly string[],
  ): BuildEnded => ({
    from: started.from,
    revision: started.revision,
    outcome,
    build,
    detail,
    endedAt: new Date(now()).toISOString(),
    log: started.log,
    since: started.since,
    tail,
    then: started.then,
    restartRefused: null,
  });

  const stepped = (step: BuildStep): void => {
    if (running === null) return;
    running = { ...running, record: { ...running.record, step } };
    PubSub.publishUnsafe(shifts, undefined);
  };

  const readKept = () => {
    const at = options.record;
    if (at === undefined || !existsSync(at)) return null;
    const decoded = decodeKept(readFileSync(at, 'utf8'));
    if (decoded._tag === 'Success') return decoded.success;
    const aside = `${at}.unread`;
    renameSync(at, aside);
    console.warn(`[tagma] the build record did not read, so it was set aside at ${aside}: ${decoded.failure.message}`);
    return null;
  };

  const keep = (building: BuildRunning | null, last: BuildEnded | null): void => {
    PubSub.publishUnsafe(shifts, undefined);
    const at = options.record;
    if (at === undefined) return;
    try {
      mkdirSync(dirname(at), { recursive: true });
      const passing = `${at}.${process.pid}`;
      writeFileSync(
        passing,
        encodeKept({
          running: building === null ? null : { ...building, tail: null },
          ended: last,
          took,
          held: building === null ? null : group,
          worktree: building === null ? null : cut,
        }),
        { mode: 0o600 },
      );
      renameSync(passing, at);
    } catch {}
  };

  const settle = async (finished: BuildEnded): Promise<void> => {
    if (finished.outcome === 'landed' && finished.since !== null) {
      took = { ...took, [finished.from]: Date.parse(finished.endedAt) - Date.parse(finished.since) };
    }
    const landed =
      finished.outcome === 'landed' && finished.then === 'restart' && stopping !== null
        ? { ...finished, restartRefused: 'the build was stopped after it landed, before the restart was asked' }
        : finished;
    if (landed.outcome !== 'landed' || landed.then !== 'restart' || landed.restartRefused !== null) {
      ended = landed;
      running = null;
      keep(null, landed);
      return;
    }
    stepped('restart');
    keep(null, landed);
    await appendFile(options.log, `=== then restart, asked by pid ${process.pid} ===\n`).catch(() => undefined);
    const refused =
      options.restart === undefined
        ? 'this server was given no way to restart itself'
        : await options.restart().catch((cause: unknown) => `the restart could not be asked: ${String(cause)}`);
    await appendFile(
      options.log,
      refused === null ? '=== restart asked: the successor stands by ===\n' : `=== restart refused: ${refused} ===\n`,
    ).catch(() => undefined);
    ended = refused === null ? landed : { ...landed, restartRefused: refused };
    running = null;
    PubSub.publishUnsafe(shifts, undefined);
    if (refused !== null) keep(null, ended);
  };

  const run = async (checkout: string, started: BuildRunning): Promise<BuildEnded> => {
    await mkdir(dirname(options.log), { recursive: true });
    const sink = await open(options.log, 'a');
    const runtime = options.runtime ?? process.execPath;
    const inherited = options.env ?? process.env;
    const env = { ...inherited, HOME: inherited[BUILD_HOME_ENV] ?? inherited.HOME };
    const say = (line: string) => sink.write(`${line}\n`);
    const note = join(dirname(options.log), SWAPPED_NOTE);
    const step = async (title: string, command: readonly string[], cwd: string, more: Record<string, string> = {}): Promise<number> => {
      await say(`\n--- ${title}: ${command.join(' ')} (in ${cwd}) ---`);
      if (stopping !== null) return -1;
      const child = Bun.spawn([...command], {
        cwd,
        env: { ...env, ...more },
        stdin: 'ignore',
        stdout: sink.fd,
        stderr: sink.fd,
        detached: true,
      });
      group = { pid: child.pid, command: command.join(' ') };
      keep(running?.record ?? started, ended);
      try {
        const code = await child.exited;
        if (stopping !== null) await stopping;
        return code;
      } finally {
        group = null;
      }
    };
    const standing = (): Promise<string | null> =>
      options.landed === undefined ? Promise.resolve(null) : options.landed().catch(() => null);
    const decided = async (): Promise<readonly [BuildEnded['outcome'], string | null, string]> => {
      if (started.from === 'back') {
        const code = await step('back', [runtime, 'run', 'tagma:build', '--back', '--no-restart'], checkout);
        if (code !== 0) return ['failed', null, `${BUILD_COMMAND} --back ended with code ${code}`];
        const build = await standing();
        return ['landed', build, build === null ? 'the previous installation stands' : `installation ${build} stands again`];
      }
      cut = started.from === 'head' ? join(options.worktrees, `head-${started.since.replace(/[-:.]/g, '')}`) : null;
      stepped('build');
      const origin = cut === null ? [] : ['--origin', checkout];
      await rm(note, { force: true });
      const code = await step(
        'build',
        [runtime, 'run', 'tagma:build', '--no-restart', ...(started.from === 'tree' ? ['--tree'] : []), ...origin],
        checkout,
        {
          [BUILD_SWAPPED_ENV]: note,
          ...(cut === null ? {} : { [BUILD_WORKTREE_ENV]: cut }),
        },
      );
      if (code !== 0) return ['failed', null, `${BUILD_COMMAND} ended with code ${code}`];
      const build = await standing();
      return ['landed', build, build === null ? 'the build landed' : `installation ${build} stands; tagma restart brings it up`];
    };
    const stoppedAs = async (at: BuildStep): Promise<readonly [BuildEnded['outcome'], string | null, string]> => {
      if (!existsSync(note)) return ['stopped', null, `stopped at the ${at} step; nothing landed`];
      const build = await standing();
      return ['landed', build, `stopped after installation ${build ?? 'it built'} had become current; tagma restart brings it up`];
    };
    try {
      await say(
        `\n=== tagma build ${started.from} ${started.revision} started ${started.since} by pid ${process.pid}${started.then === null ? '' : `, then ${started.then}`} ===`,
      );
      if (running !== null) running = { ...running, offset: (await sink.stat()).size };
      const decision = await decided();
      const stoppedAt = running?.record.step ?? started.step;
      const [outcome, build, detail] = decision[0] !== 'failed' || stopping === null ? decision : await stoppedAs(stoppedAt);
      const last = endedAs(
        started,
        outcome,
        build,
        detail,
        outcome === 'failed' ? tailOf(options.log, running?.offset ?? 0, TAIL_LINES) : [],
      );
      await say(`=== tagma build ${started.from} ${started.revision} ${outcome} ${last.endedAt}: ${detail} ===`);
      return last;
    } finally {
      if (cut !== null && existsSync(cut)) await reap(null, cut);
      cut = null;
      await sink.close();
    }
  };

  const kept = readKept();
  if (kept !== null) {
    took = kept.took;
    if (kept.running === null) ended = kept.ended;
    else {
      ended = endedAs(kept.running, 'failed', null, 'the server that ran this build ended before the build did', []);
      keep(null, ended);
      void reap(kept.held, kept.worktree);
    }
  }

  return NextInstallation.of({
    reading,
    changes,
    installing: Effect.sync(() => {
      const record = runningRecord();
      return record === null ? null : installingOf(record);
    }),
    install: Effect.fn('NextInstallation.install')(function* (offer, then, replacing) {
      if (!isFrom(offer)) {
        return yield* Effect.fail<InstallRefused>({
          code: 'no-offer',
          reason: `${offer} is no next installation of a checkout; it offers head, tree and back`,
          unblock: ['tagma status — the next installations offered here'],
        });
      }
      const checkout = yield* Effect.flatMap(source.read, (frame) =>
        frame.issue === null ? Effect.succeed(frame.checkout) : Effect.fail<InstallRefused>(frame.issue),
      );
      if (checkout === null) {
        return yield* Effect.fail<InstallRefused>({
          code: 'no-offer',
          reason:
            options.checkout === undefined
              ? 'this Tagma was installed, not cut from a checkout on this machine; there is nothing to build from'
              : `${options.checkout}, the checkout this Tagma was cut from, does not stand here as a Tagma checkout`,
          unblock: [`${BUILD_COMMAND} — at a Tagma checkout root, builds that checkout and makes it the installation that stands`],
        });
      }
      if (offer === 'head' && checkout.head === null) {
        return yield* Effect.fail<InstallRefused>({
          code: 'offer-unavailable',
          reason: `${checkout.path} is not a git checkout, so it has no HEAD to cut cleanly`,
          unblock: ['tagma build --tree — build the tree as it stands'],
        });
      }
      const standing = running?.record ?? null;
      if (standing !== null && standing.step === 'restart') return yield* Effect.fail(restarting(standing));
      if (standing !== null && standing.since !== replacing) return yield* Effect.fail(occupied(standing));
      const replaced = standing === null ? null : yield* Effect.promise(() => halt(standing));
      if (running !== null) return yield* Effect.fail(occupied(running.record));
      const started: BuildRunning = {
        from: offer,
        revision:
          offer === 'back'
            ? (previousOf(options.installations) ?? 'previous')
            : revisionLabel(checkout.head === null ? null : { head: checkout.head, dirty: offer === 'tree' && checkout.dirty }),
        since: new Date(now()).toISOString(),
        log: options.log,
        then: offer === 'back' ? 'restart' : then,
        step: offer === 'head' ? 'worktree' : offer === 'back' ? 'back' : 'build',
        tail: null,
        usually: took[offer],
      };
      running = { record: started, offset: Number.POSITIVE_INFINITY };
      stopping = null;
      keep(started, ended);
      finishing = run(checkout.path, started).then(
        (last) => settle(last),
        (cause: unknown) => settle(endedAs(started, 'failed', null, `the build could not be run: ${String(cause)}`, [])),
      );
      return { installing: installingOf(started), replaced: replaced === null ? null : installedOf(replaced) };
    }),
    stop: Effect.fn('NextInstallation.stop')(function* () {
      const standing = running;
      if (standing === null) {
        return yield* Effect.fail<StopRefused>({
          code: 'nothing-installing',
          reason: 'no build is running, so there is nothing to stop',
          unblock: ['tagma status — where the server stands'],
        });
      }
      if (standing.record.step === 'restart') return yield* Effect.fail(restarting(standing.record));
      const last = yield* Effect.promise(() => halt(standing.record));
      if (last === null) {
        return yield* Effect.fail<StopRefused>({
          code: 'nothing-installing',
          reason: 'the build ended and left no record of how',
          unblock: [`${standing.record.log} — what it printed`],
        });
      }
      return installedOf(last);
    }),
  });
});

export const checkoutBuildsLayer = (options: CheckoutBuildsOptions) =>
  Layer.effect(NextInstallation, makeCheckoutBuilds(options)).pipe(Layer.provide(ownGitLayer(gitLayer.pipe(Layer.provide(HOST)))));

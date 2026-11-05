import { basename, join, dirname } from 'node:path';
import type { PlatformError } from 'effect/PlatformError';
import { Cause, Clock, Data, Effect, Exit, Fiber, FileSystem, Layer, PubSub, Schema, Scope, Semaphore, Stream } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { gitLayer } from '@runlith/git/Git';
import { makeCheckoutReading, type RunningRevision } from './reading.js';
import { OWN_GIT_VARIABLE } from '../platform/contract/service/credentials.js';
import { ownGitLayer } from '../platform/git/ownGit.js';
import { answered, commandOf, endGroup } from '../platform/command.js';
import { makeKeptRecord } from '../platform/durable/keptRecord.js';
import { logLine, logSink, shownTail, sizeOf } from '../platform/durable/logFile.js';
import {
  BUILD_COMMAND,
  BUILD_HOME_ENV,
  BUILD_REFUSED_ENV,
  BUILD_SWAPPED_ENV,
  BUILD_WORKTREE_ENV,
  revisionLabel,
} from '../installation/contract/wire/layout.js';
import { releaseAt } from '../installation/closure/manifests.js';
import { steppedBack } from '../installation/closure/moves.js';
import { previousRelease } from '../installation/closure/versions.js';
import { DowngradeSteps } from '../installation/contract/service/steps.js';
import { downgradePreflight } from '../installation/operations/downgrade.js';
import { stepBackFailure } from '../installation/process/returning.js';
import { declaredSubmodules, SUBMODULE_PATHS } from '../cut/snapshot.js';
import { type InstallRefused, NextInstallation, RestartRefused, type StopRefused } from '../installation/contract/service/next.js';
import { askedRestart, occupied, restarting } from '../installation/next/asking.js';
import type { Installation, InstallationFailure } from '../installation/contract/wire/manifest.js';
import { type InstallRefusal, installRefusalSchema, type NextFrame } from '../installation/contract/wire/next.js';
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
import { BuildSteps } from './contract/service/steps.js';

const HOST = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

const TAIL_BYTES = 4096;
const TAIL_LINES = 20;

const SWAPPED_NOTE = 'build.swapped';

const REFUSED_NOTE = 'build.refused';

const PENDING_ASKED_AGAIN = '1 second';

const NO_RESTART = 'this server was given no way to restart itself';

class BuildNotRun extends Data.TaggedError('BuildNotRun')<{ readonly message: string }> {}

const decodeRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(installRefusalSchema));

const refusalsIn = (text: string): InstallRefusal | undefined => {
  const said = text.split('\n').flatMap((line) => {
    const read = line === '' ? null : decodeRefusal(line);
    return read !== null && read._tag === 'Success' ? [read.success] : [];
  });
  const cause = said[0];
  if (cause === undefined) return undefined;
  return { code: cause.code, reason: cause.reason, unblock: [...new Set(said.flatMap((one) => one.unblock))] };
};

const heldSchema = Schema.Struct({ pid: Schema.Int, command: Schema.String });
type Held = typeof heldSchema.Type;

export type CheckoutBuildsOptions = {
  readonly checkout: string | undefined;
  readonly log: string;
  readonly worktrees: string;
  readonly installations?: string;
  readonly record?: string;
  readonly running?: RunningRevision | null;
  readonly restart?: Effect.Effect<void, RestartRefused>;
  readonly runtime?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly landed?: Effect.Effect<string | null, InstallationFailure>;
  readonly runsFrom?: Installation | undefined;
  readonly downgrade?: DowngradeSteps['Service'];
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

const isFrom = Schema.is(buildFromSchema);

const previousOf = (installations: string | undefined): string | null =>
  installations === undefined ? null : previousRelease(installations);

const busyWith = (busy: BuildRunning) => `a build from ${busy.from} ${busy.revision} is running`;

const occupiedBy = (busy: BuildRunning): InstallRefused => occupied(busyWith(busy), busy.since);

const restartingOn = (busy: BuildRunning): InstallRefused & StopRefused =>
  restarting(`the build from ${busy.from} ${busy.revision}`, [
    'tagma status — where the server stands once the successor answers',
    'tagma update --back — step back onto the version kept beside it',
  ]);

type Decision = readonly [BuildEnded['outcome'], string | null, string];

type Answer<A> = { readonly answered: true; readonly value: A } | { readonly answered: false; readonly reason: string };

export const makeCheckoutBuilds = Effect.fnUntraced(function* (options: CheckoutBuildsOptions) {
  const source = yield* makeCheckoutReading({ path: options.checkout, running: options.running ?? null });
  const steps = yield* BuildSteps;
  const files = yield* FileSystem.FileSystem;
  const scope = yield* Scope.Scope;
  const admission = yield* Semaphore.make(1);
  const shifts = yield* Effect.acquireRelease(PubSub.sliding<void>(1), PubSub.shutdown);
  const keptFile = options.record === undefined ? null : yield* makeKeptRecord(keptSchema, options.record, 'build record');
  const restart = options.restart ?? Effect.fail(new RestartRefused({ message: NO_RESTART }));
  let running: { readonly record: BuildRunning; readonly offset: number } | null = null;
  let ended: BuildEnded | null = null;
  let took: Took = { head: null, tree: null, back: null };
  let current: Fiber.Fiber<unknown, unknown> | null = null;
  let group: Held | null = null;
  let cut: string | null = null;
  let stopping = false;
  let offered: NextFrame | null = null;
  let offeredSource: CheckoutFrame | null = null;
  let offeredRecord: BuildRunning | null = null;
  let revision = 0;

  const stamp = Effect.map(Clock.currentTimeMillis, (ms) => new Date(ms).toISOString());

  const say = (line: string) => Effect.provideService(logLine(options.log, line), FileSystem.FileSystem, files);

  const onDisk = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, FileSystem.FileSystem>> =>
    Effect.provideService(effect, FileSystem.FileSystem, files);

  const shift = PubSub.publish(shifts, undefined);

  const runningRecord = Effect.fnUntraced(function* () {
    const building = running;
    if (building === null) return null;
    const tail = yield* onDisk(shownTail(options.log, building.offset, { lines: 1, bytes: TAIL_BYTES }));
    return { ...building.record, tail: tail[0] ?? null };
  });

  const nextOf = (frame: CheckoutFrame): NextFrame => {
    if (offeredSource !== null && frame.revision < offeredSource.revision) frame = offeredSource;
    const building = running?.record ?? null;
    if (offered !== null && offeredSource?.revision === frame.revision && offeredRecord === building) return offered;
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
      back: backOf(previousOf(options.installations), building === null ? null : 'an installation is running'),
      installing: building === null ? null : installingOf(building),
      installed: ended === null ? null : installedOf(ended),
      acts: actsOf(building),
    };
    offeredSource = frame;
    offeredRecord = building;
    return offered;
  };

  const reading = Effect.flatMap(source.read, (frame) =>
    Effect.map(runningRecord(), (record) => {
      const next = nextOf(frame);
      return record === null ? next : { ...next, installing: installingOf(record) };
    }),
  );

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

  const submoduleRepositories: (repository: string, env: NodeJS.ProcessEnv) => Effect.Effect<readonly string[], PlatformError> = Effect.fn(
    'CheckoutBuilds.submodules',
  )(function* (repository: string, env: NodeJS.ProcessEnv) {
    if (!(yield* files.exists(join(repository, '.gitmodules')))) return [];
    const listed = yield* answered('git', ['-C', repository, ...SUBMODULE_PATHS], { env });
    if (listed.status !== 0) {
      yield* Effect.logWarning(`the submodules of ${repository} could not be listed: ${listed.text.trim()}`);
      return [];
    }
    const direct = declaredSubmodules(listed.out).map((path) => join(repository, path));
    const nested = yield* Effect.forEach(direct, (one) => submoduleRepositories(one, env), { concurrency: 'unbounded' });
    return [...direct, ...nested.flat()];
  });

  const reap = Effect.fn('CheckoutBuilds.reap')(function* (held: Held | null, worktree: string | null) {
    if (held !== null && (yield* commandOf(held.pid)) === held.command) yield* endGroup(held.pid);
    const checkout = options.checkout;
    if (worktree === null || checkout === undefined) return;
    const env = { ...process.env, [OWN_GIT_VARIABLE]: '1' };
    const removed = yield* answered('git', ['-C', checkout, 'worktree', 'remove', '--force', '--force', worktree], { env });
    if (removed.status !== 0) yield* Effect.logDebug(`git did not remove the worktree ${worktree}: ${removed.text.trim()}`);
    yield* files.remove(worktree, { recursive: true, force: true });
    for (const repository of [checkout, ...(yield* submoduleRepositories(checkout, env))]) {
      const pruned = yield* answered('git', ['-C', repository, 'worktree', 'prune'], { env });
      if (pruned.status !== 0) yield* Effect.logWarning(`worktrees of ${repository} could not be pruned: ${pruned.text.trim()}`);
    }
  });

  const endedAs = (
    started: BuildRunning,
    outcome: BuildEnded['outcome'],
    build: string | null,
    detail: string,
    tail: readonly string[],
    endedAt: string,
    refused?: InstallRefusal,
  ): BuildEnded => ({
    from: started.from,
    revision: started.revision,
    outcome,
    build,
    detail,
    endedAt,
    log: started.log,
    since: started.since,
    tail,
    then: started.then,
    restartRefused: null,
    refused,
  });

  const stepped = Effect.fn('CheckoutBuilds.stepped')(function* (
    step: BuildStep,
    more: { readonly before?: BuildRunning['before']; readonly revision?: string } = {},
  ) {
    if (running === null) return;
    running = { ...running, record: { ...running.record, step, ...more } };
    yield* shift;
  });

  const keep = Effect.fn('CheckoutBuilds.keep')(function* (building: BuildRunning | null, last: BuildEnded | null) {
    yield* shift;
    if (keptFile === null) return;
    yield* keptFile
      .write({
        running: building === null ? null : { ...building, tail: null },
        ended: last,
        took,
        held: building === null ? null : group,
        worktree: building === null ? null : cut,
      })
      .pipe(
        Effect.matchEffect({
          onSuccess: () => Effect.void,
          onFailure: (failure) => Effect.logWarning(`the build record could not be kept: ${failure.message}`),
        }),
      );
  });

  const standing = (options.landed ?? Effect.succeed(null)).pipe(
    Effect.match({
      onSuccess: (build) => ({ build, unread: '' }),
      onFailure: (failure) => ({ build: null, unread: ` (the installation that stands could not be read: ${failure.message})` }),
    }),
  );

  const answer = <A, E extends { readonly message: string }>(work: Effect.Effect<A, E>, unanswered: string): Effect.Effect<Answer<A>> =>
    work.pipe(
      Effect.match({
        onSuccess: (value): Answer<A> => ({ answered: true, value }),
        onFailure: (failure): Answer<A> => ({ answered: false, reason: failure.message }),
      }),
      Effect.catchDefect((defect) =>
        Effect.as(Effect.logWarning(`${unanswered}: ${String(defect)}`), { answered: false, reason: unanswered } satisfies Answer<A>),
      ),
    );

  const stoppedEnded = Effect.fn('CheckoutBuilds.stopped')(function* (started: BuildRunning, note: string) {
    const at = running?.record.step ?? started.step;
    const endedAt = yield* stamp;
    const landed = yield* Effect.orDie(files.exists(note));
    const { build, unread } = landed ? yield* standing : { build: null, unread: '' };
    const [outcome, detail] = landed
      ? (['landed', `stopped after installation ${build ?? 'it built'} had become current; tagma restart brings it up${unread}`] as const)
      : (['stopped', `stopped at the ${at} step; nothing landed`] as const);
    const last = endedAs(
      { ...started, revision: running?.record.revision ?? started.revision },
      outcome,
      outcome === 'landed' ? build : null,
      detail,
      [],
      endedAt,
    );
    yield* say(`=== tagma build ${started.from} ${last.revision} ${outcome} ${endedAt}: ${detail} ===`);
    return last;
  });

  const run = Effect.fn('CheckoutBuilds.run')(function* (checkout: string, started: BuildRunning) {
    const sink = yield* onDisk(logSink(options.log));
    const runtime = options.runtime ?? process.execPath;
    const inherited = options.env ?? process.env;
    const refusedNote = join(dirname(options.log), `${REFUSED_NOTE}-${started.since.replace(/[^0-9A-Za-z]/g, '')}`);
    const env = { ...inherited, HOME: inherited[BUILD_HOME_ENV] ?? inherited.HOME, [BUILD_REFUSED_ENV]: refusedNote };
    const note = join(dirname(options.log), SWAPPED_NOTE);
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        if (cut !== null && (yield* files.exists(cut))) yield* reap(null, cut);
        cut = null;
        yield* files.remove(refusedNote, { force: true });
      }).pipe(Effect.orDie),
    );
    yield* say(
      `\n=== tagma build ${started.from} ${started.revision} started ${started.since} by pid ${process.pid}${started.then === null ? '' : `, then ${started.then}`} ===`,
    );
    if (running !== null) running = { ...running, offset: yield* onDisk(sizeOf(options.log)) };

    const step = Effect.fn('CheckoutBuilds.step')(function* (
      title: string,
      command: readonly string[],
      cwd: string,
      more: Record<string, string> = {},
    ) {
      yield* say(`\n--- ${title}: ${command.join(' ')} (in ${cwd}) ---`);
      const ran = yield* answered(command[0]!, command.slice(1), {
        cwd,
        env: { ...env, ...more },
        sink,
        group: {
          started: (pid) =>
            Effect.andThen(
              Effect.sync(() => {
                group = { pid, command: command.join(' ') };
              }),
              keep(running?.record ?? started, ended),
            ),
        },
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            group = null;
          }),
        ),
      );
      if (ran.status === null) return yield* new BuildNotRun({ message: ran.text.trim() });
      return ran.status;
    });

    let stepRefused: InstallRefusal | undefined;
    const refusedBy = (code: string, reason: string, thread?: InstallRefusal['thread']): Decision => {
      stepRefused = { code, reason, unblock: ['update again once that is settled'], thread };
      return ['failed', null, reason];
    };

    const ahead = Effect.fnUntraced(function* (offer: 'head' | 'tree') {
      const listed = yield* answer(steps.of(checkout), 'the steps before the build ended without an answer');
      if (!listed.answered) return refusedBy('build-step-failed', listed.reason);
      const titles = listed.value.map((one) => one.title);
      for (const [at, one] of listed.value.entries()) {
        yield* stepped('before', { before: { titles, at } });
        yield* say(`\n--- ${one.title}: ${one.app} before the build (in ${checkout}) ---`);
        for (;;) {
          const asked = yield* answer(one.ask({ offer, checkout }), `${one.app} ended its step without an answer`);
          if (!asked.answered) return refusedBy('build-step-failed', asked.reason);
          const verdict = asked.value;
          yield* say(`${one.title}: ${verdict.verdict}${verdict.verdict === 'stop' ? ` — ${verdict.reason}` : ''}`);
          if (verdict.verdict === 'go') break;
          if (verdict.verdict === 'stop')
            return refusedBy(
              'build-step-stopped',
              `${one.title} stopped the update: ${verdict.reason}`,
              verdict.thread === undefined ? undefined : { projectId: one.projectId, threadId: verdict.thread },
            );
          yield* Effect.sleep(PENDING_ASKED_AGAIN);
        }
      }
      if (titles.length > 0) {
        const frame = yield* source.fresh;
        const head = frame.checkout?.head ?? null;
        if (head !== null) {
          yield* stepped(running?.record.step ?? 'before', {
            revision: revisionLabel({ head, dirty: offer === 'tree' && (frame.checkout?.dirty ?? false) }),
          });
        }
      }
      return null;
    });

    const decided = Effect.fnUntraced(function* (): Effect.fn.Return<Decision, BuildNotRun | PlatformError> {
      if (started.from === 'back') return ['failed', null, 'a step back runs no build'];
      yield* files.remove(note, { force: true });
      const held = yield* ahead(started.from);
      if (held !== null) return held;
      cut = started.from === 'head' ? join(options.worktrees, `head-${started.since.replace(/[-:.]/g, '')}`) : null;
      yield* stepped('build');
      const origin = cut === null ? [] : ['--origin', checkout];
      const code = yield* step(
        'build',
        [runtime, 'run', 'tagma:build', '--no-restart', ...(started.from === 'tree' ? ['--tree'] : []), ...origin],
        checkout,
        {
          [BUILD_SWAPPED_ENV]: note,
          ...(cut === null ? {} : { [BUILD_WORKTREE_ENV]: cut }),
        },
      );
      if (code !== 0) return ['failed', null, `${BUILD_COMMAND} ended with code ${code}`];
      const { build, unread } = yield* standing;
      return [
        'landed',
        build,
        `${build === null ? 'the build landed' : `installation ${build} stands; tagma restart brings it up`}${unread}`,
      ];
    });

    const [outcome, build, detail] = yield* decided();
    const failed = outcome === 'failed';
    const tail = failed ? yield* onDisk(shownTail(options.log, running?.offset ?? 0, { lines: TAIL_LINES, bytes: TAIL_BYTES })) : [];
    const refusal = failed
      ? (stepRefused ??
        (yield* files.readFileString(refusedNote).pipe(
          Effect.map(refusalsIn),
          Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(undefined)),
        )))
      : undefined;
    const endedAt = yield* stamp;
    const last = endedAs(
      { ...started, revision: running?.record.revision ?? started.revision },
      outcome,
      build,
      detail,
      tail,
      endedAt,
      refusal,
    );
    yield* say(`=== tagma build ${started.from} ${last.revision} ${outcome} ${last.endedAt}: ${detail} ===`);
    return last;
  }, Effect.scoped);

  const steppingBack = Effect.fn('CheckoutBuilds.back')(function* (started: BuildRunning) {
    yield* say(`\n=== tagma build back ${started.revision} started ${started.since} by pid ${process.pid}, then restart ===`);
    const refused = (reason: string, code = 'back-failed') =>
      endedAs(started, 'failed', null, reason, [], '', { code, reason, unblock: ['tagma update --back — try again'] });
    const installations = options.installations;
    if (installations === undefined) return refused('this server keeps no installations to step back onto');
    const preflight =
      options.downgrade === undefined
        ? Effect.void
        : Effect.asVoid(downgradePreflight().pipe(Effect.provideService(DowngradeSteps, options.downgrade)));
    const stepped = yield* Effect.result(
      steppedBack(
        installations,
        null,
        options.runsFrom === undefined ? null : basename(options.runsFrom.root),
        preflight,
        options.downgrade?.reopen() ?? Effect.void,
      ),
    );
    const endedAt = yield* stamp;
    if (stepped._tag === 'Failure') {
      const failure = stepped.failure;
      const reason =
        failure._tag === 'GateRefusal'
          ? failure.message
          : failure._tag === 'MoveFailed'
            ? `${failure.step}: ${failure.detail}`
            : failure._tag === 'InstallHeld'
              ? `${failure.path} could not be held: ${failure.reason}`
              : failure._tag === 'PreviousMissing'
                ? 'no installation is kept beside the one that stands'
                : failure._tag === 'AttemptStanding'
                  ? `the update onto ${failure.attempt.to} stands open, so nothing steps back before it ends`
                  : failure.message;
      return { ...refused(reason), endedAt };
    }
    const build = stepped.success.build;
    const last = endedAs(
      started,
      'landed',
      build,
      options.runsFrom === undefined
        ? `${build === null ? 'the previous installation' : `installation ${build}`} comes up when the installation next starts: a server run from its checkout does not carry a step back`
        : `${build === null ? 'the previous installation' : `installation ${build}`} comes up after the restart`,
      [],
      endedAt,
    );
    yield* say(`=== tagma build back ${last.revision} landed ${endedAt}: ${last.detail} ===`);
    return last;
  });

  const settle = Effect.fn('CheckoutBuilds.settle')(function* (
    started: BuildRunning,
    exit: Exit.Exit<BuildEnded, { readonly message: string }>,
  ) {
    const note = join(dirname(options.log), SWAPPED_NOTE);
    const failure = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : null;
    const finished: BuildEnded = Exit.isSuccess(exit)
      ? exit.value
      : Cause.hasInterruptsOnly(exit.cause)
        ? yield* stoppedEnded(started, note)
        : endedAs(
            started,
            'failed',
            null,
            `the build could not be run: ${failure?._tag === 'Some' ? failure.value.message : Cause.pretty(exit.cause)}`,
            [],
            yield* stamp,
          );
    if (finished.outcome === 'landed' && finished.since !== null) {
      took = { ...took, [finished.from]: Date.parse(finished.endedAt) - Date.parse(finished.since) };
    }
    const landed =
      finished.outcome === 'landed' && finished.then === 'restart' && stopping
        ? { ...finished, restartRefused: 'the build was stopped after it landed, before the restart was asked' }
        : finished;
    if (landed.outcome !== 'landed' || landed.then !== 'restart' || landed.restartRefused !== null) {
      ended = landed;
      running = null;
      yield* keep(null, landed);
      return;
    }
    yield* stepped('restart');
    yield* keep(null, landed);
    const refused = yield* askedRestart(restart, say);
    ended = refused === null ? landed : { ...landed, restartRefused: refused };
    running = null;
    yield* shift;
    if (refused !== null) yield* keep(null, ended);
  });

  const halt = Effect.fn('CheckoutBuilds.halt')(function* (building: BuildRunning) {
    stopping = true;
    if (current !== null) yield* Fiber.interrupt(current);
    return ended !== null && ended.since === building.since ? ended : null;
  });

  const kept =
    keptFile === null
      ? null
      : yield* keptFile.read.pipe(
          Effect.matchEffect({
            onSuccess: Effect.succeed,
            onFailure: (failure) => Effect.as(Effect.logWarning(`the build record could not be read: ${failure.message}`), null),
          }),
        );
  const installations = options.installations;
  const backFailed = installations === undefined ? null : stepBackFailure(installations);
  const backEnded: BuildEnded | null =
    backFailed === null || installations === undefined
      ? null
      : {
          from: 'back',
          revision: releaseAt(installations, backFailed.to)?.identity.build ?? backFailed.to,
          outcome: 'failed',
          build: null,
          detail: backFailed.detail,
          endedAt: yield* stamp,
          log: options.log,
          since: null,
          tail: [],
          then: null,
          restartRefused: null,
        };
  if (kept === null && backEnded !== null) {
    ended = backEnded;
    yield* keep(null, ended);
  }
  if (kept !== null) {
    took = kept.took;
    if (kept.running === null) {
      ended = backEnded ?? kept.ended;
      if (backEnded !== null) yield* keep(null, ended);
    } else {
      ended = endedAs(kept.running, 'failed', null, 'the server that ran this build ended before the build did', [], yield* stamp);
      yield* keep(null, ended);
      yield* Effect.forkScoped(reap(kept.held, kept.worktree));
    }
  }

  return NextInstallation.of({
    reading,
    check: reading,
    changes,
    installing: Effect.map(runningRecord(), (record) => (record === null ? null : installingOf(record))),
    install: Effect.fn('NextInstallation.install')(
      function* (offer, then, replacing) {
        if (!isFrom(offer)) {
          return yield* Effect.fail<InstallRefused>({
            code: 'no-offer',
            reason: `${offer} is no next installation of a checkout; it offers head, tree and back`,
            unblock: ['tagma status — the next installations offered here'],
          });
        }
        const back = offer === 'back';
        const checkout = back
          ? null
          : yield* Effect.flatMap(source.read, (frame) =>
              frame.issue === null ? Effect.succeed(frame.checkout) : Effect.fail<InstallRefused>(frame.issue),
            );
        if (back && previousOf(options.installations) === null) {
          return yield* Effect.fail<InstallRefused>({
            code: 'no-offer',
            reason: 'no earlier installation is kept to go back to',
            unblock: ['tagma status — the next installations offered here'],
          });
        }
        if (!back && checkout === null) {
          return yield* Effect.fail<InstallRefused>({
            code: 'no-offer',
            reason:
              options.checkout === undefined
                ? 'this Tagma was installed, not cut from a checkout on this machine; there is nothing to build from'
                : `${options.checkout}, the checkout this Tagma was cut from, does not stand here as a Tagma checkout`,
            unblock: [`${BUILD_COMMAND} — at a Tagma checkout root, builds that checkout and makes it the installation that stands`],
          });
        }
        if (offer === 'head' && checkout?.head === null) {
          return yield* Effect.fail<InstallRefused>({
            code: 'offer-unavailable',
            reason: `${checkout?.path ?? 'this checkout'} is not a git checkout, so it has no HEAD to cut cleanly`,
            unblock: ['tagma build --tree — build the tree as it stands'],
          });
        }
        const standingBuild = running?.record ?? null;
        if (standingBuild !== null && standingBuild.step === 'restart') return yield* Effect.fail(restartingOn(standingBuild));
        if (standingBuild !== null && standingBuild.since !== replacing) return yield* Effect.fail(occupiedBy(standingBuild));
        const replaced = standingBuild === null ? null : yield* halt(standingBuild);
        if (running !== null) return yield* Effect.fail(occupiedBy(running.record));
        const started: BuildRunning = {
          from: offer,
          revision:
            offer === 'back'
              ? (previousOf(options.installations) ?? 'previous')
              : revisionLabel(checkout?.head == null ? null : { head: checkout.head, dirty: offer === 'tree' && checkout.dirty }),
          since: yield* stamp,
          log: options.log,
          then: offer === 'back' ? 'restart' : then,
          step: offer === 'head' ? 'worktree' : offer === 'back' ? 'back' : 'build',
          tail: null,
          usually: took[offer],
        };
        running = { record: started, offset: Number.POSITIVE_INFINITY };
        stopping = false;
        yield* keep(started, ended);
        current = yield* Effect.forkIn(
          Effect.onExit(checkout === null ? steppingBack(started) : run(checkout.path, started), (exit) => settle(started, exit)).pipe(
            Effect.interruptible,
          ),
          scope,
        );
        return { installing: installingOf(started), replaced: replaced === null ? null : installedOf(replaced) };
      },
      Effect.uninterruptible,
      admission.withPermit,
    ),
    stop: Effect.fn('NextInstallation.stop')(
      function* () {
        const standingBuild = running;
        if (standingBuild === null) {
          return yield* Effect.fail<StopRefused>({
            code: 'nothing-installing',
            reason: 'no build is running, so there is nothing to stop',
            unblock: ['tagma status — where the server stands'],
          });
        }
        if (standingBuild.record.step === 'restart') return yield* Effect.fail(restartingOn(standingBuild.record));
        const last = yield* halt(standingBuild.record);
        if (last === null) {
          return yield* Effect.fail<StopRefused>({
            code: 'nothing-installing',
            reason: 'the build ended and left no record of how',
            unblock: [`${standingBuild.record.log} — what it printed`],
          });
        }
        return installedOf(last);
      },
      Effect.uninterruptible,
      admission.withPermit,
    ),
  });
});

export const checkoutBuildsLayer = (options: CheckoutBuildsOptions) =>
  Layer.effect(NextInstallation, makeCheckoutBuilds(options)).pipe(
    Layer.provide(ownGitLayer(gitLayer.pipe(Layer.provide(HOST)))),
    Layer.provide(BunFileSystem.layer),
  );

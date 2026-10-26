import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Effect, Layer, Result, Schema } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { gitLayer } from '@runlith/git/Git';
import { OWN_GIT_VARIABLE } from '../../platform/contract/service/credentials.js';
import { refusalLines } from '@runlith/agent/tool/refusal';
import type { Channel } from '../contract/wire/channel.js';
import { type FeedRelease, releaseAfter } from '../contract/wire/feed.js';
import { dataDirectory, hostBundle } from '../contract/wire/layout.js';
import { DESKTOP } from '../contract/wire/manifest.js';
import { releaseIdentity } from '../setup/signing.js';
import { checkoutOf, cutCache, flagsOf, irreversibleOf, packRelease, RELEASE_DIRECTORY, type Steps, storesOf } from './pipeline.js';
import { releaseRuntime } from './runtime.js';
import { machineTarget } from './target.js';
import { decodeRecord, digestOf, feedEntry, RELEASE_RECORD } from './stage.js';
import { type Composition, ReleaseRefused, releaseStaged } from './release.js';
import { transitionTrouble, trialStart } from './trial.js';
import {
  carried,
  closed,
  held,
  installedFrom,
  observed,
  observedAfresh,
  observedSettled,
  openWorld,
  ran,
  said,
  serving,
  type Terminals,
  unpacked,
  updated,
  type World,
} from './world.js';

const USAGE = 'bun run tagma:transition [--head] [--from <archive of the release before>] [--version <x.y.z>] [--commit <its commit>]';

type Plan = {
  readonly channel: Channel;
  readonly from: string;
  readonly before: string;
  readonly commit: string;
  readonly archive: string;
  readonly offer: FeedRelease;
  readonly desktop: string;
  readonly frozen: string;
  readonly out: string;
};

type Proved = { readonly title: string; readonly lines: readonly string[]; readonly trouble: string | null };

const decodeLine = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));

const lastLine = (text: string): unknown => {
  const read = decodeLine(text.trim().split('\n').at(-1) ?? '');
  return Result.isSuccess(read) ? read.success : { unread: read.failure.message };
};

const reopenOf = (answer: unknown): string | null =>
  typeof answer === 'object' && answer !== null && 'reopen' in answer && typeof answer.reopen === 'string' ? answer.reopen : null;

const openedOf = (answer: unknown): boolean =>
  typeof answer === 'object' && answer !== null && 'opened' in answer && answer.opened === true;

const windowAct = async (
  plan: Plan,
  world: World,
  args: readonly string[],
): Promise<{ readonly said: string; readonly answer: unknown }> => {
  const done = await ran(
    world,
    [process.execPath, '--conditions=release', join(plan.desktop, 'scripts', 'transition.ts'), ...args],
    plan.desktop,
  );
  return { said: `${args[0]}: exited ${done.code} ${done.out.trim() || said(done)}`, answer: done.code === 0 ? lastLine(done.out) : null };
};

const frozenAct = (plan: Plan, world: World, verb: 'frozen-launch' | 'frozen-follow', app: string) =>
  windowAct(plan, world, [verb, '--commit', plan.commit, '--frozen', plan.frozen, '--app', app, '--url', world.url]);

const opened = (plan: Plan, world: World, app: string) => windowAct(plan, world, ['open', '--app', app, '--url', world.url]);

type Stood = { readonly old: string; readonly terminals: Terminals };

const standing = async (plan: Plan, world: World, lines: string[]): Promise<Result.Result<Stood, string>> => {
  const old = await unpacked(world, plan.from, join(world.dir, 'Applications'));
  if (Result.isFailure(old)) return Result.fail(old.failure);
  const launched = await frozenAct(plan, world, 'frozen-launch', old.success);
  lines.push(`the ${plan.before} window opens from ${relative(world.dir, old.success)} and records its place — ${launched.said}`);
  const installed = await installedFrom(world, old.success);
  lines.push(`${plan.before} install-from: exited ${installed.code}`);
  if (installed.code !== 0) return Result.fail(`${plan.before} did not install: ${said(installed)}`);
  const answered = await serving(world);
  if (answered !== null) return Result.fail(answered);
  const terminals = await held(world);
  if (Result.isFailure(terminals)) return Result.fail(terminals.failure);
  lines.push(`${plan.before} serves at ${world.url} with held terminals: ${JSON.stringify(await observed(world, terminals.success))}`);
  return Result.succeed({ old: old.success, terminals: terminals.success });
};

const inWorld = (plan: Plan, lines: string[], work: (world: World, stood: Stood) => Promise<string | null>): Promise<string | null> =>
  openWorld(plan.channel, plan.out).then(async (opening) => {
    if (Result.isFailure(opening)) return opening.failure;
    const world = opening.success;
    try {
      const stood = await standing(plan, world, lines);
      return Result.isFailure(stood) ? stood.failure : await work(world, stood.success);
    } finally {
      lines.push(...(await closed(world)).split('\n').slice(0, 2));
    }
  });

const LAUNCHES = 2;

const inside = (world: World, path: string): string => relative(world.dir, path);

const settledIn = async (plan: Plan, world: World, app: string, lines: string[]): Promise<string | null> => {
  const met = await opened(plan, world, app);
  lines.push(`the window of ${carried(app) ?? 'an unknown release'} opens from ${inside(world, app)} — ${met.said}`);
  return openedOf(met.answer) ? null : `the window from ${inside(world, app)} did not open its surface`;
};

const converged = async (plan: Plan, world: World, { old, terminals }: Stood, lines: string[]): Promise<string | null> => {
  for (let launch = 1; launch <= LAUNCHES; launch += 1) {
    const followed = await frozenAct(plan, world, 'frozen-follow', old);
    const successor = reopenOf(followed.answer);
    lines.push(
      `the ${plan.before} window meets ${plan.offer.release} and reopens in ${successor === null ? 'nothing' : inside(world, successor)}`,
    );
    if (successor === null) return `the ${plan.before} window stays on ${plan.before}: ${followed.said}`;
    lines.push(`  ${JSON.stringify(await observed(world, terminals))}`);
    const settled = await settledIn(plan, world, successor, lines);
    if (settled !== null) return settled;
    if (carried(old) === plan.offer.release) {
      const seen = await observedAfresh(world, terminals);
      lines.push(`converged, with a helper started afresh: ${JSON.stringify(seen)}`);
      return transitionTrouble(seen, plan.offer.release, true);
    }
    lines.push(`${inside(world, old)} still carries ${carried(old)}; the person opens it again`);
    const launched = await frozenAct(plan, world, 'frozen-launch', old);
    lines.push(`the ${plan.before} window opens — ${launched.said}`);
  }
  return `${inside(world, old)} still carries ${carried(old)} after ${LAUNCHES} launches of its window`;
};

const proved = (title: string, work: (lines: string[]) => Promise<string | null>): Effect.Effect<Proved> =>
  Effect.promise(async () => {
    const lines: string[] = [];
    const trouble = await work(lines).catch((cause: unknown) => (cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)));
    return { title, lines, trouble };
  });

const button = (plan: Plan) =>
  proved(`${plan.before} updates to ${plan.offer.release} by its own button while its window is open`, (lines) =>
    inWorld(plan, lines, async (world, stood) => {
      const update = await updated(world, plan.offer);
      if (update !== null) return update;
      lines.push(`the button: ${JSON.stringify(await observed(world, stood.terminals))}`);
      return converged(plan, world, stood, lines);
    }),
  );

const newApp = (plan: Plan) =>
  proved(
    `the ${plan.offer.release} application opens beside the server of ${plan.before}, then the ${plan.before} application opens again`,
    (lines) =>
      inWorld(plan, lines, async (world, stood) => {
        const fresh = await unpacked(world, plan.archive, join(world.dir, 'Downloads'));
        if (Result.isFailure(fresh)) return fresh.failure;
        const first = await settledIn(plan, world, fresh.success, lines);
        if (first !== null) return first;
        const seen = await observedSettled(world, stood.terminals);
        lines.push(`  ${JSON.stringify(seen)}`);
        const transition = transitionTrouble(seen, plan.offer.release, true);
        if (transition !== null) return transition;
        lines.push(`Move to Applications: Not Now; later the person opens ${inside(world, stood.old)} again`);
        const launched = await frozenAct(plan, world, 'frozen-launch', stood.old);
        lines.push(`the ${plan.before} window opens — ${launched.said}`);
        return converged(plan, world, stood, lines);
      }),
  );

const recordIn = (dir: string) =>
  Effect.promise(async () => {
    const at = join(dir, RELEASE_RECORD);
    return existsSync(at) ? decodeRecord(await readFile(at, 'utf8')) : null;
  });

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const machine = Layer.mergeAll(gitLayer.pipe(Layer.provide(spawning)), spawning, BunFileSystem.layer);

const step = (argv: readonly string[], cwd: string, env: Record<string, string> = {}): Promise<number> =>
  Bun.spawn([...argv], { cwd, env: { ...process.env, ...env }, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' }).exited;

const atHead = (checkout: string, given: readonly string[]): Effect.Effect<number> =>
  Effect.promise(async () => {
    const tree = join(await mkdtemp(join(tmpdir(), 'tagma-transition-head-')), 'tree');
    const git = { [OWN_GIT_VARIABLE]: '1' };
    try {
      const added = await step(
        ['/usr/bin/git', '-C', checkout, 'worktree', 'add', '--detach', '--end-of-options', tree, 'HEAD'],
        checkout,
        git,
      );
      if (added !== 0) return added;
      const installed = await step([process.execPath, 'install', '--frozen-lockfile'], tree);
      if (installed !== 0) return installed;
      return await step([process.execPath, 'run', 'tagma:transition', ...given], tree);
    } finally {
      await step(['/usr/bin/git', '-C', checkout, 'worktree', 'remove', '--force', '--force', tree], checkout, git);
      await rm(dirname(tree), { recursive: true, force: true });
      await step(['/usr/bin/git', '-C', checkout, 'worktree', 'prune'], checkout, git);
    }
  });

export const transitionCommand = Effect.fnUntraced(function* (
  sourcePath: string,
  given: readonly string[],
  composition: Composition,
  steps: Steps,
  developer: Channel,
) {
  const told = (code: string, reason: string, unblock: readonly string[] = [USAGE]): never => {
    console.error(refusalLines({ code, reason, unblock: [...unblock] }).join('\n'));
    process.exit(2);
  };
  if (given.includes('--head')) {
    return process.exit(
      yield* atHead(
        checkoutOf(sourcePath),
        given.filter((one) => one !== '--head'),
      ),
    );
  }
  const flags = flagsOf(given, told);
  if (flags.rest.length > 0) told('usage', `${flags.rest.join(' ')} is not understood`);
  const data = dataDirectory(developer, process.env) ?? told('no-home', 'HOME names no home directory');
  const release = join(data, RELEASE_DIRECTORY);
  const cut = existsSync(release) ? yield* Effect.promise(() => realpath(release)) : release;
  const named = flags.value('--from');
  const standingCut = named === undefined ? yield* recordIn(cut) : null;
  const from = resolve(
    named ??
      (standingCut?._tag === 'Success' ? join(cut, standingCut.success.archive) : told('no-from', `${cut} holds no cut to update from`)),
  );
  const before = yield* recordIn(dirname(from));
  if (before?._tag !== 'Success') {
    return told(
      'no-record',
      `${join(dirname(from), RELEASE_RECORD)} does not read, and it names the release, commit and stores of ${from}`,
    );
  }
  const number = flags.value('--version') ?? releaseAfter(before.success.release);
  const out = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'tagma-transition-')));
  const staged = yield* Effect.gen(function* () {
    const stores = yield* storesOf(sourcePath, steps);
    const irreversible = irreversibleOf(number, stores, { stores: before.success.stores, changes: before.success.irreversible });
    const signer = yield* releaseIdentity.pipe(
      Effect.mapError((failure) => new ReleaseRefused({ step: 'signing', detail: failure.detail, log: '', unblock: failure.unblock })),
    );
    const target = machineTarget();
    if (target === null) {
      return yield* new ReleaseRefused({
        step: 'target',
        detail: `this ${process.platform}-${process.arch} machine cuts no release`,
        log: '',
        unblock: [],
      });
    }
    const cache = cutCache(data);
    const runtime = yield* releaseRuntime(checkoutOf(sourcePath), Bun.version, target, cache.runtimes).pipe(
      Effect.mapError((trouble) => new ReleaseRefused({ step: 'runtime', detail: trouble.detail, log: '', unblock: trouble.unblock })),
    );
    const landed = yield* releaseStaged(sourcePath, join(out, 'stage'), composition, {
      number,
      signer,
      maps: join(out, 'maps'),
      inputs: join(out, 'inputs'),
      irreversible,
      target,
      runtime,
      packages: cache.packages,
    });
    const archive = join(out, `tagma-${number}-${landed.manifest.platform.os}-${landed.manifest.platform.arch}.tar.gz`);
    yield* packRelease(join(landed.root, DESKTOP), archive, hostBundle(composition.channel.name)).pipe(
      Effect.mapError((detail) => new ReleaseRefused({ step: 'pack', detail, log: landed.log, unblock: [] })),
    );
    yield* Effect.promise(() => rm(join(out, 'stage'), { recursive: true, force: true }));
    const sha256 = yield* Effect.promise(() => digestOf(archive));
    const size = (yield* Effect.promise(() => stat(archive))).size;
    const offer = feedEntry(
      {
        release: number,
        commit: 'tree',
        archive,
        images: {},
        sha256,
        size,
        platforms: { [`${landed.manifest.platform.os}-${landed.manifest.platform.arch}`]: { archive, sha256, size } },
        stores,
        irreversible,
        notarized: false,
      },
      (name) => pathToFileURL(name).href,
    );
    return { archive, offer };
  }).pipe(Effect.provide(machine), Effect.result);
  if (staged._tag === 'Failure') {
    yield* Effect.promise(() => rm(out, { recursive: true, force: true }));
    return told('release-refused', `${staged.failure.step}: ${staged.failure.detail}`, staged.failure.unblock);
  }
  const plan: Plan = {
    channel: composition.channel,
    from,
    before: before.success.release,
    commit: flags.value('--commit') ?? before.success.commit,
    archive: staged.success.archive,
    offer: staged.success.offer,
    desktop: resolve(sourcePath, '..', 'desktop'),
    frozen: join(out, 'frozen'),
    out,
  };
  console.log(`${composition.channel.name} ${number} of this tree, over ${plan.before} from ${from} (its window from ${plan.commit})`);
  const trialLines: string[] = [];
  const trial = yield* trialStart({
    channel: plan.channel,
    archive: plan.archive,
    offer: plan.offer,
    predecessor: from,
    labels: [],
    scratch: out,
    log: (line) => trialLines.push(line.split('\n')[0]!),
  });
  const runs: Proved[] = [
    { title: `the release trial: ${plan.before} updates to ${number} by its own button`, lines: trialLines, trouble: trial },
    yield* button(plan),
    yield* newApp(plan),
  ];
  yield* Effect.promise(() => rm(out, { recursive: true, force: true }));
  for (const run of runs) {
    console.log(`\n${run.trouble === null ? 'proved' : 'REFUSED'} — ${run.title}`);
    for (const line of run.lines) console.log(`  ${line}`);
    if (run.trouble !== null) console.log(`  trouble: ${run.trouble}`);
  }
  if (runs.some((run) => run.trouble !== null)) process.exit(1);
});

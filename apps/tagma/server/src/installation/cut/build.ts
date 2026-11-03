import { appendFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Effect, Layer, Schema } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { gitLayer } from '@runlith/git/Git';
import { installationRoot, launcherPath } from '../paths.js';
import type { Channel } from '../contract/wire/channel.js';
import { BUILD_COMMAND, BUILD_REFUSED_ENV, BUILD_SOURCE_ENV, BUILD_SWAPPED_ENV, CURRENT } from '../contract/wire/layout.js';
import { refusalLines } from '@runlith/agent/tool/refusal';
import type { RefusalBody } from '../../platform/contract/wire/refusal.js';
import { CurrentInvocation, failureLines, refusalOf } from '../../platform/cli/verb.js';
import { downgradeReadySchema } from '../contract/wire/downgrade.js';
import { downgradeLines } from '../voice/downgrade.js';
import { cameUp, serverLines } from './came.js';
import { readInstallation, refusalDetail, verifyInstallation } from '../closure/read.js';
import type { LauncherWritten } from '../setup/launcher.js';
import type { BuildServer } from './port.js';
import type { Composition } from './descriptor.js';
import { releaseInstallation } from './release.js';
import { steppedBack } from '../closure/moves.js';
import { buildHead, type BuildAttribution } from './source.js';
import type { Processes } from '@runlith/execution-host/ProcessReader';

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));

const refuse = (json: boolean, code: string, reason: string, unblock: string[]): never => {
  const note = process.env[BUILD_REFUSED_ENV];
  if (note !== undefined && note !== '') {
    try {
      appendFileSync(note, `${JSON.stringify({ code, reason, unblock })}\n`);
    } catch {}
  }
  if (json) console.log(JSON.stringify({ code, reason, unblock }));
  else console.error(refusalLines({ code, reason, unblock }).join('\n'));
  process.exit(2);
};

const print = (json: boolean, value: Record<string, unknown>, lines: string[]): void => {
  if (json) console.log(JSON.stringify(value, null, 2));
  else for (const line of lines) console.log(line);
};

const verify = Effect.fnUntraced(function* (channel: Channel, json: boolean) {
  const standing = join(installationRoot(channel), CURRENT);
  const read = yield* Effect.result(verifyInstallation(standing).pipe(Effect.provide(BunFileSystem.layer)));
  if (read._tag === 'Failure') {
    return refuse(json, 'installation-refused', refusalDetail(read.failure), [
      `${BUILD_COMMAND} — build this checkout into an installation and make it the one that stands`,
      `${BUILD_COMMAND} --back — swap onto the version kept beside this one`,
    ]);
  }
  const manifest = read.success;
  print(
    json,
    {
      build: manifest.identity.build,
      digest: manifest.identity.digest,
      platform: manifest.platform,
      parts: manifest.parts.length,
      root: standing,
    },
    [`${manifest.identity.build} — ${manifest.parts.length} parts proved in ${standing}`, manifest.identity.digest],
  );
});

type Prepared = { readonly _tag: 'Ready'; readonly lines: readonly string[] } | { readonly _tag: 'Refused'; readonly refusal: RefusalBody };

const decodeReady = Schema.decodeUnknownResult(downgradeReadySchema);

const preparedDowngrade = Effect.fnUntraced(function* (api: BuildServer): Effect.fn.Return<Prepared> {
  const at = yield* CurrentInvocation;
  const url = api.baseUrl(at);
  if ((yield* api.healthOrNone()) === null) {
    return { _tag: 'Ready', lines: [`downgrade preflight: unasked — no server answers at ${url}`] } as const;
  }
  const asked = yield* Effect.result(
    api.ask((door) => door.operations.perform({ params: { id: 'prepare_downgrade' }, query: { cwd: at.cwd }, headers: {}, payload: {} })),
  );
  const unanswered = (detail: string): Prepared => ({
    _tag: 'Refused',
    refusal: {
      code: 'preflight-unanswered',
      reason: `${url} did not answer the downgrade preflight (${detail}), so nothing proves its commit queue drained`,
      unblock: [`${BUILD_COMMAND} --back — ask again once the server answers`],
    },
  });
  if (asked._tag === 'Failure') {
    yield* Effect.logDebug('the downgrade preflight was not answered', asked.failure);
    const refusal = refusalOf(asked.failure);
    if (refusal === null) return unanswered(failureLines(asked.failure).join('; '));
    if (refusal.code === 'unknown-operation') {
      return { _tag: 'Ready', lines: [`downgrade preflight: unasked — the server at ${url} declares none`] } as const;
    }
    return { _tag: 'Refused', refusal } as const;
  }
  const ready = decodeReady(asked.success);
  if (ready._tag === 'Failure') {
    yield* Effect.logWarning('the downgrade preflight answer could not be read', ready.failure);
    return unanswered('its answer could not be read');
  }
  return { _tag: 'Ready', lines: downgradeLines(ready.success) } as const;
});

const back = Effect.fnUntraced(function* (api: BuildServer, channel: Channel, json: boolean, restart: boolean) {
  const downgrade: string[] = [];
  const prepared = Effect.flatMap(preparedDowngrade(api), (answer) =>
    Effect.sync(() => {
      if (answer._tag === 'Refused') refuse(json, answer.refusal.code, answer.refusal.reason, [...answer.refusal.unblock]);
      else downgrade.push(...answer.lines);
    }),
  );
  const root = installationRoot(channel);
  const stepped = yield* Effect.result(steppedBack(root, null, prepared, Effect.void));
  if (stepped._tag === 'Failure') {
    const failure = stepped.failure;
    switch (failure._tag) {
      case 'PreviousMissing':
        return refuse(
          json,
          'no-previous',
          failure.standing === null
            ? `nothing is installed at ${failure.root}`
            : `${failure.standing} is the oldest closure kept at ${failure.root}, and there is none below it`,
          [`${BUILD_COMMAND} — build this checkout into an installation and make it the one that stands`],
        );
      case 'AttemptStanding':
        return refuse(json, 'attempt-open', `the update onto ${failure.attempt.to} stands open, so nothing steps back before it ends`, [
          'start the server of current: it finishes the update or rolls it back',
        ]);
      case 'MoveFailed':
        return refuse(json, 'back-failed', `${failure.step}: ${failure.detail}`, [`${BUILD_COMMAND} --back — try again`]);
      case 'InstallHeld':
        return refuse(json, 'back-failed', `${failure.path} could not be held: ${failure.reason}`, [`${BUILD_COMMAND} --back — try again`]);
    }
  }
  const named = yield* Effect.result(readInstallation(stepped.success.root)).pipe(Effect.provide(BunFileSystem.layer));
  const build = named._tag === 'Success' ? named.success.identity.build : null;
  const server = restart ? yield* cameUp(api, channel, build) : { _tag: 'Skipped' as const };
  print(json, { ...stepped.success, build, server, downgrade }, [
    `${build ?? `${stepped.success.version} — its manifest could not be read${named._tag === 'Failure' ? ` (${refusalDetail(named.failure)})` : ''}`} stands in ${stepped.success.root}`,
    `stepped back from ${stepped.success.from}`,
    ...downgrade,
    ...serverLines(channel, server),
  ]);
});

const landRelease = Effect.fnUntraced(function* (
  json: boolean,
  origin: { readonly checkout: string } | null | undefined,
  composition: Composition,
) {
  const note = process.env[BUILD_SWAPPED_ENV];
  const swapped = (version: string): void => {
    if (note === undefined || note === '') return;
    try {
      writeFileSync(note, version);
    } catch {}
  };
  const read = yield* Effect.result(
    releaseInstallation(
      installationRoot(composition.channel),
      launcherPath(composition.channel),
      process.env,
      composition,
      origin,
      swapped,
    ).pipe(Effect.provide(Layer.mergeAll(gitLayer.pipe(Layer.provide(spawning)), spawning, BunFileSystem.layer))),
  );
  if (read._tag === 'Failure') {
    return refuse(json, 'release-failed', `${read.failure.step}: ${read.failure.detail}`, [
      ...read.failure.unblock,
      ...(read.failure.log === '' ? [] : [`${read.failure.log} — the whole output of every step of this release`]),
    ]);
  }
  return read.success;
});

const released = Effect.fnUntraced(function* (
  api: BuildServer,
  json: boolean,
  origin: { readonly checkout: string } | null | undefined,
  restart: boolean,
  composition: Composition,
) {
  const landed = yield* landRelease(json, origin, composition);
  const lines = [
    `${landed.manifest.identity.build} — ${landed.manifest.parts.length} parts in ${landed.root}`,
    `launcher ${landed.launcher.path}`,
    landed.previous === null ? 'the first installation here' : `${landed.previous} kept beside it`,
  ];
  lines.push(...reachLines(landed.launcher));
  const server = restart ? yield* cameUp(api, composition.channel, landed.manifest.identity.build) : { _tag: 'Skipped' as const };
  print(
    json,
    {
      build: landed.manifest.identity.build,
      digest: landed.manifest.identity.digest,
      version: landed.version,
      previous: landed.previous,
      root: landed.root,
      parts: landed.manifest.parts.length,
      launcher: landed.launcher.path,
      log: landed.log,
      server,
    },
    [...lines, ...serverLines(composition.channel, server)],
  );
});

const reachLines = (launcher: LauncherWritten): string[] => {
  const bin = dirname(launcher.path);
  switch (launcher.reach._tag) {
    case 'Beside':
    case 'Reached':
      return [];
    case 'Profiled':
      return [
        ...(launcher.reach.shadow === null
          ? []
          : [`another ${basename(launcher.path)} stood first on your PATH: ${launcher.reach.shadow}`]),
        `${bin} now comes first in ${launcher.reach.profile}; open a new terminal to type \`${basename(launcher.path)}\``,
      ];
    case 'Unprofiled':
      return [
        ...(launcher.reach.shadow === null
          ? []
          : [`another ${basename(launcher.path)} stands first on your PATH: ${launcher.reach.shadow}`]),
        `${launcher.reach.profile} could not be written (${launcher.reach.detail}); put ${bin} first on your PATH yourself`,
      ];
  }
};

type BuildRecipe = {
  readonly channel: Channel;
  readonly checkout: string;
  readonly composition: Effect.Effect<Composition>;
};

export const build = (
  api: BuildServer,
  given: readonly string[],
  recipe: BuildRecipe,
  attribution: BuildAttribution | undefined = undefined,
): Effect.Effect<void, never, Processes> => {
  const originAt = given.indexOf('--origin');
  const originCheckout = originAt < 0 ? undefined : given[originAt + 1];
  if (originAt >= 0 && (originCheckout === undefined || originCheckout.startsWith('--'))) {
    refuse(false, 'no-origin', '--origin names the checkout this closure answers to, and none was given', [
      `${BUILD_COMMAND} --origin <checkout>`,
    ]);
  }
  const args = new Set(originAt < 0 ? given : given.filter((_, index) => index !== originAt && index !== originAt + 1));
  const json = args.delete('--json');
  const wantsVerify = args.delete('--verify');
  const wantsBack = args.delete('--back');
  const restart = !args.delete('--no-restart');
  const portable = args.delete('--portable');
  const tree = args.delete('--tree');
  if (args.size > 0) {
    refuse(json, 'unknown-flag', `${[...args].join(' ')} is not a flag of this build`, [
      `${BUILD_COMMAND} [--verify | --back] [--tree] [--no-restart] [--portable | --origin <checkout>] [--json]`,
    ]);
  }
  if (portable && originCheckout !== undefined) {
    refuse(json, 'two-origins', 'a portable closure answers to no checkout, and --origin names one', [
      `${BUILD_COMMAND} --portable — a closure that answers to no checkout, to carry to another machine`,
      `${BUILD_COMMAND} --origin <checkout> — a closure answering to that checkout`,
    ]);
  }
  const origin = portable ? null : originCheckout === undefined ? undefined : { checkout: originCheckout };
  if (wantsVerify && wantsBack) {
    refuse(json, 'two-acts', 'proving and stepping back are two acts, and this build runs one', [
      `${BUILD_COMMAND} --verify — prove the installation that stands`,
      `${BUILD_COMMAND} --back — swap current onto the version kept beside it`,
    ]);
  }
  if (wantsVerify) return verify(recipe.channel, json);
  if (wantsBack) return back(api, recipe.channel, json, restart);
  return Effect.flatMap(CurrentInvocation, (at) => {
    if (tree || at.env[BUILD_SOURCE_ENV] === recipe.checkout)
      return Effect.flatMap(recipe.composition, (composition) => released(api, json, origin, restart, composition));
    return buildHead(recipe.checkout, given, attribution).pipe(
      Effect.provide(Layer.mergeAll(gitLayer.pipe(Layer.provide(spawning)), spawning, BunFileSystem.layer)),
      Effect.catchTag('SourceRefused', (failure) =>
        Effect.sync(() => refuse(json, 'source-refused', failure.message, [...failure.unblock])),
      ),
    );
  });
};

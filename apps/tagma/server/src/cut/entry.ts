import { join, resolve } from 'node:path';
import { Effect, Layer } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { refusalLines } from '@runlith/agent/tool/refusal';
import { gitLayer } from '@runlith/git/Git';
import { CurrentInvocation } from '../platform/cli/verb.js';
import { BUILD_SOURCE_ENV, dataDirectory } from '../installation/contract/wire/layout.js';
import type { Distribution } from './descriptor.js';
import { RELEASE_DIRECTORY } from './pipeline.js';
import { needsReleaseSource } from './publish.js';
import { SourceRefused } from './snapshot.js';
import { buildSource } from './source.js';

const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const machine = Layer.mergeAll(gitLayer.pipe(Layer.provide(spawning)), spawning, BunFileSystem.layer);

const captured = Effect.fnUntraced(function* (given: readonly string[], distribution: Distribution) {
  const at = yield* CurrentInvocation;
  if (given[0] === 'publish') {
    const data = dataDirectory(distribution.workshop, at.env);
    if (data === null)
      return yield* new SourceRefused({
        message: 'HOME names no home directory for the release cut',
        unblock: ['set HOME, then release again'],
      });
    const named = given.indexOf('--out');
    const out = named < 0 ? join(data, RELEASE_DIRECTORY) : resolve(at.cwd, given[named + 1] ?? '');
    if (!(yield* needsReleaseSource(distribution.roots.checkout, out))) return false;
  }
  yield* buildSource({ checkout: distribution.roots.checkout, command: 'tagma:release', kind: 'head', given, clean: true });
  return true;
}, Effect.provide(machine));

export const releaseSource = Effect.fnUntraced(function* <R>(
  given: readonly string[],
  distribution: Distribution,
  work: Effect.Effect<void, never, R>,
) {
  const at = yield* CurrentInvocation;
  if (at.env[BUILD_SOURCE_ENV] === distribution.roots.checkout || given[0] === 'notarize') return yield* work;
  const json = given.includes('--json');
  const ran = yield* Effect.result(captured(given, distribution));
  if (ran._tag === 'Success') return ran.success ? undefined : yield* work;
  const failure = ran.failure;
  if (failure._tag === 'SourceRefused' && failure.exited !== undefined) return process.exit(failure.exited);
  const refusal =
    failure._tag === 'SourceRefused'
      ? { code: 'source-refused', reason: failure.message, unblock: [...failure.unblock] }
      : { code: 'publish-refused', reason: `${failure.step}: ${failure.detail}`, unblock: [...failure.unblock] };
  if (json) console.log(JSON.stringify(refusal));
  else console.error(refusalLines(refusal).join('\n'));
  process.exit(2);
});

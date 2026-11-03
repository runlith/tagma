import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { makeManifestProjection } from '@tagma/server/installation/closure/manifests';
import { readAttempt } from '@tagma/server/installation/closure/attempt';
import { currentVersion } from '@tagma/server/installation/closure/versions';
import { RELEASE_INSIDE, RUNTIME_PART, hostBundle } from '@tagma/server/installation/contract/wire/layout';
import { DESKTOP } from '@tagma/server/installation/contract/wire/manifest';
import { compareReleases, isRelease } from '@tagma/server/installation/contract/wire/feed';
import { CHANNEL } from './channel.js';

export type Bearing = { readonly build: string; readonly digest: string };

export type Standing = Bearing & { readonly version: string };

export type Branch = 'follow' | 'install' | 'equal';

const manifests = makeManifestProjection();

const LEASE = `const { dlopen } = require('bun:ffi');
const libc = dlopen('libc.dylib', { flock: { args: ['i32', 'i32'], returns: 'i32' } });
const held = require('node:fs').openSync(process.env.TAGMA_LEASED, 'r');
if (libc.symbols.flock(held, 5) !== 0) process.exit(3);
process.stdout.write('held\\n');
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();`;

export type Fallen = {
  readonly fell: 'rolled-back' | 'unrestored';
  readonly key: string;
  readonly to: Standing | null;
  readonly build: string;
  readonly back: string | null;
  readonly said: string | null;
  readonly detail: string;
};

export const carriedIn = (bundle: string): string => join(bundle, RELEASE_INSIDE);

export function carriedBy(bundle: string): Bearing | null {
  const read = manifests.read(carriedIn(bundle));
  return read._tag === 'Read' ? { build: read.manifest.identity.build, digest: read.manifest.identity.digest } : null;
}

export function standingIn(installRoot: string): Standing | null {
  const version = currentVersion(installRoot);
  if (version === null) return null;
  const read = manifests.read(join(installRoot, version));
  return read._tag === 'Read' ? { version, build: read.manifest.identity.build, digest: read.manifest.identity.digest } : null;
}

export function fallen(installRoot: string): Fallen | null {
  const attempt = readAttempt(installRoot);
  const ended = attempt?.ended ?? null;
  if (attempt === null || ended === null) return null;
  const current = currentVersion(installRoot);
  const fell = ended.data === 'unrestored' ? 'unrestored' : 'rolled-back';
  if (current !== (fell === 'unrestored' ? attempt.to : attempt.from)) return null;
  const manifest = manifests.at(installRoot, attempt.to);
  const build = manifest?.identity.build ?? attempt.to;
  return {
    fell,
    key: `${attempt.from ?? ''}>${attempt.to}: ${ended.detail}`,
    to: manifest === undefined ? null : { version: attempt.to, build, digest: manifest.identity.digest },
    build,
    back: attempt.from === null ? null : (manifests.at(installRoot, attempt.from)?.identity.build ?? attempt.from),
    said: ended.words?.text ?? null,
    detail: ended.detail,
  };
}

export const keptPath = (installRoot: string, version: string): string => join(installRoot, version, DESKTOP, hostBundle(CHANNEL.name));

export function keptApplication(installRoot: string, standing: Standing): string | null {
  const kept = keptPath(installRoot, standing.version);
  return carriedBy(kept)?.digest === standing.digest ? kept : null;
}

export const numbered = (bearing: Bearing): boolean => isRelease(bearing.build);

export function installedAs(installRoot: string, bearing: Bearing): Standing | null {
  const version = manifests.identified(bearing.digest, installRoot);
  return version === null ? null : { version, ...bearing };
}

export function branchOf(own: Bearing, standing: Standing | null, installRoot: string, settled: boolean): Branch {
  if (standing === null) return 'install';
  if (own.digest === standing.digest) return 'equal';
  if (settled) return 'follow';
  if (isRelease(own.build) && isRelease(standing.build)) return compareReleases(own.build, standing.build) < 0 ? 'follow' : 'install';
  return manifests.identified(own.digest, installRoot) === null ? 'install' : 'follow';
}

export const leaseRelease = async (root: string, env: NodeJS.ProcessEnv): Promise<ChildProcess> => {
  const holder = spawn(join(root, RUNTIME_PART), ['-e', LEASE], {
    env: { ...env, TAGMA_LEASED: root },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  holder.on('error', (error) =>
    console.error(`[tagma-desktop] the lease on ${root} could not be taken, so a prune may remove it: ${error.message}`),
  );
  const waiting = new AbortController();
  const lines = createInterface({ input: holder.stdout });
  try {
    await Promise.race([
      once(lines, 'line', { signal: waiting.signal }).then(([answer]) => {
        if (answer !== 'held') throw new Error(`The lease on ${root} answered ${String(answer)}.`);
      }),
      once(holder, 'exit', { signal: waiting.signal }).then(([code, signal]) => {
        throw new Error(`The lease on ${root} ended before acquisition: ${signal ?? code}.`);
      }),
    ]);
    return holder;
  } catch (error) {
    if (holder.pid !== undefined && holder.exitCode === null && holder.signalCode === null) {
      const exited = once(holder, 'exit');
      holder.kill();
      await exited;
    }
    throw error;
  } finally {
    waiting.abort();
    lines.close();
  }
};

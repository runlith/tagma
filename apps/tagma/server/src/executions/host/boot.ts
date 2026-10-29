import { randomUUID } from 'node:crypto';
import { withFileLock } from '@runlith/file-lock/FileLock';
import { ByteSize, Clock, Duration, Effect, FileSystem, Ref, Schema, type Scope, Stream } from 'effect';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import type { HostAuthority } from '@runlith/executions/HostAuthority';
import type { HostLifecycle } from '@runlith/executions/HostLifecycle';
import type { HostAddress } from '@runlith/executions/hostAddress';
import { ARTIFACT_FILE, type ArtifactManifest, type ArtifactPlatform, type Digest } from '@runlith/executions/protocol/artifact';
import { pathOf, readArtifact } from '@runlith/executions/hostArtifacts';
import type { HostRegistration } from '@runlith/executions/HostRegistration';
import {
  bootPath,
  HostBoot as HostBootFile,
  type HostLifetime,
  loadRefusalOf,
  OUTPUT_LIMIT_VARIABLE,
} from '@runlith/executions/protocol/boot';
import type { Registration } from '@runlith/executions/protocol/registration';
import type { ExecutionPolicy } from '@runlith/executions/protocol/capacity';
import { type InstallationId, type HostRequestRef, HostRequestKey } from '@runlith/executions/protocol/execution';
import type { ClaimHolders } from '../contract/service/host.js';
import { executionGrant, executionWireLimits } from './policy.js';

export const hostBundle = (state: string): string => `${state}/bundle`;

export type HostBoot =
  | { readonly _tag: 'Adopted' }
  | { readonly _tag: 'Raised' }
  | { readonly _tag: 'NoBundle'; readonly bundle: string; readonly remedy: string }
  | { readonly _tag: 'UnsupportedPlatform'; readonly platform: ArtifactPlatform; readonly offered: ArtifactPlatform }
  | { readonly _tag: 'Awaited' }
  | { readonly _tag: 'Unraised'; readonly reason: string };

export const hostBootDetail = (boot: HostBoot): string => {
  switch (boot._tag) {
    case 'Adopted':
      return 'A host was already serving this installation and was adopted.';
    case 'Raised':
      return 'This server raised the host from its own bundle.';
    case 'NoBundle':
      return `No execution host is running and none can be raised: this installation has no host bundle at ${boot.bundle}. Build one with: ${boot.remedy}`;
    case 'UnsupportedPlatform':
      return `No execution host can be raised on ${boot.platform.os}/${boot.platform.arch}: the bundle was built for ${boot.offered.os}/${boot.offered.arch}.`;
    case 'Awaited':
      return 'The execution host of the release before this one keeps every terminal running; this release takes it over once its door opens, and terminal calls wait until then.';
    case 'Unraised':
      return `No execution host is running: raising one from this installation's bundle did not come up — ${boot.reason}`;
  }
};

export type HostPresence =
  | { readonly _tag: 'Answering' }
  | { readonly _tag: 'Unspoken'; readonly detail: string }
  | { readonly _tag: 'Unsettled'; readonly detail: string }
  | { readonly _tag: 'Absent'; readonly detail: string };

const failureDetail = (failure: ExecutionsFailure): string => {
  switch (failure._tag) {
    case 'WireUnavailable':
      return `${failure.kind}: ${failure.reason}`;
    case 'WireUnreadable':
    case 'WireInvalid':
      return failure.detail;
    case 'WireFailed':
      return `the host refused the hello: ${failure.fault.kind} — ${failure.fault.detail}`;
    case 'WireLost':
      return `the connection closed: ${failure.reason}`;
    case 'HostRefused':
      return `${failure.refusal._tag}: ${failure.refusal.reason}`;
  }
};

export const hostPresence = (probe: Effect.Effect<unknown, ExecutionsFailure>): Effect.Effect<HostPresence> =>
  Effect.match(probe, {
    onSuccess: (): HostPresence => ({ _tag: 'Answering' }),
    onFailure: (failure): HostPresence => {
      if (failure._tag === 'HostRefused') return { _tag: 'Answering' };
      if (failure._tag === 'WireUnavailable' && (failure.kind === 'absent' || failure.kind === 'unreachable')) {
        return { _tag: 'Absent', detail: failureDetail(failure) };
      }
      if (failure._tag === 'WireUnavailable' || failure._tag === 'WireLost') return { _tag: 'Unsettled', detail: failureDetail(failure) };
      return { _tag: 'Unspoken', detail: failureDetail(failure) };
    },
  });

const CLAIM_FILE = 'writer.lock';

export type StateClaim =
  | { readonly _tag: 'Held'; readonly holders: ReadonlyArray<number> }
  | { readonly _tag: 'Free' }
  | { readonly _tag: 'Unmeasured'; readonly detail: string };

export const stateClaim = Effect.fn('HostBoot.stateClaim')(function* (
  holders: ClaimHolders['Service'],
  files: FileSystem.FileSystem,
  state: string,
): Effect.fn.Return<StateClaim> {
  const claim = `${state}/${CLAIM_FILE}`;
  const stands = yield* Effect.result(files.exists(claim));
  if (stands._tag === 'Failure') {
    return { _tag: 'Unmeasured', detail: `${claim} could not be read: ${stands.failure.reason._tag}` };
  }
  if (!stands.success) return { _tag: 'Free' };
  const holding = yield* holders.of(claim);
  if (holding._tag === 'Unread') return { _tag: 'Unmeasured', detail: holding.detail };
  return holding.pids.length > 0 ? { _tag: 'Held', holders: holding.pids } : { _tag: 'Free' };
});

const CLAIM_EVERY_MS = 1_000;

export const pacedClaim = (claim: Effect.Effect<StateClaim>): Effect.Effect<StateClaim | undefined> => {
  let claimedAt = Number.NEGATIVE_INFINITY;
  return Effect.flatMap(Clock.currentTimeMillis, (now) => {
    if (now - claimedAt < CLAIM_EVERY_MS) return Effect.succeed(undefined);
    claimedAt = now;
    return claim;
  });
};

export const signalClaimHolder = (pid: number, signal: string): Effect.Effect<boolean> =>
  Effect.sync(() => {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      globalThis.process.kill(pid, signal as NodeJS.Signals);
      return true;
    } catch {
      return false;
    }
  });

const remedyFor = (bundle: string): string => `bun packages/execution-host/src/buildArtifact.ts ${bundle} $(git rev-parse --short HEAD)`;

export const bootInput = (
  state: string,
  registration: Registration,
  manifest: ArtifactManifest,
  policy: ExecutionPolicy,
  lifetime?: HostLifetime,
): HostBootFile | undefined => {
  const bundle = hostBundle(state);
  const library = pathOf(bundle, manifest, 'platform');
  if (library === undefined) return undefined;
  const { version, installation, protocol, endpoint, credentials } = registration;
  return {
    state,
    registration: { version, state: registration.state, installation, protocol, endpoint, credentials },
    library,
    policy,
    share: executionGrant.share,
    limits: executionWireLimits,
    lifetime,
    artifact: bundle,
  };
};

export const bootText = Schema.encodeSync(Schema.fromJsonString(HostBootFile));

export const logicFell = Effect.fnUntraced(function* (
  files: FileSystem.FileSystem,
  state: string,
  digest: Digest,
): Effect.fn.Return<string | undefined> {
  const read = yield* Effect.result(files.readFileString(loadRefusalOf(bootPath(state, digest))));
  if (read._tag === 'Failure') {
    if (read.failure.reason._tag !== 'NotFound') {
      yield* Effect.logDebug('the load refusal a host logic leaves could not be read', { reason: read.failure.reason._tag });
    }
    return undefined;
  }
  const cause = read.success.trim();
  return cause.length > 0 ? `the logic of ${digest} does not come up: ${cause}` : undefined;
});

export const hostRaisable = Effect.fnUntraced(function* (files: FileSystem.FileSystem, bundle: string) {
  const read = yield* Effect.result(files.exists(`${bundle}/${ARTIFACT_FILE}`));
  if (read._tag === 'Success') return read.success;
  yield* Effect.logWarning('whether a host bundle stands could not be read; none is raised from it', {
    bundle,
    reason: read.failure.reason._tag,
  });
  return false;
});

export type RaiseInput = {
  readonly address: HostAddress;
  readonly files: FileSystem.FileSystem;
  readonly registrations: HostRegistration['Service'];
  readonly policy: ExecutionPolicy;
  readonly status: Effect.Effect<unknown, ExecutionsFailure>;
  readonly claim: Effect.Effect<StateClaim>;
  readonly swap: Effect.Effect<void>;
  readonly lifetime?: HostLifetime;
};

const LOOKED_EVERY = Duration.millis(100);
const BOOT_OUTPUT_BYTES = 16 * 1024;

const diagnosticTail = Effect.fn('HostBoot.stderr')(function* (files: FileSystem.FileSystem, path: string) {
  const file = yield* files.open(path);
  const size = ByteSize.toBigInt((yield* file.stat).size);
  const limit = BigInt(BOOT_OUTPUT_BYTES);
  yield* file.seek(size > limit ? size - limit : 0n, 'start');
  const bytes = yield* file.readAlloc(BOOT_OUTPUT_BYTES);
  return bytes._tag === 'None' ? '' : new TextDecoder().decode(bytes.value).trim();
}, Effect.scoped);

export const raiseHost = Effect.fnUntraced(function* (input: RaiseInput): Effect.fn.Return<HostBoot> {
  const standingBundle = hostBundle(input.address.state);
  const published = yield* Effect.result(input.registrations.read(input.address.state));
  const declared = yield* Effect.result(readArtifact(standingBundle).pipe(Effect.provideService(FileSystem.FileSystem, input.files)));
  if (
    published._tag === 'Success' &&
    declared._tag === 'Success' &&
    input.address.digest !== null &&
    published.success.artifact?.identity.digest === declared.success.identity.digest &&
    (input.address.digest === undefined || published.success.artifact.identity.digest === input.address.digest)
  ) {
    const standing = yield* hostPresence(input.status);
    if (standing._tag === 'Answering') return { _tag: 'Adopted' } as const;
    if (standing._tag !== 'Absent') return { _tag: 'Unraised', reason: standing.detail } as const;
  }
  if (input.address.digest === null) return { _tag: 'Unraised', reason: 'this installation offered no host bundle' } as const;
  yield* input.swap;
  const bundle = hostBundle(input.address.state);
  const read = yield* Effect.result(readArtifact(bundle).pipe(Effect.provideService(FileSystem.FileSystem, input.files)));
  if (read._tag === 'Failure') {
    return read.failure._tag === 'ArtifactMissing'
      ? ({ _tag: 'NoBundle', bundle, remedy: remedyFor(bundle) } as const)
      : ({ _tag: 'Unraised', reason: `the bundle could not be read: ${read.failure.detail}` } as const);
  }
  const manifest = read.success;
  if (input.address.digest !== undefined && manifest.identity.digest !== input.address.digest) {
    return { _tag: 'Unraised', reason: 'the standing bundle is not the one this installation offered' } as const;
  }
  const platform = { os: process.platform, arch: process.arch };
  if (manifest.platform.os !== platform.os || manifest.platform.arch !== platform.arch) {
    return { _tag: 'UnsupportedPlatform', platform, offered: manifest.platform } as const;
  }
  const claim = yield* input.claim;
  if (claim._tag === 'Held') return { _tag: 'Unraised', reason: 'the host writer claim is held; no holder was started' } as const;
  if (claim._tag === 'Unmeasured') return { _tag: 'Unraised', reason: `the host writer claim could not be read: ${claim.detail}` } as const;
  const holder = pathOf(bundle, manifest, 'holder');
  const runtime = pathOf(bundle, manifest, 'runtime');
  const entry = pathOf(bundle, manifest, 'host');
  if (holder === undefined || runtime === undefined || entry === undefined) {
    return { _tag: 'Unraised', reason: 'the bundle does not name all of its launch parts' } as const;
  }
  const registered = yield* Effect.result(input.registrations.read(input.address.state));
  if (registered._tag === 'Failure' && registered.failure._tag !== 'RegistrationMissing') {
    return { _tag: 'Unraised', reason: `the registration could not be read: ${registered.failure._tag}` } as const;
  }
  const registration =
    registered._tag === 'Success'
      ? registered.success
      : {
          version: 1 as const,
          state: input.address.state,
          installation: input.address.installation,
          protocol: manifest.protocol,
          endpoint: { ...manifest.endpoint, path: `${input.address.state}/${manifest.endpoint.path}` },
          credentials: {
            custodian: `${input.address.state}/custodian`,
            recovery: `${input.address.state}/recovery`,
          },
        };
  if (registration.installation !== input.address.installation || registration.protocol !== manifest.protocol) {
    return { _tag: 'Unraised', reason: 'the registration names another installation or protocol' } as const;
  }
  const given = bootInput(input.address.state, registration, manifest, input.policy, input.lifetime);
  if (given === undefined) return { _tag: 'Unraised', reason: 'the bundle does not name all of its launch parts' } as const;
  const boot = bootPath(input.address.state, manifest.identity.digest);
  const written = yield* Effect.result(input.files.writeFileString(boot, bootText(given), { mode: 0o600 }));
  if (written._tag === 'Failure') {
    return { _tag: 'Unraised', reason: `the boot file ${boot} could not be written` } as const;
  }
  const diagnostic = `${input.address.state}/boot-${randomUUID()}.stderr`;
  const created = yield* Effect.result(input.files.writeFileString(diagnostic, '', { flag: 'wx', mode: 0o600 }));
  if (created._tag === 'Failure') {
    return { _tag: 'Unraised', reason: `the holder's output file could not be opened: ${created.failure.message}` } as const;
  }
  return yield* withFileLock(diagnostic, 0, ({ handle }) =>
    Effect.gen(function* () {
      const spawned = yield* Effect.sync(() => {
        try {
          const child = Bun.spawn([holder, input.address.state, runtime, entry, boot], {
            stdin: input.lifetime === 'with-parent' ? 'inherit' : 'ignore',
            stdout: handle.fd,
            stderr: handle.fd,
            cwd: input.address.state,
            env: { ...process.env, [OUTPUT_LIMIT_VARIABLE]: String(BOOT_OUTPUT_BYTES) },
          });
          child.unref();
          return child;
        } catch (error) {
          return String(error);
        }
      });
      if (typeof spawned === 'string') return { _tag: 'Unraised', reason: `the host would not start: ${spawned}` } as const;
      const settled = Effect.fnUntraced(function* () {
        for (;;) {
          yield* Effect.sleep(LOOKED_EVERY);
          const seen = yield* hostPresence(input.status);
          if (seen._tag === 'Answering' || seen._tag === 'Unspoken') return seen;
        }
      });
      const exited = Effect.map(
        Effect.promise(() => spawned.exited),
        () => ({
          _tag: 'Exited' as const,
          ended: spawned.signalCode ?? `exit ${spawned.exitCode ?? 'unknown'}`,
        }),
      );
      const answered = (seen: Extract<HostPresence, { _tag: 'Answering' | 'Unspoken' }>): HostBoot =>
        seen._tag === 'Answering'
          ? { _tag: 'Raised' }
          : {
              _tag: 'Unraised',
              reason: `the host raised from ${bundle} answers something this server cannot read — ${seen.detail}; that bundle was built for another wire than this server speaks`,
            };
      const ended = yield* Effect.raceFirst(settled(), exited);
      if (ended._tag !== 'Exited') return answered(ended);
      const last = yield* hostPresence(input.status);
      if (last._tag === 'Answering' || last._tag === 'Unspoken') return answered(last);
      const captured = yield* Effect.result(diagnosticTail(input.files, diagnostic));
      const output = captured._tag === 'Success' ? captured.success : `the output file could not be read: ${captured.failure.message}`;
      return {
        _tag: 'Unraised',
        reason: `its holder started from ${bundle} ended (${ended.ended}) before its host answered — ${last.detail}; output at ${diagnostic}${output === '' ? ' is empty' : `:\n${output}`}`,
      } as const;
    }),
  ).pipe(
    Effect.catchTags({
      LockBusy: () =>
        Effect.succeed({ _tag: 'Unraised' as const, reason: `the holder's output file ${diagnostic} is held by another attempt` }),
      LockUnavailable: (failure) =>
        Effect.succeed({
          _tag: 'Unraised' as const,
          reason: `the holder's output file ${diagnostic} could not be held: ${failure.reason}`,
        }),
    }),
  );
});

export type HostShare =
  | { readonly _tag: 'Granted'; readonly share: number; readonly grantBytes: number; readonly over: number }
  | { readonly _tag: 'Standing'; readonly share: number }
  | { readonly _tag: 'Declined'; readonly share: number; readonly detail: string };

export type HostShareInput = {
  readonly installation: InstallationId;
  readonly executions: HostAuthority['Service'] & HostLifecycle['Service'];
};

export const hostShareDetail = (outcome: HostShare): string => {
  switch (outcome._tag) {
    case 'Granted':
      return outcome.over === 0
        ? `the execution host was granted a ${outcome.share} share of its machine (${outcome.grantBytes} bytes)`
        : `the execution host was granted a ${outcome.share} share of its machine (${outcome.grantBytes} bytes); it holds ${outcome.over} bytes above that, which it reclaims from the history of its least-recently-active terminals`;
    case 'Standing':
      return `the execution host already holds a ${outcome.share} share of its machine`;
    case 'Declined':
      return `the execution host was not moved onto a ${outcome.share} share of its machine: ${outcome.detail}`;
  }
};

export const grantHostShare = Effect.fnUntraced(function* (
  input: HostShareInput,
  held: number | undefined,
  share: number,
): Effect.fn.Return<HostShare> {
  if (held === undefined) {
    const profile = yield* Effect.result(input.executions.capabilities());
    if (profile._tag === 'Failure') {
      return {
        _tag: 'Declined',
        share,
        detail: `it would not say what it was granted (${profile.failure._tag})`,
      } satisfies HostShare;
    }
    if (profile.success.granted.share === share) return { _tag: 'Standing', share } satisfies HostShare;
  } else if (held === share) {
    return { _tag: 'Standing', share } satisfies HostShare;
  }
  const key: HostRequestRef = {
    installation: input.installation,
    operation: HostRequestKey.make(`host-grant-${randomUUID()}`),
  };
  const outcome = yield* Effect.result(input.executions.grant(key, share));
  if (outcome._tag === 'Failure') {
    return { _tag: 'Declined', share, detail: `it could not be reached (${outcome.failure._tag})` } satisfies HostShare;
  }
  const answered = outcome.success;
  switch (answered._tag) {
    case 'Granted':
      return {
        _tag: 'Granted',
        share: answered.granted.share,
        grantBytes: answered.granted.grantBytes,
        over: answered.over,
      } satisfies HostShare;
    case 'Refused':
      return {
        _tag: 'Declined',
        share,
        detail: `it refused the act: ${answered.refusal.reason}`,
      } satisfies HostShare;
    default:
      return {
        _tag: 'Declined',
        share,
        detail: `it answered a grant with ${answered._tag}, which its contract never sends`,
      } satisfies HostShare;
  }
});

export const holdHostShare = (input: HostShareInput, shares: Stream.Stream<number>): Effect.Effect<void, never, Scope.Scope> =>
  Effect.asVoid(
    Effect.forkScoped(
      Effect.flatMap(Ref.make<number | undefined>(undefined), (held) =>
        Stream.runForEach(shares, (share) =>
          Effect.gen(function* () {
            const outcome = yield* grantHostShare(input, yield* Ref.get(held), share);
            if (outcome._tag !== 'Declined') yield* Ref.set(held, outcome.share);
            if (outcome._tag === 'Granted') yield* Effect.log(hostShareDetail(outcome));
            if (outcome._tag === 'Declined') yield* Effect.logWarning(hostShareDetail(outcome));
          }),
        ),
      ),
    ),
  );

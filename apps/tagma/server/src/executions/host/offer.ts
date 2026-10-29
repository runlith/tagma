import { HostPreparationRefused, type HostOffer, type HostPlacement, type OfferSource } from '../contract/service/host.js';
import { Effect, FileSystem, type Scope } from 'effect';
import { withFileLock } from '@runlith/file-lock/FileLock';
import type { HostRegistration } from '@runlith/executions/HostRegistration';
import type { ArtifactManifest, Digest } from '@runlith/executions/protocol/artifact';
import { bootPath, type HostLifetime } from '@runlith/executions/protocol/boot';
import { type ArtifactFailure, readArtifact, verifyArtifact } from '@runlith/executions/hostArtifacts';
import { bootInput, bootText, hostBundle, type StateClaim } from './boot.js';
import { executionPolicy } from './policy.js';

export const hostBundleNext = (state: string): string => `${state}/bundle.next`;

export const hostBootNext = (state: string): string => `${state}/boot.next.json`;

export const hostBundleOwn = (state: string): string => `${state}/bundle.own`;

export const hostCandidateRestart = (state: string): string => `${state}/bundle.next.restart`;

const PRODUCER = 'src/buildArtifact.ts';

const REMEDY = 'bun run --cwd packages/execution-host build:native';

const QUOTED = 400;

export type OfferInput = {
  readonly files: FileSystem.FileSystem;
  readonly state: string;
  readonly source: OfferSource;
};

const named = (source: OfferSource): string =>
  source._tag === 'Checkout' ? 'the checkout produces' : "this installation's closure carries";

const refusedBy = (refusal: ArtifactFailure): string => {
  switch (refusal._tag) {
    case 'ArtifactMissing':
      return `no manifest stands at ${refusal.root}`;
    case 'ArtifactInvalid':
      return refusal.reason === 'mismatch'
        ? `${refusal.path} names ${refusal.expected} and stands ${refusal.found}`
        : `${refusal.root} declares a bundle this reader cannot take: ${refusal.detail}`;
    case 'ArtifactUnreadable':
      return `${refusal.path} could not be read: ${refusal.detail}`;
  }
};

const said = (text: string): string => {
  const first = text.trim().split('\n')[0]?.trim() ?? '';
  return first.length > QUOTED ? `${first.slice(0, QUOTED)}…` : first;
};

const stated = Effect.fnUntraced(function* (files: FileSystem.FileSystem, root: string): Effect.fn.Return<ArtifactManifest | undefined> {
  const read = yield* Effect.result(Effect.provideService(readArtifact(root), FileSystem.FileSystem, files));
  if (read._tag === 'Success') return read.success;
  if (read.failure._tag !== 'ArtifactMissing')
    yield* Effect.logDebug('a host bundle manifest could not be taken', { reason: refusedBy(read.failure) });
  return undefined;
});

const declared = (files: FileSystem.FileSystem, root: string): Effect.Effect<Digest | undefined> =>
  Effect.map(stated(files, root), (manifest) => manifest?.identity.digest);

export const carriedOffer = Effect.fnUntraced(function* (input: OfferInput): Effect.fn.Return<HostOffer> {
  const digest = input.source._tag === 'Closure' ? yield* declared(input.files, input.source.path) : undefined;
  return digest === undefined
    ? { _tag: 'Unoffered', detail: `${input.source.path} carries no host bundle this server can read` }
    : { _tag: 'Offered', digest, detail: `${named(input.source)} the host bundle it hands the host once its door opens` };
});

const discard = (files: FileSystem.FileSystem, root: string): Effect.Effect<void> =>
  Effect.asVoid(Effect.result(files.remove(root, { recursive: true, force: true })));

export const hostOffer = Effect.fnUntraced(function* (input: OfferInput): Effect.fn.Return<HostOffer> {
  const standing = hostBundle(input.state);
  const next = hostBundleNext(input.state);
  const carried = input.source._tag === 'Closure' ? yield* stated(input.files, input.source.path) : undefined;
  if (carried !== undefined && carried.identity.digest === (yield* declared(input.files, standing))) {
    yield* discard(input.files, next);
    return {
      _tag: 'Offered',
      digest: carried.identity.digest,
      detail: `${named(input.source)} the host bundle already in place`,
    } satisfies HostOffer;
  }
  yield* Effect.result(input.files.makeDirectory(input.state, { recursive: true, mode: 0o700 }));
  const own = hostBundleOwn(input.state);
  yield* discard(input.files, own);
  const refused = yield* input.source._tag === 'Checkout' ? running(input.source, own) : copied(input.files, input.source, own);
  if (refused !== undefined) {
    yield* Effect.logWarning(refused);
    return { _tag: 'Unoffered', detail: refused } satisfies HostOffer;
  }
  const offered = yield* stated(input.files, own);
  if (offered === undefined) {
    yield* discard(input.files, own);
    const detail = `${input.source.path} left nothing this server can read at ${own}`;
    yield* Effect.logWarning(detail);
    return { _tag: 'Unoffered', detail } satisfies HostOffer;
  }
  if (offered.identity.digest === (yield* declared(input.files, standing))) {
    yield* discard(input.files, own);
    yield* discard(input.files, next);
    return {
      _tag: 'Offered',
      digest: offered.identity.digest,
      detail: `${named(input.source)} the host bundle already in place`,
    } satisfies HostOffer;
  }
  yield* discard(input.files, next);
  const moved = yield* Effect.result(input.files.rename(own, next));
  if (moved._tag === 'Failure') {
    yield* discard(input.files, own);
    const detail = `${own} could not take the place of ${next}: ${moved.failure.reason._tag}`;
    yield* Effect.logWarning(detail);
    return { _tag: 'Unoffered', detail } satisfies HostOffer;
  }
  return {
    _tag: 'Offered',
    digest: offered.identity.digest,
    detail: `${named(input.source)} a host bundle the one in place is not (${offered.identity.build}); it waits at ${next}`,
  } satisfies HostOffer;
});

export type PlacementInput = {
  readonly files: FileSystem.FileSystem;
  readonly registrations: HostRegistration['Service'];
  readonly source: OfferSource;
  readonly own: string;
  readonly state: string;
  readonly restart: string | null;
  readonly lifetime?: HostLifetime;
};

const refusing = (detail: string): HostPreparationRefused => new HostPreparationRefused({ detail });

const written = (files: FileSystem.FileSystem, path: string, text: string): Effect.Effect<void, HostPreparationRefused> => {
  const draft = `${path}.${process.pid}`;
  return files.writeFileString(draft, text, { mode: 0o600 }).pipe(
    Effect.andThen(files.rename(draft, path)),
    Effect.mapError((failure) => refusing(`${path} could not be written: ${failure.message}`)),
    Effect.onExit((exit) => (exit._tag === 'Failure' ? discard(files, draft) : Effect.void)),
  );
};

const sweepBoots = Effect.fnUntraced(function* (files: FileSystem.FileSystem, state: string, kept: ReadonlyArray<string>) {
  const listed = yield* files
    .readDirectory(state)
    .pipe(Effect.mapError((failure) => refusing(`${state} could not be listed: ${failure.message}`)));
  for (const entry of listed) {
    const path = `${state}/${entry}`;
    if (entry.startsWith('boot') && entry.endsWith('.json') && !kept.includes(path)) yield* discard(files, path);
    if (entry.startsWith('boot-') && entry.endsWith('.stderr')) {
      yield* withFileLock(path, 0, () => Effect.andThen(discard(files, path), discard(files, `${path}.writing`))).pipe(
        Effect.catchTag('LockBusy', () => Effect.void),
        Effect.catchTag('LockUnavailable', (failure) => Effect.fail(refusing(`${path} could not be held for cleanup: ${failure.reason}`))),
      );
    }
  }
});

const marked = (files: FileSystem.FileSystem, state: string, restart: string | null): Effect.Effect<void, HostPreparationRefused> =>
  restart === null ? discard(files, hostCandidateRestart(state)) : written(files, hostCandidateRestart(state), restart);

export const candidateRestart = Effect.fnUntraced(function* (files: FileSystem.FileSystem, state: string) {
  const path = hostCandidateRestart(state);
  const named = yield* files.exists(path).pipe(Effect.mapError((failure) => refusing(`${path} could not be read: ${failure.message}`)));
  if (!named) return null;
  return yield* files.readFileString(path).pipe(Effect.mapError((failure) => refusing(`${path} could not be read: ${failure.message}`)));
});

export const placeCandidate = Effect.fnUntraced(
  function* (input: PlacementInput): Effect.fn.Return<HostPlacement, HostPreparationRefused> {
    const { files, state, source, own } = input;
    const standing = yield* stated(files, hostBundle(state));
    const registered = yield* Effect.result(input.registrations.read(state));
    if (standing === undefined || registered._tag === 'Failure') {
      return { _tag: 'Vacant', detail: `no host stands at ${state} to hand a candidate to` };
    }
    const standingBoot = bootPath(state, standing.identity.digest);
    if (source._tag === 'Checkout') {
      yield* discard(files, own);
      yield* files.makeDirectory(own, { recursive: true, mode: 0o700 }).pipe(Effect.mapError((failure) => refusing(failure.message)));
      const refusal = yield* running(source, own);
      if (refusal !== undefined) return yield* refusing(refusal);
    }
    const root = source._tag === 'Closure' ? source.path : own;
    const offered = yield* Effect.provideService(readArtifact(root), FileSystem.FileSystem, files).pipe(
      Effect.mapError((failure) => refusing(refusedBy(failure))),
    );
    if (offered.protocol !== registered.success.protocol) {
      return yield* refusing(`the offered host bundle speaks ${offered.protocol} and the standing host ${registered.success.protocol}`);
    }
    const given = bootInput(state, registered.success, offered, executionPolicy, input.lifetime);
    if (given === undefined) return yield* refusing(`${root} names no platform library`);
    const text = bootText(given);
    const digest = offered.identity.digest;
    if (digest === standing.identity.digest) {
      yield* discard(files, own);
      yield* discard(files, hostBundleNext(state));
      const stood = yield* Effect.result(files.readFileString(standingBoot));
      if (stood._tag === 'Success' && stood.success === text) {
        yield* sweepBoots(files, state, [standingBoot]);
        return { _tag: 'Standing', digest, detail: `${named(source)} the host bundle and boot input already in place` };
      }
      yield* marked(files, state, input.restart);
      yield* written(files, hostBootNext(state), text);
      yield* sweepBoots(files, state, [standingBoot, hostBootNext(state)]);
      return { _tag: 'Placed', digest, bundle: false, detail: `${named(source)} the host bundle in place under another boot input` };
    }
    if (source._tag === 'Closure') {
      yield* discard(files, own);
      yield* files
        .copy(source.path, own, { overwrite: true })
        .pipe(Effect.mapError((failure) => refusing(`${source.path} could not be copied to ${own}: ${failure.reason._tag}`)));
    }
    yield* Effect.provideService(verifyArtifact(own), FileSystem.FileSystem, files).pipe(
      Effect.mapError((failure) => refusing(`the offered host bundle does not verify — ${refusedBy(failure)}`)),
    );
    const placedBoot = bootPath(state, digest);
    yield* written(files, placedBoot, text);
    yield* sweepBoots(files, state, [standingBoot, placedBoot]);
    yield* discard(files, hostBundleNext(state));
    yield* marked(files, state, input.restart);
    yield* files.rename(own, hostBundleNext(state)).pipe(Effect.mapError((failure) => refusing(failure.message)));
    return {
      _tag: 'Placed',
      digest,
      bundle: true,
      detail: `${named(source)} a host bundle the one in place is not (${offered.identity.build})`,
    };
  },
  (effect, input) => Effect.onExit(effect, (exit) => (exit._tag === 'Failure' ? discard(input.files, input.own) : Effect.void)),
);

export type Candidate =
  | { readonly _tag: 'Bundle'; readonly digest: Digest }
  | { readonly _tag: 'Boot'; readonly digest: Digest }
  | { readonly _tag: 'Unread'; readonly detail: string };

export const candidateOf = Effect.fnUntraced(function* (
  files: FileSystem.FileSystem,
  state: string,
): Effect.fn.Return<Candidate | undefined, HostPreparationRefused> {
  const next = yield* Effect.result(Effect.provideService(readArtifact(hostBundleNext(state)), FileSystem.FileSystem, files));
  if (next._tag === 'Success') return { _tag: 'Bundle', digest: next.success.identity.digest };
  if (next.failure._tag !== 'ArtifactMissing') return { _tag: 'Unread', detail: refusedBy(next.failure) };
  const boot = yield* files
    .exists(hostBootNext(state))
    .pipe(Effect.mapError((failure) => refusing(`${hostBootNext(state)} could not be read: ${failure.message}`)));
  if (!boot) return undefined;
  const standing = yield* declared(files, hostBundle(state));
  return standing === undefined ? undefined : { _tag: 'Boot', digest: standing };
});

export const withdrawCandidate = Effect.fnUntraced(function* (files: FileSystem.FileSystem, state: string) {
  const next = yield* declared(files, hostBundleNext(state));
  if (next !== undefined && next !== (yield* declared(files, hostBundle(state)))) yield* discard(files, bootPath(state, next));
  yield* discard(files, hostBundleNext(state));
  yield* discard(files, hostBootNext(state));
  yield* discard(files, hostCandidateRestart(state));
});

export const promoteBoot = Effect.fnUntraced(function* (
  files: FileSystem.FileSystem,
  state: string,
): Effect.fn.Return<Effect.Effect<void, HostPreparationRefused>, HostPreparationRefused> {
  const boot = yield* files
    .exists(hostBootNext(state))
    .pipe(Effect.mapError((failure) => refusing(`${hostBootNext(state)} could not be read: ${failure.message}`)));
  if (!boot) return Effect.void;
  const digest = yield* declared(files, hostBundle(state));
  if (digest === undefined) return yield* refusing(`no host bundle stands at ${hostBundle(state)} to take ${hostBootNext(state)}`);
  const standing = bootPath(state, digest);
  const kept = yield* files
    .readFileString(standing)
    .pipe(Effect.mapError((failure) => refusing(`${standing} could not be kept aside: ${failure.message}`)));
  yield* files
    .rename(hostBootNext(state), standing)
    .pipe(Effect.mapError((failure) => refusing(`${hostBootNext(state)} could not take its place: ${failure.message}`)));
  return written(files, standing, kept);
});

const copied = Effect.fnUntraced(function* (
  files: FileSystem.FileSystem,
  source: Extract<OfferSource, { _tag: 'Closure' }>,
  into: string,
): Effect.fn.Return<string | undefined> {
  const taken = yield* Effect.result(files.copy(source.path, into, { overwrite: true }));
  if (taken._tag === 'Failure') {
    return `no host bundle was offered: ${source.path} could not be copied to ${into} (${taken.failure.reason._tag})`;
  }
  const proved = yield* Effect.result(Effect.provideService(verifyArtifact(into), FileSystem.FileSystem, files));
  if (proved._tag === 'Failure') {
    yield* discard(files, into);
    return `no host bundle was offered: the executions part of this installation does not verify — ${refusedBy(proved.failure)}`;
  }
  return undefined;
});

const running = Effect.fnUntraced(function* (
  source: Extract<OfferSource, { _tag: 'Checkout' }>,
  into: string,
): Effect.fn.Return<string | undefined, never, Scope.Scope> {
  const program = `${source.path}/${PRODUCER}`;
  const started = yield* Effect.result(
    Effect.acquireRelease(
      Effect.try({
        try: () =>
          Bun.spawn([process.execPath, program, into, source.build], {
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'pipe',
            cwd: source.path,
          }),
        catch: (error) => String(error),
      }),
      (child) =>
        Effect.try(() => child.kill('SIGKILL')).pipe(
          Effect.catch((failure) =>
            Effect.logWarning('the host bundle producer could not be killed after its scope ended', { program, failure }),
          ),
          Effect.asVoid,
        ),
    ),
  );
  if (started._tag === 'Failure') {
    return `no host bundle was produced: ${program} would not run (${said(started.failure)}); build the native library once with: ${REMEDY}`;
  }
  const child = started.success;
  const [complained, code] = yield* Effect.promise(() => Promise.all([new Response(child.stderr).text(), child.exited]));
  return code === 0
    ? undefined
    : `no host bundle was produced: the producer answered "${said(complained)}"; build the native library once with: ${REMEDY}`;
}, Effect.scoped);

export const swapBundle = Effect.fnUntraced(function* (files: FileSystem.FileSystem, state: string, claim: Effect.Effect<StateClaim>) {
  const next = hostBundleNext(state);
  if ((yield* declared(files, next)) === undefined) return;
  const held = yield* claim;
  if (held._tag === 'Held') {
    yield* Effect.logWarning(
      `the offered host bundle waits at ${next}: ${held.holders.length} process${held.holders.length === 1 ? '' : 'es'} still hold this installation's state`,
    );
    return;
  }
  if (held._tag === 'Unmeasured') {
    yield* Effect.logWarning(
      `the offered host bundle waits at ${next}: whether a process still holds this installation's state could not be read (${held.detail})`,
    );
    return;
  }
  const standing = hostBundle(state);
  const prior = `${standing}.prior`;
  yield* discard(files, prior);
  const stood = yield* Effect.result(files.exists(standing));
  if (stood._tag === 'Failure') {
    return yield* Effect.logWarning(
      `the offered host bundle waits at ${next}: ${standing} could not be read (${stood.failure.reason._tag})`,
    );
  }
  if (stood.success) {
    const aside = yield* Effect.result(files.rename(standing, prior));
    if (aside._tag === 'Failure') {
      return yield* Effect.logWarning(
        `the offered host bundle waits at ${next}: ${standing} could not be moved aside (${aside.failure.reason._tag})`,
      );
    }
  }
  const moved = yield* Effect.result(files.rename(next, standing));
  if (moved._tag === 'Success') return yield* Effect.log(`the host bundle this installation offered now stands at ${standing}`);
  yield* Effect.logWarning(`the offered host bundle could not take the place of ${standing}: ${moved.failure.reason._tag}`);
  if (!stood.success) return;
  const back = yield* Effect.result(files.rename(prior, standing));
  if (back._tag === 'Failure') yield* Effect.logError(`${prior} could not take its place back at ${standing}: ${back.failure.reason._tag}`);
});

import { describe, expect, test } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { HostRefused, WireLost, WireFailed, WireUnreadable, WireUnavailable } from '@runlith/executions/Executions';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { RegistrationIdentity } from '@runlith/executions/protocol/registration';
import { Effect, FileSystem, Layer, Path, Schema } from 'effect';
import { executionsRefusal, nothingInstalled, resolveExecutionState, severalRefusal, unavailabilityRefusal } from './resolve.js';

const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const registrations = Layer.provide(Layer.merge(HostRegistration.layer, endpointConnection), platform);
const world = Layer.merge(registrations, platform);

const identity = (name: string) =>
  Schema.decodeUnknownSync(RegistrationIdentity)({
    installation: name,
    protocol: 'executions/1',
    endpoint: { transport: 'unix', path: `sock/${name}.sock` },
    credentials: { custodian: `keys/${name}/custodian`, recovery: `keys/${name}/recovery` },
  });

const anchorRoot = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  return yield* files.makeTempDirectoryScoped({ prefix: 'execution-host-' });
});

const install = Effect.fnUntraced(function* (anchor: string, environment: string) {
  const path = yield* Path.Path;
  const owner = yield* HostRegistration;
  const published = yield* owner.publish(path.join(anchor, 'executions', environment), identity(environment));
  return published.registration;
});

layer(world, { excludeTestServices: true })('execution-host addressing', (it) => {
  it.effect('one registration found among entries no reader accepts', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const anchor = yield* anchorRoot;
      const standing = yield* install(anchor, 'env-a');
      const root = path.join(anchor, 'executions');
      yield* files.makeDirectory(path.join(root, 'bad'), { recursive: true });
      yield* files.writeFileString(path.join(root, 'bad', 'registration.json'), 'not json{{{');
      yield* files.makeDirectory(path.join(root, 'empty'), { recursive: true });
      const search = yield* resolveExecutionState({ anchor });

      expect(search._tag).toBe('Found');
      if (search._tag !== 'Found') return;
      expect(String(search.host.registration.installation)).toBe('env-a');
      expect(search.host.state).toBe(standing.state);
    }),
  );

  it.effect('several registrations refuse by name', () =>
    Effect.gen(function* () {
      const anchor = yield* anchorRoot;
      yield* install(anchor, 'env-b');
      yield* install(anchor, 'env-a');
      const outcome = yield* resolveExecutionState({ anchor });

      expect(outcome._tag).toBe('Several');
      if (outcome._tag !== 'Several') return;
      expect(outcome.environments).toEqual(['env-a', 'env-b']);
      const refusal = severalRefusal(outcome.environments);
      expect(refusal.code).toBe('several-execution-hosts');
      expect(refusal.reason).toContain('env-a');
      expect(refusal.reason).toContain('env-b');
      expect(refusal.reason).toContain('--environment');
    }),
  );

  it.effect('no registration answers nothing-installed', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const anchor = yield* anchorRoot;
      const missing = yield* resolveExecutionState({ anchor });
      const root = path.join(anchor, 'executions');
      yield* files.makeDirectory(path.join(root, 'bad'), { recursive: true });
      yield* files.writeFileString(path.join(root, 'bad', 'registration.json'), 'not json{{{');
      const garbage = yield* resolveExecutionState({ anchor });

      expect(missing).toEqual({ _tag: 'None' });
      expect(garbage).toEqual({ _tag: 'None' });
    }),
  );

  it.effect('--state names its directory without searching', () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const anchor = yield* anchorRoot;
      const standing = yield* install(anchor, 'env-a');
      const outcome = yield* resolveExecutionState({ anchor: path.join(anchor, 'absent'), state: standing.state });

      expect(outcome._tag).toBe('Found');
      if (outcome._tag !== 'Found') return;
      expect(String(outcome.host.registration.installation)).toBe('env-a');
    }),
  );

  it.effect('an explicitly named state without a registration is unavailable, not nothing-installed', () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const anchor = yield* anchorRoot;
      const failure = yield* Effect.flip(resolveExecutionState({ anchor, state: path.join(anchor, 'executions', 'env-missing') }));

      expect(failure._tag).toBe('RegistrationMissing');
    }),
  );
});

describe('execution-host refusals', () => {
  test('each unavailability kind refuses on its own, and only absent means nothing installed', () => {
    const kinds = ['absent', 'invalid', 'mismatched', 'unreachable', 'credential'] as const;
    const refusals = kinds.map((kind) => ({ kind, refusal: unavailabilityRefusal(kind, `wire says ${kind}`) }));
    expect(new Set(refusals.map((entry) => entry.refusal.code)).size).toBe(kinds.length);
    for (const entry of refusals) {
      expect(entry.refusal.reason).toContain(`wire says ${entry.kind}`);
      if (entry.kind === 'absent') expect(entry.refusal.reason).toContain(nothingInstalled);
      else expect(entry.refusal.reason).not.toContain(nothingInstalled);
    }
  });

  test('each wire failure refuses by its own tag with its own named field', () => {
    const failures = [
      new WireLost({ reason: 'the socket went away', sent: false }),
      new WireUnreadable({ detail: 'a frame nobody will read' }),
      new WireFailed({ fault: { kind: 'oversized', detail: 'past the ceiling' } }),
      new WireUnavailable({ kind: 'unreachable', reason: 'nobody home', sent: false }),
      new HostRefused({ refusal: { _tag: 'AdmissionClosed', reason: 'fenced' } }),
    ] as const;
    const refusals = failures.map(executionsRefusal);
    expect(new Set(refusals.map((refusal) => refusal.code)).size).toBe(failures.length);
    expect(refusals[2]?.reason).toContain('oversized');
    expect(refusals[4]?.reason).toContain('AdmissionClosed');
    expect(refusals[3]).toEqual(unavailabilityRefusal('unreachable', 'nobody home'));
  });
});

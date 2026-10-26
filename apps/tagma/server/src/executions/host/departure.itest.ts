import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, FileSystem, Ref, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import * as BunServices from '@effect/platform-bun/BunServices';
import { WireUnavailable } from '@runlith/executions/Executions';
import { HostLifecycle } from '@runlith/executions/HostLifecycle';
import { digestOf, identityOf } from '@runlith/executions/hostArtifacts';
import { ARTIFACT_FILE, ArtifactManifest, type ArtifactPart, REQUIRED_ROLES } from '@runlith/executions/protocol/artifact';
import { InstallationId } from '@runlith/executions/protocol/execution';
import type { RuntimeStatus } from '@runlith/executions/protocol/runtime';
import { fixtureRoot } from '../../platform/testing/roots.js';
import type { StateClaim } from './boot.js';
import { prepareChange } from './departure.js';
import { hostBundleNext, hostCandidateRestart } from './offer.js';

const root = fixtureRoot('host-departure', '');
afterAll(() => rmSync(root, { recursive: true, force: true }));

const RESTART = 'restart-1';
const INSTALLATION = InstallationId.make('departure');
const absent = new WireUnavailable({ kind: 'absent', reason: 'nothing listens', sent: false });

const standing: RuntimeStatus = {
  installation: INSTALLATION,
  incarnation: 1,
  phase: 'open',
  holder: { _tag: 'Standing' },
  custody: { revision: 0, epoch: 0 },
  executions: 0,
  memory: {
    granted: { share: 0.25, machineBytes: 8_589_934_592, grantBytes: 2_147_483_648 },
    reserved: 0,
    retained: 0,
    executions: 0,
    ceiling: 64,
  },
};

const withCandidate = (name: string): string => {
  const state = join(root, name);
  const next = hostBundleNext(state);
  mkdirSync(next, { recursive: true });
  const parts: ArtifactPart[] = REQUIRED_ROLES.map((role) => {
    const bytes = new TextEncoder().encode(role);
    writeFileSync(join(next, role), bytes);
    return { role, path: role, bytes: bytes.length, digest: digestOf(bytes) };
  });
  const declared = {
    protocol: 'executions/1' as const,
    platform: { os: process.platform, arch: process.arch },
    endpoint: { transport: 'unix', path: 'host.sock' },
    wire: { min: 1, max: 1 },
    parts,
  };
  writeFileSync(
    join(next, ARTIFACT_FILE),
    Schema.encodeSync(Schema.fromJsonString(ArtifactManifest))({ identity: { digest: identityOf(declared), build: name }, ...declared }),
  );
  writeFileSync(hostCandidateRestart(state), RESTART);
  return state;
};

const unused = Effect.die('not reached by the handover');

const handing = Effect.fnUntraced(function* (name: string) {
  const files = yield* FileSystem.FileSystem;
  const state = withCandidate(name);
  const answering = yield* Ref.make(false);
  const claim = yield* Ref.make<StateClaim>({ _tag: 'Held', holders: [1] });
  const asked = yield* Deferred.make<void>();
  const executions = HostLifecycle.of({
    status: () =>
      Effect.andThen(
        Deferred.succeed(asked, undefined),
        Effect.flatMap(Ref.get(answering), (up) => (up ? Effect.succeed(standing) : Effect.fail(absent))),
      ),
    prepare: (operation) => Effect.succeed({ _tag: 'Prepared', operation, checkpoints: 0, unquiet: 0 }),
    capabilities: () => unused,
    served: () => unused,
    generation: () => unused,
    quiesce: () => unused,
    resume: () => unused,
    yield: () => unused,
    shutdown: () => unused,
    pace: () => unused,
    disown: () => unused,
    endProcess: () => unused,
    endResidual: () => unused,
  });
  const preparing = yield* Effect.forkChild(
    prepareChange(
      executions,
      Effect.succeed({ _tag: 'Held', custody: standing.custody }),
      files,
      state,
      INSTALLATION,
      Ref.get(claim),
      RESTART,
    ),
  );
  yield* Deferred.await(asked);
  return { preparing, answering, claim };
});

layer(BunServices.layer)('handing the host over to a successor', (it) => {
  it.effect('a host that answers its status ten minutes later is still prepared for its successor', () =>
    Effect.gen(function* () {
      const { preparing, answering } = yield* handing('slow');
      yield* TestClock.adjust('10 minutes');
      yield* Ref.set(answering, true);
      yield* TestClock.adjust('100 millis');
      expect(yield* Fiber.join(preparing)).toBe(true);
    }),
  );

  it.effect('a holder that lets go of the state while its logic is silent leaves nothing to hand over', () =>
    Effect.gen(function* () {
      const { preparing, claim } = yield* handing('let-go');
      yield* TestClock.adjust('5 minutes');
      yield* Ref.set(claim, { _tag: 'Free' });
      yield* TestClock.adjust('1 second');
      expect(yield* Fiber.join(preparing)).toBe(false);
    }),
  );
});

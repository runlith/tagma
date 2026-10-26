import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, FileSystem, Layer, Result } from 'effect';
import { ExecutionClient } from '@runlith/executions/ExecutionClient';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { hostAddress } from '@runlith/executions/hostAddress';
import { InstallationId } from '@runlith/executions/protocol/execution';
import type { WireLimits } from '@runlith/executions/protocol/wire';
import { executionState } from '../../../executions/testing/doubles.js';

const limits: WireLimits = {
  frameBytes: 1024 * 64,
  headerBytes: 1024 * 16,
  connections: 4,
  requests: 16,
  subscriptions: 2,
  credits: 1024 * 64,
};

const platform = Layer.merge(HostRegistration.layer, endpointConnection).pipe(
  Layer.provideMerge(Layer.merge(BunFileSystem.layer, BunPath.layer)),
);

layer(platform, { excludeTestServices: true })('execution binding', (it) => {
  it.effect('a state directory that does not exist is still an address, and resolving one creates nothing', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const home = yield* files.makeTempDirectoryScoped({ prefix: 'terminal-binding-' });
      const state = executionState(`${home}/tagma.sqlite`, 'environment-under-test');
      const address = yield* hostAddress(state, 'environment-under-test');

      expect(address.installation).toBe(InstallationId.make('environment-under-test'));
      expect(address.state.endsWith('/executions/environment-under-test')).toBe(true);
      expect(yield* files.exists(address.state)).toBe(false);
    }),
  );

  it.effect('with no host installed the client answers absent, and asking never starts one', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const home = yield* files.makeTempDirectoryScoped({ prefix: 'terminal-binding-' });
      const address = yield* hostAddress(executionState(`${home}/tagma.sqlite`, 'environment-absent'), 'environment-absent');
      const executions = yield* ExecutionClient.make({ address, role: 'custodian', limits });
      const status = yield* Effect.result(executions.status());

      expect(Result.isFailure(status)).toBe(true);
      if (Result.isFailure(status)) {
        expect(status.failure._tag).toBe('WireUnavailable');
        if (status.failure._tag === 'WireUnavailable') expect(status.failure.kind).toBe('absent');
      }
      expect(yield* files.exists(address.state)).toBe(false);
      const listed = yield* Effect.result(executions.list({ limit: 1 }));
      expect(Result.isFailure(listed) && listed.failure._tag === 'WireUnavailable' ? listed.failure.kind : null).toBe('absent');
    }),
  );

  it.effect('a registration copied from elsewhere is mismatched, not absent', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const home = yield* files.makeTempDirectoryScoped({ prefix: 'terminal-binding-' });
      const state = `${home}/executions/environment-copy`;
      yield* files.makeDirectory(state, { recursive: true });
      yield* files.writeFileString(
        `${state}/registration.json`,
        JSON.stringify({
          version: 1,
          state: `${home}/somewhere-else`,
          installation: 'environment-copy',
          protocol: 'executions/1',
          endpoint: { transport: 'unix', path: `${state}/host.sock` },
          credentials: { custodian: 'custodian.key', recovery: 'recovery.key' },
        }),
      );
      const address = yield* hostAddress(state, 'environment-copy');
      const executions = yield* ExecutionClient.make({ address, role: 'custodian', limits });
      const status = yield* Effect.result(executions.status());
      const kind = Result.isFailure(status) && status.failure._tag === 'WireUnavailable' ? status.failure.kind : null;

      expect(kind).toBe('mismatched');
    }),
  );

  it.effect('a registration whose owner does not answer is unreachable, not absent', () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const home = yield* files.makeTempDirectoryScoped({ prefix: 'terminal-binding-' });
      const state = `${home}/executions/environment-silent`;
      yield* files.makeDirectory(state, { recursive: true });
      const canonical = yield* files.realPath(state);
      yield* files.writeFileString(
        `${canonical}/registration.json`,
        JSON.stringify({
          version: 1,
          state: canonical,
          installation: 'environment-silent',
          protocol: 'executions/1',
          endpoint: { transport: 'unix', path: `${canonical}/host.sock` },
          credentials: { custodian: 'custodian.key', recovery: 'recovery.key' },
        }),
      );
      const address = yield* hostAddress(state, 'environment-silent');
      const executions = yield* ExecutionClient.make({ address, role: 'custodian', limits });
      const status = yield* Effect.result(executions.status());
      const kind = Result.isFailure(status) && status.failure._tag === 'WireUnavailable' ? status.failure.kind : null;

      expect(kind).not.toBe('absent');
      expect(kind).not.toBeNull();
    }),
  );
});

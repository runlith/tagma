import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer, Schema, Stream } from 'effect';
import { TerminalRecord } from '../../executions/contract/wire/terminals.js';
import { TerminalOperationState } from '../../executions/contract/wire/requestKeys.js';
import { StopReceipt } from '@runlith/executions/protocol/stop';
import { existsSync, writeFileSync } from 'node:fs';
import { UserEnvironment } from '../../installation/contract/service/userEnvironment.js';
import { makeUserEnvironment } from '../../installation/process/userEnvironment.js';
import { installedHarnessesLayer } from '../birth/installed.js';
import { makeHarnessAdapters } from '../adapters.js';
import { claudeCode } from '@runlith/adapter-anthropic/harness';
import { gemini } from '@runlith/adapter-google/harness';
import { HarnessAdapters } from '../contract/service/adapters.js';
import { AccountCli } from '../../providers/contract/service/cli.js';
import { Terminals, TerminalRequests } from '../../executions/contract/service/terminals.js';
import { HostManagement } from '../../executions/contract/service/host.js';
import { TerminalEndings } from '../../executions/contract/service/endings.js';
import { accountCliLayer } from './cli.js';
import { InstalledHarnesses } from '../../threads/contract/service/harness.js';
import { Projects } from '../../projects/contract/service/registry.js';

const harnessAdaptersLayer = Layer.effect(
  HarnessAdapters,
  Effect.tap(makeHarnessAdapters, (adapters) => adapters.declared([claudeCode, gemini])),
);

const unused = () => Effect.die('headless account commands do not use the terminal host');
const terminals = Layer.succeed(
  Terminals,
  Terminals.of({
    start: unused,
    target: unused,
    record: unused,
    recordsOf: unused,
    shell: unused,
    state: unused,
    wait: unused,
    signal: unused,
    stop: unused,
    stopAsked: unused,
    lost: unused,
    inventory: unused,
  }),
);
const host = Layer.succeed(
  HostManagement,
  HostManagement.of({
    standing: unused(),
    get connection(): never {
      throw new Error('headless account commands do not connect to the terminal host');
    },
    successor: unused(),
  }),
);
const endings = Layer.succeed(TerminalEndings, TerminalEndings.of({ decided: unused, watch: unused, resume: unused, attend: unused }));
const requests = Layer.succeed(TerminalRequests, TerminalRequests.of({ request: unused, requestFor: unused, retention: unused }));
const installs = Layer.succeed(
  InstalledHarnesses,
  InstalledHarnesses.of({
    read: Effect.succeed([]),
    settled: Effect.succeed([]),
    refresh: Effect.succeed([]),
    program: () => Effect.succeed(null),
    locate: () => Effect.succeed(null),
    changes: Stream.empty,
  }),
);
const projects = Layer.succeed(
  Projects,
  Projects.of({
    list: unused,
    byId: unused,
    named: unused,
    resolve: unused,
    global: unused,
    removed: unused,
    register: unused,
    setRoot: unused,
    rename: unused,
    remove: unused,
    forget: unused,
    registryVersion: unused(),
  }),
);
const fixture = Layer.merge(
  BunFileSystem.layer,
  accountCliLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        terminals,
        host,
        endings,
        requests,
        installs,
        projects,
        harnessAdaptersLayer,
        BunFileSystem.layer,
        Layer.succeed(UserEnvironment, makeUserEnvironment({ shell: null, env: process.env, world: null, home: null })),
      ),
    ),
  ),
);

layer(fixture, { excludeTestServices: true })('account CLI', (it) => {
  it.effect('account availability lists executable files without starting a CLI', () =>
    Effect.gen(function* () {
      const disk = yield* FileSystem.FileSystem;
      const directory = yield* disk.makeTempDirectoryScoped({ prefix: 'account-availability-' });
      const log = join(directory, 'runs.log');
      writeFileSync(join(directory, 'gemini'), `#!/bin/sh\necho ran >> '${log}'\necho '0.12.0'\n`, { mode: 0o755 });
      const users = makeUserEnvironment({ shell: null, env: { PATH: directory }, world: null, home: null });
      const actual = installedHarnessesLayer.pipe(
        Layer.provide(
          Layer.merge(
            BunFileSystem.layer,
            Layer.succeed(UserEnvironment, UserEnvironment.of({ ...users, locate: (name) => users.locate(name, []) })),
          ),
        ),
        Layer.provideMerge(harnessAdaptersLayer),
      );
      const context = yield* Layer.build(
        Layer.fresh(
          accountCliLayer.pipe(
            Layer.provide(
              Layer.mergeAll(
                terminals,
                host,
                endings,
                requests,
                actual,
                projects,
                BunFileSystem.layer,
                Layer.succeed(UserEnvironment, users),
              ),
            ),
          ),
        ),
      );
      const cli = Context.get(context, AccountCli);
      expect(yield* cli.installed('gemini')).toEqual({ _tag: 'Found' });
      expect(yield* cli.installed('codex')).toMatchObject({ _tag: 'Missing' });
      expect(existsSync(log)).toBe(false);
    }),
  );

  it.effect('CLI cancellation reads an uncertain stop before acting, and resumes only after its non-application is known', () =>
    Effect.gen(function* () {
      const record = yield* Schema.decodeUnknownEffect(TerminalRecord)({
        projectId: 5,
        execution: { installation: 'fixture', execution: 'login', incarnation: 1 },
        transport: 'pty',
        lifetime: 'held',
        targetKey: 'login',
        holder: 'operator',
        origin: 'operator',
        revision: 0,
        holdings: {},
        acceptedAt: 1,
      });
      const state = new Map<string, typeof TerminalOperationState.Type>();
      const operationId = 'account-login-cancel:fixture:login:1:0';
      const key = { projectId: 5, operationId, requester: 'operator', mutation: 'stop', targetKey: 'login', execution: record.execution };
      state.set(
        operationId,
        yield* Schema.decodeUnknownEffect(TerminalOperationState)({
          _tag: 'Uncertain',
          key,
          effect: { _tag: 'InFlight', operation: { installation: 'fixture', operation: operationId } },
        }),
      );
      let alive = true;
      const base = yield* Layer.build(Layer.mergeAll(terminals, requests));
      const fakeTerminals = Terminals.of({
        ...Context.get(base, Terminals),
        record: () => Effect.succeed(record),
        state: () => Effect.succeed(undefined),
        stop: Effect.fnUntraced(function* (_project, key, execution) {
          const receipt = yield* Schema.decodeUnknownEffect(StopReceipt)({
            execution,
            operation: { installation: execution.installation, operation: key.operationId },
            requested: 'signal',
            cause: 'explicit-stop',
            steps: [],
            nativeExit: { _tag: 'Code', code: 129 },
            cost: { _tag: 'Unmeasured', reason: 'unknown', detail: 'fixture' },
            coverage: [],
            relation: 'covered',
            confirmed: [],
            residual: [],
            unverifiable: [],
            streams: [],
            cleanup: 'complete',
            retention: 'retained',
            abandonedOutput: false,
          }).pipe(Effect.orDie);
          alive = false;
          state.set(key.operationId, { _tag: 'Settled', key, execution, stop: receipt });
          return receipt;
        }),
      });
      const fakeRequests = TerminalRequests.of({
        ...Context.get(base, TerminalRequests),
        request: (_project, operation) =>
          Effect.succeed(
            state.get(operation) ?? { _tag: 'Unknown', operation: { installation: record.execution.installation, operation } },
          ),
      });
      const built = yield* Layer.build(
        Layer.fresh(
          accountCliLayer.pipe(
            Layer.provide(
              Layer.mergeAll(
                host,
                endings,
                installs,
                projects,
                harnessAdaptersLayer,
                BunFileSystem.layer,
                Layer.succeed(UserEnvironment, makeUserEnvironment({ shell: null, env: process.env, world: null, home: null })),
                Layer.succeed(Terminals, fakeTerminals),
                Layer.succeed(TerminalRequests, fakeRequests),
              ),
            ),
          ),
        ),
      );
      const cli = Context.get(built, AccountCli);
      expect(yield* Effect.flip(cli.stop(record.execution, 5))).toMatchObject({ code: 'account-cli-failed' });
      expect(alive).toBe(true);
      state.set(operationId, yield* Schema.decodeUnknownEffect(TerminalOperationState)({ _tag: 'Settled', key }));
      yield* cli.stop(record.execution, 5);
      expect(alive).toBe(false);
    }),
  );

  it.effect('headless CLI commands apply account Set and Unset and return both streams with the exit status', () =>
    Effect.gen(function* () {
      const disk = yield* FileSystem.FileSystem;
      const home = yield* disk.makeTempDirectoryScoped({ prefix: 'account-cli-' });
      const cli = yield* AccountCli;
      const output = yield* cli.run({
        program: process.execPath,
        args: [
          '-e',
          'process.stdin.once("data",input=>{process.stdout.write(JSON.stringify({directory:process.env.ACCOUNT_DIRECTORY,path:process.env.PATH??null,renewed:input.toString()==="renew\\n"})+"\\n");process.stderr.write("status");process.stdin.on("end",()=>process.exit(7));});',
        ],
        cwd: home,
        exchange: { input: 'renew\n', complete: (line) => JSON.parse(line).renewed === true },
        entries: [
          { _tag: 'Set', name: 'ACCOUNT_DIRECTORY', value: '/account/link/' },
          { _tag: 'Unset', name: 'PATH' },
        ],
      });
      expect(JSON.parse(output.stdout)).toEqual({ directory: '/account/link/', path: null, renewed: true });
      expect(output.stderr).toBe('status');
      expect(output.code).toBe(7);
    }),
  );

  it.effect('a deadline refuses and reaps its headless child even when SIGTERM is ignored', () =>
    Effect.gen(function* () {
      const disk = yield* FileSystem.FileSystem;
      const home = yield* disk.makeTempDirectoryScoped({ prefix: 'account-cli-' });
      const cli = yield* AccountCli;
      const pidFile = join(home, 'deadline.pid');
      const script =
        'require("node:fs").writeFileSync(process.argv[1],String(process.pid));process.on("SIGTERM",()=>{});setInterval(()=>{},1000)';
      const refusal = yield* Effect.flip(
        cli.run({ program: process.execPath, args: ['-e', script, pidFile], cwd: home, entries: [], timeoutMs: 250 }),
      );
      expect(refusal.code).toBe('account-cli-failed');
      const pid = Number(yield* disk.readFileString(pidFile));
      let state: unknown;
      try {
        process.kill(pid, 0);
      } catch (cause) {
        state = cause;
      }
      expect(state).toMatchObject({ code: 'ESRCH' });
    }),
  );
});

import { Context, Effect, FileSystem, Layer } from 'effect';
import { UserEnvironment } from '../../installation/contract/service/userEnvironment.js';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { AccountCli, LoginPlaces, type AccountCommand, type ProgramState } from '../../providers/contract/service/cli.js';
import { ProgramFailed } from '../../providers/contract/service/asks.js';
import { HarnessAdapters } from '../contract/service/adapters.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { Terminals, TerminalRequests } from '../../executions/contract/service/terminals.js';
import type { StopReceipt } from '@runlith/executions/protocol/stop';
import { HostManagement } from '../../executions/contract/service/host.js';
import { TerminalEndings } from '../../executions/contract/service/endings.js';
import { principalOf } from '../../executions/terminals/principals.js';
import { targetIdentity, targetKeyOf } from '../../executions/terminals/subjectPolicy.js';
import { type HarnessProgram, InstalledHarnesses } from '../../threads/contract/service/harness.js';
import { harnessTerminals } from '../sessions/programs.js';
import { runProgram } from '../programs/run.js';

const COMMAND_MS = 60_000;

const cliFailed = (reason: string): GateRefusal =>
  new GateRefusal('account-cli-failed', reason, ['check the installed CLI and retry on this account']);

const run = Effect.fn('AccountCli.run')(function* (command: AccountCommand, program: HarnessProgram | null, scratch: string) {
  const limitMs = command.timeoutMs === undefined ? COMMAND_MS : command.timeoutMs;
  const running = runProgram(
    {
      program: command.program,
      args: command.args,
      entries: command.entries,
      cwd: command.cwd ?? scratch,
      stallMs: null,
      exchange: command.exchange,
    },
    program,
  );
  const completed =
    limitMs === null
      ? running
      : running.pipe(
          Effect.timeoutOrElse({
            duration: limitMs,
            orElse: () => Effect.fail(new ProgramFailed({ message: `The program did not answer within ${limitMs} ms.` })),
          }),
        );
  const ran = yield* completed.pipe(Effect.mapError((failure) => cliFailed(`The account CLI failed: ${failure.message}`)));
  return { stdout: ran.stdout, stderr: ran.stderr, code: ran.exit ?? -1 };
});

const makeAccountCli = Effect.gen(function* () {
  const installs = yield* InstalledHarnesses;
  const terminals = harnessTerminals(yield* Terminals, installs);
  const { standing } = yield* HostManagement;
  const endings = yield* TerminalEndings;
  const projects = yield* Projects;
  const requests = yield* TerminalRequests;
  const adapters = yield* HarnessAdapters;
  const stops = new Map<string, number>();
  const users = yield* UserEnvironment;
  const files = yield* FileSystem.FileSystem;
  const scratch = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-account-status-' }).pipe(Effect.orDie);
  const account = AccountCli.of({
    installed: (program) =>
      Effect.map(installs.read, (rows): ProgramState => {
        const row = rows.find((one) => adapters.find(one.harness)?.binary === program);
        if (row === undefined)
          return adapters.all().length === 0 ? { _tag: 'Searching' } : { _tag: 'Missing', reason: `no harness runs ${program}` };
        if (row.binary !== null) return { _tag: 'Found' };
        return row.searching ? { _tag: 'Searching' } : { _tag: 'Missing', reason: row.missing ?? `${program} was not found` };
      }),
    changes: installs.changes,
    run: (command) =>
      Effect.flatMap(command.located ? installs.locate(command.program) : installs.program(command.program), (program) =>
        program === null && command.located
          ? Effect.fail(cliFailed(`${command.program} could not be located.`))
          : run(command, program, scratch),
      ),
    ended: (execution, projectId) => Effect.asVoid(endings.decided({ projectId, execution })),
    stop: Effect.fn('AccountCli.stop')(
      function* (execution, projectId) {
        const record = yield* terminals.record(execution.execution, execution.incarnation);
        if (record === null || record.projectId !== projectId || record.execution.installation !== execution.installation)
          return yield* cliFailed('The CLI login terminal could not be found in its project; its cancellation is not confirmed.');
        const named = `account-login-cancel:${execution.installation}:${execution.execution}:${execution.incarnation}`;
        let pass = stops.get(named) ?? 0;
        for (;;) {
          const operationId = HostRequestKey.make(`${named}:${pass}`);
          const previous = yield* requests.request(projectId, operationId);
          if (previous._tag === 'Settled') {
            if (previous.stop !== undefined && stopped(previous.stop)) {
              stops.delete(named);
              return;
            }
            stops.set(named, ++pass);
            continue;
          }
          const state = yield* terminals.state(execution);
          if (state?.state.nativeExit !== undefined && state.state.cleanup === 'complete') {
            stops.delete(named);
            return;
          }
          if (previous._tag !== 'Unknown')
            return yield* cliFailed(
              `The CLI login cancellation is ${previous._tag}; read terminal operation ${operationId} before another stop.`,
            );
          const receipt = yield* terminals.stop(
            projectId,
            {
              projectId,
              operationId,
              requester: principalOf({ _tag: 'Operator' }),
              mutation: 'stop',
              targetKey: record.targetKey,
              execution,
            },
            execution,
            record.revision,
            'explicit-stop',
            'signal',
          );
          if (!stopped(receipt))
            return yield* cliFailed(
              'The CLI login terminal cancellation left residual or unmeasured resources; read the terminal before retrying.',
            );
          stops.delete(named);
          return;
        }
      },
      Effect.mapError((cause) => (cause instanceof GateRefusal ? cause : cliFailed(String(cause)))),
    ),
    login: Effect.fn('AccountCli.login')(
      function* (command, projectId) {
        const actor = { _tag: 'Operator' } as const;
        const principal = principalOf(actor);
        const cwd = command.cwd ?? (yield* projects.byId(projectId)).rootPath;
        const target = yield* terminals.target({ projectId, kind: 'host', cwd });
        const start = yield* terminals.start({
          actor,
          operationId: HostRequestKey.make(`account-login:${crypto.randomUUID()}`),
          target,
          targetKey: targetKeyOf(targetIdentity(target, principal, principal)),
          program: command.program,
          args: command.args,
          transport: 'pty',
          lifetime: 'held',
          geometry: (yield* standing).geometry,
          purpose: 'command',
          environment: { inherit: true, entries: command.entries },
        });
        if (start._tag === 'Uncertain')
          return yield* new GateRefusal(
            'account-cli-uncertain',
            `The login terminal start is uncertain; read operation ${start.operation.operation}.`,
            ['read the terminal operation before starting another login'],
          );
        if (start._tag !== 'Started') return yield* cliFailed(`The login terminal start answered ${start._tag}.`);
        return start.record.execution;
      },
      Effect.scoped,
      Effect.mapError((cause) => (cause instanceof GateRefusal ? cause : cliFailed(String(cause)))),
    ),
  });
  return Context.make(AccountCli, account).pipe(
    Context.add(LoginPlaces, {
      retain: users.retain,
      now: Effect.map(users.now, (paths) => ({ variables: paths.variables ?? {}, reading: paths.reading })),
      ready: Effect.map(users.ready, (paths) => ({ variables: paths.variables ?? {}, reading: paths.reading })),
    }),
  );
});

const stopped = (receipt: StopReceipt): boolean =>
  receipt.nativeExit !== undefined && receipt.cleanup === 'complete' && receipt.residual.length === 0 && receipt.unverifiable.length === 0;

export const accountCliLayer = Layer.effectContext(makeAccountCli);

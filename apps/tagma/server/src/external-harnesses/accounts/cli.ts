import { homedir } from 'node:os';
import { Effect, Layer } from 'effect';
import { resolveEnvironment } from '@runlith/executions/CommandEnvironment';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { AccountCli, type AccountCommand, type ProgramState } from '../../providers/contract/service/cli.js';
import { harnessAdapter } from '../contract/service/table.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { Terminals, TerminalRequests } from '../../executions/contract/service/terminals.js';
import type { StopReceipt } from '@runlith/executions/protocol/stop';
import { HostManagement } from '../../executions/contract/service/host.js';
import { TerminalEndings } from '../../executions/contract/service/endings.js';
import { principalOf } from '../../executions/terminals/principals.js';
import { targetIdentity, targetKeyOf } from '../../executions/terminals/subjectPolicy.js';
import { type HarnessProgram, InstalledHarnesses } from '../../threads/contract/service/harness.js';
import { harnessTerminals, programEnvironment } from '../sessions/programs.js';

const OUTPUT_BYTES = 1024 * 1024;
const COMMAND_MS = 60_000;

const cliFailed = (reason: string): GateRefusal =>
  new GateRefusal('account-cli-failed', reason, ['check the installed CLI and retry on this account']);

const outputText = async (stream: ReadableStream<Uint8Array>, onLine?: (line: string) => void): Promise<string> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  let scanned = 0;
  let searchFrom = 0;
  try {
    for (;;) {
      const read = await reader.read();
      if (read.done) return text + decoder.decode();
      bytes += read.value.byteLength;
      if (bytes > OUTPUT_BYTES) throw cliFailed('The account CLI output exceeds its one-megabyte response envelope.');
      text += decoder.decode(read.value, { stream: true });
      if (onLine !== undefined) {
        for (let end = text.indexOf('\n', searchFrom); end !== -1; end = text.indexOf('\n', scanned)) {
          onLine(text.slice(scanned, end));
          scanned = end + 1;
        }
        searchFrom = text.length;
      }
    }
  } finally {
    reader.releaseLock();
  }
};

const run = Effect.fn('AccountCli.run')(function* (command: AccountCommand, program: HarnessProgram | null) {
  const bound = new Map(Object.entries(process.env).flatMap(([name, value]) => (value === undefined ? [] : [[name, value] as const])));
  const request = { inherit: true, entries: command.entries };
  const environment = Object.fromEntries(
    resolveEnvironment(bound, program === null ? request : programEnvironment(program, request)).map(({ name, value }) => [name, value]),
  );
  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        Bun.spawn([program?.path ?? command.program, ...command.args], {
          cwd: command.cwd ?? homedir(),
          env: environment,
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        }),
      catch: (cause) => cliFailed(`The account CLI could not start: ${String(cause)}`),
    }),
    (child) =>
      Effect.promise(async () => {
        if (child.exitCode === null) child.kill('SIGKILL');
        await child.exited;
      }),
  );
  return yield* Effect.tryPromise({
    try: async () => {
      let completed = command.exchange === undefined;
      const onLine = (line: string) => {
        if (!completed && command.exchange!.complete(line)) {
          completed = true;
          child.stdin.end();
        }
      };
      if (command.exchange === undefined) child.stdin.end();
      else child.stdin.write(command.exchange.input);
      const [stdout, stderr, code] = await Promise.all([
        outputText(child.stdout, command.exchange === undefined ? undefined : onLine),
        outputText(child.stderr),
        child.exited,
      ]);
      if (!completed) throw cliFailed('The account CLI ended before completing its exchange.');
      return { stdout, stderr, code };
    },
    catch: (cause) => (cause instanceof GateRefusal ? cause : cliFailed(`The account CLI response could not be read: ${String(cause)}`)),
  }).pipe(
    Effect.timeoutOrElse({
      duration: command.timeoutMs ?? COMMAND_MS,
      orElse: () => Effect.fail(cliFailed('The account CLI did not answer before its deadline.')),
    }),
  );
}, Effect.scoped);

const makeAccountCli = Effect.gen(function* () {
  const installs = yield* InstalledHarnesses;
  const terminals = harnessTerminals(yield* Terminals, installs);
  const { standing } = yield* HostManagement;
  const endings = yield* TerminalEndings;
  const projects = yield* Projects;
  const requests = yield* TerminalRequests;
  const stops = new Map<string, number>();
  return AccountCli.of({
    installed: (program) =>
      Effect.map(installs.read, (rows): ProgramState => {
        const row = rows.find((one) => harnessAdapter(one.harness).binary === program);
        if (row === undefined) return { _tag: 'Missing', reason: `no harness runs ${program}` };
        if (row.binary !== null) return { _tag: 'Found' };
        return row.searching ? { _tag: 'Searching' } : { _tag: 'Missing', reason: row.missing ?? `${program} was not found` };
      }),
    changes: installs.changes,
    run: (command) => Effect.flatMap(installs.program(command.program), (program) => run(command, program)),
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
});

const stopped = (receipt: StopReceipt): boolean =>
  receipt.nativeExit !== undefined && receipt.cleanup === 'complete' && receipt.residual.length === 0 && receipt.unverifiable.length === 0;

export const accountCliLayer = Layer.effect(AccountCli, makeAccountCli);

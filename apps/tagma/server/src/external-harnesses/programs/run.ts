import { Data, Effect } from 'effect';
import { resolveEnvironment } from '@runlith/executions/CommandEnvironment';
import type { EnvironmentEntry } from '@runlith/executions/protocol/execution';
import type { CommandExchange } from '@runlith/tagma/adapter/provider';
import type { HarnessProgram } from '../../threads/contract/service/harness.js';
import { programEnvironment } from '../sessions/programs.js';

const OUTPUT_BYTES = 1024 * 1024;

export class ProgramFailed extends Data.TaggedError('ProgramFailed')<{ readonly message: string }> {}

export type ProgramCommand = {
  readonly program: string;
  readonly args: readonly string[];
  readonly entries: readonly EnvironmentEntry[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly exchange?: CommandExchange;
  readonly input?: string;
};

export type ProgramRan = { readonly stdout: string; readonly stderr: string; readonly exit: number | null };

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
      if (bytes > OUTPUT_BYTES) throw new ProgramFailed({ message: 'The program output exceeds its one-megabyte envelope.' });
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

export const runProgram = Effect.fnUntraced(function* (command: ProgramCommand, program: HarnessProgram | null) {
  const bound = new Map(Object.entries(process.env).flatMap(([name, value]) => (value === undefined ? [] : [[name, value] as const])));
  const request = { inherit: true, entries: command.entries };
  const environment = Object.fromEntries(
    resolveEnvironment(bound, program === null ? request : programEnvironment(program, request)).map(({ name, value }) => [name, value]),
  );
  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        Bun.spawn([program?.path ?? command.program, ...command.args], {
          cwd: command.cwd,
          env: environment,
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        }),
      catch: (cause) => new ProgramFailed({ message: `The program could not start: ${String(cause)}` }),
    }),
    (child) =>
      Effect.promise(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await child.exited;
      }),
  );
  return yield* Effect.tryPromise({
    try: async (): Promise<ProgramRan> => {
      let completed = command.exchange === undefined;
      const onLine = (line: string) => {
        if (!completed && command.exchange!.complete(line)) {
          completed = true;
          void child.stdin.end();
        }
      };
      let unwritten: unknown = null;
      const written = (async () => {
        if (command.exchange !== undefined) {
          child.stdin.write(command.exchange.input);
          await child.stdin.flush();
          return;
        }
        if (command.input !== undefined) child.stdin.write(command.input);
        await child.stdin.end();
      })().catch((cause: unknown) => {
        unwritten = cause;
      });
      const [stdout, stderr] = await Promise.all([
        outputText(child.stdout, command.exchange === undefined ? undefined : onLine),
        outputText(child.stderr),
        child.exited,
        written,
      ]);
      if (!completed) throw new ProgramFailed({ message: 'The program ended before completing its exchange.' });
      if (unwritten !== null && child.exitCode === 0)
        throw new ProgramFailed({ message: `The program ended without reading its input: ${String(unwritten)}` });
      return { stdout, stderr, exit: child.exitCode };
    },
    catch: (cause) =>
      cause instanceof ProgramFailed ? cause : new ProgramFailed({ message: `The program output could not be read: ${String(cause)}` }),
  }).pipe(
    Effect.timeoutOrElse({
      duration: command.timeoutMs,
      orElse: () => Effect.fail(new ProgramFailed({ message: `The program did not answer within ${command.timeoutMs} ms.` })),
    }),
  );
}, Effect.scoped);

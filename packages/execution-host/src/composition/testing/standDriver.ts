import { Effect, Schema } from 'effect';
import type { CommandAdmission } from '@runlith/executions/protocol/command';
import { Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionRef, NativeExit } from '@runlith/executions/protocol/execution';
import type { InputRequest } from '@runlith/executions/protocol/input';
import type { LaunchRequest, LaunchTransport } from '@runlith/executions/protocol/launch';
import { byteOffset, offsetValue } from '@runlith/executions/protocol/record';
import type { BindingScope } from '@runlith/executions/protocol/wire';
import type { Stand } from './bundled';

export type Program = { readonly program: string; readonly args: ReadonlyArray<string> };
export type Started = { readonly ref: ExecutionRef; readonly pid: number };

const principal = Schema.decodeUnknownSync(Principal)('stand-reader');
const ENVIRONMENT = [
  { name: 'PATH', value: '/usr/bin:/bin' },
  { name: 'TERM', value: 'xterm-256color' },
];

export const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);
export const sleep = (ms: number) => new Promise((resume) => setTimeout(resume, ms));
export const perl = (script: string): Program => ({ program: '/usr/bin/perl', args: ['-e', `$|=1; alarm 50; ${script}`] });

export const until = async <A>(_what: string, probe: () => Promise<A | undefined>): Promise<A> => {
  for (;;) {
    const found = await probe();
    if (found !== undefined) return found;
    await sleep(20);
  }
};

export const driving = (stand: Stand) => {
  const lanes = new Map<string, { readonly scope: BindingScope; next: number }>();

  const launched = (command: Program, transport: LaunchTransport) => ({
    command: { program: command.program, args: [...command.args], environment: ENVIRONMENT, cwd: stand.directory },
    transport,
    purpose: 'command' as const,
    target: { environment: 'stand', namespace: 'stand', cwd: stand.directory, dependencies: [] },
    holder: principal,
    origin: principal,
  });

  const start = async (
    transport: LaunchTransport,
    command: Program,
    lifetime: 'held' | 'call' = 'held',
    timeoutMs?: number,
    paced?: true,
  ) => {
    const request: LaunchRequest = {
      ...launched(command, transport),
      lifetime,
      budget: timeoutMs === undefined ? undefined : { timeoutMs },
      paced,
    };
    const answer = await run(stand.client.start(stand.operation(), request));
    if (answer._tag !== 'Started' || answer.native.pid === undefined) {
      throw new Error(`the stand refused a child: ${JSON.stringify(answer)}`);
    }
    return { ref: answer.execution, pid: answer.native.pid } satisfies Started;
  };

  const command = async (program: Program, admission: CommandAdmission) => {
    const answer = await run(
      stand.client.start(stand.operation(), { ...launched(program, { _tag: 'pipes', stdin: 'ignore' }), lifetime: 'command', admission }),
    );
    if (answer._tag !== 'Accepted' || answer.execution === undefined)
      throw new Error(`the stand refused a command: ${JSON.stringify(answer)}`);
    return answer.execution;
  };

  const recorded = async (ref: ExecutionRef, stream: 'stdout' | 'stderr' | 'pty') => {
    const chunks: Uint8Array[] = [];
    let offset = 0n;
    for (;;) {
      const read = await run(stand.client.read({ ref, stream, offset: byteOffset(offset) }, 64 * 1024));
      if (read.range.gap) throw new Error(`the record of ${ref.execution} has a gap at ${offset}`);
      if (read.bytes.length === 0) break;
      chunks.push(read.bytes);
      offset = offsetValue(read.range.next);
    }
    return Buffer.concat(chunks);
  };

  const acted = async (ref: ExecutionRef, act: InputRequest['act'], cause: InputRequest['cause']) => {
    let lane = lanes.get(ref.execution);
    if (lane === undefined) {
      const opened = await run(stand.client.openBinding(principal, ref));
      if (opened._tag !== 'Bound') throw new Error(`no binding: ${opened._tag}`);
      lane = { scope: { binding: opened.binding, principal }, next: 0 };
      lanes.set(ref.execution, lane);
    }
    const answer = await run(stand.client.input(ref, lane.scope, { sequence: lane.next++, cause, act }));
    if (answer._tag !== 'InputAdmitted') throw new Error(`input refused: ${JSON.stringify(answer)}`);
  };

  const typed = async (ref: ExecutionRef, text: string | Uint8Array, chunk = 32 * 1024) => {
    const bytes = typeof text === 'string' ? Buffer.from(text) : text;
    for (let at = 0; at < bytes.length; at += chunk) await acted(ref, { _tag: 'Write', bytes: bytes.subarray(at, at + chunk) }, 'raw');
  };

  const showing = async (ref: ExecutionRef, text: string) =>
    until(`${JSON.stringify(text)} in the record of ${ref.execution}`, async () =>
      (await recorded(ref, 'pty')).toString('latin1').includes(text) ? true : undefined,
    );

  const exitOf = async (ref: ExecutionRef): Promise<NativeExit | undefined> =>
    until(`the end of ${ref.execution}`, async () => {
      const state = await run(stand.client.state(ref));
      return state?.state.phase === 'ended' ? { exit: state.state.nativeExit } : undefined;
    }).then((ended) => ended.exit);

  const pidOf = async (ref: ExecutionRef) => (await run(stand.client.state(ref)))?.native.pid;

  return { start, command, recorded, acted, typed, showing, exitOf, pidOf, forgetLanes: () => lanes.clear() };
};

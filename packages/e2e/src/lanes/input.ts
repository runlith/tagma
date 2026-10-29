import { holding } from '@runlith/testbed/fixture';
import { Effect, Option, Schema } from 'effect';
import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { attempted, command, decode, SimulatorUnavailable, type Device } from './device.ts';
import { nativeTouch, type NativeTouch } from './hid.ts';
import type { Point } from './ios.ts';
import type { Tools } from './iosTools.ts';

export type Input = {
  readonly run: (...args: string[]) => Promise<string>;
  readonly quiet: (pid: number) => Promise<void>;
  readonly diagnostics: () => string;
  readonly touch: NativeTouch;
};
const Verdict = Schema.fromJsonString(
  Schema.Struct({ retry: Schema.Literals(['safe', 'safe_after_reread', 'unsafe']), retry_reason: Schema.String }),
);
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
};
export const input = Effect.fn('e2e.iosInput')(function* (device: Device, tools: Tools) {
  let stderr = '';
  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const stop = holding();
        try {
          const child = spawn(
            tools.companion,
            ['--udid', device.udid, '--only', 'simulator', '--device-set-path', device.set, '--grpc-port', '0'],
            { stdio: ['ignore', 'pipe', 'pipe'] },
          );
          child.stderr.on('data', (data: Buffer) => {
            stderr = (stderr + data.toString()).slice(-65536);
          });
          return child;
        } finally {
          stop();
        }
      },
      catch: (cause) => new SimulatorUnavailable({ message: `the pinned iOS input driver ${tools.companion} could not start`, cause }),
    }),
    (child) =>
      attempted(
        'the iOS input driver did not close',
        () =>
          new Promise<void>((resolve, reject) => {
            if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
              resolve();
              return;
            }
            child.once('error', reject);
            child.once('exit', () => resolve());
            child.kill('SIGTERM');
          }),
      ).pipe(Effect.orDie),
  );
  const port = yield* attempted(
    'the iOS input driver opened no gRPC port',
    () =>
      new Promise<number>((resolve, reject) => {
        const lines = createInterface({ input: child.stdout });
        child.once('error', reject);
        lines.on('line', (line) => {
          if (!line.startsWith('{')) return;
          try {
            resolve(decode(Schema.Struct({ grpc_port: Schema.Number }), JSON.parse(line)).grpc_port);
          } catch (cause) {
            reject(cause);
          }
        });
        lines.once('close', () => reject(new Error(stderr)));
      }),
  );
  const answered = (pid: number) =>
    new Promise<boolean>((resolve, reject) => {
      const args = [
        '--companion',
        `localhost:${port}`,
        '--retry-verdict',
        'ui',
        'quiet',
        '0',
        '--pid',
        String(pid),
        '--json',
        '--udid',
        device.udid,
      ];
      execFile(tools.client, args, { encoding: 'utf8' }, (cause, out, err) => {
        try {
          const verdict = cause === null ? undefined : Schema.decodeUnknownOption(Verdict)(err.trim().split('\n').at(-1));
          if (verdict === undefined) resolve(true);
          else if (Option.isSome(verdict) && verdict.value.retry === 'safe' && alive(pid)) resolve(false);
          else
            reject(
              new SimulatorUnavailable({
                message: `the native interface of pid ${pid} did not go quiet\n${err.trim()}\n${out.trim()}`,
                cause,
              }),
            );
        } catch (failure) {
          reject(failure);
        }
      });
    });
  const control: Input = {
    run: (...args) => command(tools.client, ['--companion', `localhost:${port}`, ...args, '--udid', device.udid]),
    quiet: async (pid) => {
      while (!(await answered(pid))) console.info(`iOS: pid ${pid} has not answered accessibility yet`);
    },
    diagnostics: () => stderr,
    touch: yield* nativeTouch({ tools, port }),
  };
  return control;
});
export const tap = async (control: Input, point: Point): Promise<void> => {
  await control.run('ui', 'tap', String(Math.round(point.x)), String(Math.round(point.y)));
};

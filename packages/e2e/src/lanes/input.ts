import { holding } from '@runlith/testbed/fixture';
import { Effect, Schema } from 'effect';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { attempted, decode, SimulatorUnavailable, type Device } from './device.ts';
import { nativeInput, type NativeInput } from './hid.ts';
import type { Tools } from './iosTools.ts';

export type Input = NativeInput & {
  readonly quiet: (pid: number) => Promise<void>;
  readonly diagnostics: () => string;
};
export const input = Effect.fn('e2e.iosInput')(function* (device: Device, tools: Tools) {
  let stderr = '';
  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const stop = holding();
        try {
          const child = spawn(
            '/usr/sbin/taskpolicy',
            [
              '-l',
              '0',
              '-t',
              '0',
              tools.companion,
              '--udid',
              device.udid,
              '--only',
              'simulator',
              '--device-set-path',
              device.set,
              '--grpc-port',
              '0',
            ],
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
  const native = yield* nativeInput({ tools, port }).pipe(
    Effect.mapError((cause) => new SimulatorUnavailable({ message: cause.message, cause })),
  );
  const control: Input = {
    ...native,
    quiet: async (pid) => {
      while (!(await native.quiescence(pid))) console.info(`iOS: pid ${pid} has not answered accessibility yet`);
    },
    diagnostics: () => `${stderr}\n--- input client\n${native.trace()}`,
  };
  return control;
});

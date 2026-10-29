import { holding } from '@runlith/testbed/fixture';
import { Effect, Schema } from 'effect';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { TouchFailed, type TouchPhase } from '../touch.ts';
import type { Point } from './ios.ts';
import type { Tools } from './iosTools.ts';

export type NativeTouch = (phase: TouchPhase, point: Point) => Promise<void>;
type HIDOptions = { readonly tools: Tools; readonly port: number };
type Submission = { readonly resolve: () => void; readonly reject: (cause: unknown) => void };
type Ended = { readonly failure: TouchFailed | undefined };
const Submitted = Schema.Struct({ id: Schema.Number });

class TouchStream {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly submissions = new Map<number, Submission>();
  private readonly completion: Promise<Ended>;
  private ended: Ended | undefined;
  private failure: TouchFailed | undefined;
  private stderr = '';
  private sequence = 1;

  constructor(options: HIDOptions) {
    const stop = holding();
    try {
      this.child = spawn(options.tools.python, ['-I', '-u', join(import.meta.dir, 'hid.py'), String(options.port)], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } finally {
      stop();
    }
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-65536);
    });
    this.child.on('error', (cause) => this.fail(new TouchFailed({ message: 'the native touch stream could not start', cause })));
    this.child.stdin.on('error', (cause) => this.fail(new TouchFailed({ message: 'the native touch stream rejected a sample', cause })));
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', (line) => {
      try {
        const { id } = Schema.decodeUnknownSync(Submitted)(JSON.parse(line));
        const submission = this.submissions.get(id);
        if (submission === undefined) throw new TouchFailed({ message: `the native touch stream acknowledged unknown sample ${id}` });
        this.submissions.delete(id);
        submission.resolve();
      } catch (cause) {
        this.fail(new TouchFailed({ message: 'the native touch stream returned an invalid submission receipt', cause }));
      }
    });
    this.completion = new Promise((resolve) =>
      this.child.once('close', (code, signal) => {
        if (this.failure === undefined && (code !== 0 || this.submissions.size > 0)) {
          this.failure = new TouchFailed({ message: `the native touch stream ended (${signal ?? code})\n${this.stderr}` });
        }
        this.ended = { failure: this.failure };
        for (const submission of this.submissions.values())
          submission.reject(this.failure ?? new TouchFailed({ message: 'the native touch stream ended before sample submission' }));
        this.submissions.clear();
        resolve(this.ended);
      }),
    );
  }

  private fail(cause: TouchFailed): void {
    this.failure ??= cause;
    for (const submission of this.submissions.values()) submission.reject(this.failure);
    this.submissions.clear();
    this.child.kill('SIGTERM');
  }

  async send(phase: TouchPhase, point: Point): Promise<void> {
    if (this.ended !== undefined) throw this.ended.failure ?? new TouchFailed({ message: 'the native touch stream already ended' });
    if (this.failure !== undefined) throw this.failure;
    const id = this.sequence++;
    await new Promise<void>((resolve, reject) => {
      this.submissions.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ id, phase, x: point.x, y: point.y }) + '\n');
    });
    if (phase === 'release') {
      const ended = await this.completion;
      if (ended.failure !== undefined) throw ended.failure;
    }
  }

  async stop(): Promise<void> {
    if (this.ended === undefined) this.child.kill('SIGTERM');
    await this.completion;
  }
}

export const nativeTouch = Effect.fn('e2e.nativeTouch')(function* (options: HIDOptions) {
  let stream: TouchStream | undefined;
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      await stream?.stop();
    }),
  );
  const send: NativeTouch = async (phase, point) => {
    if (phase === 'press') {
      if (stream !== undefined) throw new TouchFailed({ message: 'the native touch stream already holds a finger' });
      stream = new TouchStream(options);
    }
    if (stream === undefined) throw new TouchFailed({ message: 'the native touch stream has no pressed finger' });
    await stream.send(phase, point);
    if (phase === 'release') stream = undefined;
  };
  return send;
});

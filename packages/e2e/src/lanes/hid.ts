import { holding } from '@runlith/testbed/fixture';
import { Effect, Schema } from 'effect';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { TouchFailed, type TouchPhase } from '../touch.ts';
import type { Device } from './device.ts';
import type { Point, Swipe } from './ios.ts';
import type { Tools } from './iosTools.ts';

export type NativeTouch = (phase: TouchPhase, point: Point) => Promise<void>;
export type NativeSwipe = (gesture: Swipe, pressed: () => Promise<void>) => Promise<void>;
export type NativeInput = {
  readonly touch: NativeTouch;
  readonly swipe: NativeSwipe;
  readonly tap: (point: Point) => Promise<void>;
  readonly launch: (bundle: string) => Promise<number>;
  readonly quiescence: (pid: number) => Promise<boolean>;
  readonly trace: () => string;
};
type Contact = { readonly phase: TouchPhase; readonly x: number; readonly y: number };
type Gesture = { readonly phase: 'swipe'; readonly to: Point; readonly duration: number; readonly delta: number };
type Command =
  | Contact
  | Gesture
  | { readonly phase: 'tap'; readonly x: number; readonly y: number }
  | { readonly phase: 'launch'; readonly bundle: string }
  | { readonly phase: 'quiet'; readonly pid: number };
type ClientOptions = { readonly tools: Tools; readonly port: number; readonly device: Device };
type Submission = { readonly resolve: (value: unknown) => void; readonly reject: (cause: unknown) => void };
type Ended = { readonly failure: TouchFailed | undefined };
const Submitted = Schema.Struct({ id: Schema.Number, value: Schema.Unknown });
const PID = Schema.Int.check(Schema.isGreaterThan(0));
const Quiet = Schema.Union([
  Schema.Struct({ state: Schema.Literal('quiet') }),
  Schema.Struct({ retry: Schema.Literals(['safe', 'safe_after_reread', 'unsafe']), reason: Schema.String, message: Schema.String }),
]);
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
};

class InputClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly submissions = new Map<number, Submission>();
  private readonly completion: Promise<Ended>;
  private ended: Ended | undefined;
  private failure: TouchFailed | undefined;
  private stderr = '';
  private sequence = 1;

  constructor(
    private readonly name: string,
    file: string,
    args: readonly string[],
  ) {
    const stop = holding();
    try {
      this.child = spawn(file, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    } finally {
      stop();
    }
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-65536);
    });
    this.child.on('error', (cause) => this.fail(new TouchFailed({ message: `the ${name} could not start`, cause })));
    this.child.stdin.on('error', (cause) => this.fail(new TouchFailed({ message: `the ${name} rejected a command`, cause })));
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', (line) => {
      try {
        const { id, value } = Schema.decodeUnknownSync(Submitted)(JSON.parse(line));
        const submission = this.submissions.get(id);
        if (submission === undefined) throw new TouchFailed({ message: `the ${name} acknowledged unknown command ${id}` });
        this.submissions.delete(id);
        submission.resolve(value);
      } catch (cause) {
        this.fail(new TouchFailed({ message: `the ${name} returned an invalid command receipt`, cause }));
      }
    });
    this.completion = new Promise((resolve) =>
      this.child.once('close', (code, signal) => {
        if (this.failure === undefined && (code !== 0 || this.submissions.size > 0)) {
          this.failure = new TouchFailed({ message: `the ${name} ended (${signal ?? code})\n${this.stderr}` });
        }
        this.ended = { failure: this.failure };
        for (const submission of this.submissions.values())
          submission.reject(this.failure ?? new TouchFailed({ message: `the ${name} ended before command completion` }));
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

  async send(command: Command): Promise<unknown> {
    if (this.ended !== undefined) throw this.ended.failure ?? new TouchFailed({ message: `the ${this.name} already ended` });
    if (this.failure !== undefined) throw this.failure;
    const id = this.sequence++;
    return new Promise<unknown>((resolve, reject) => {
      this.submissions.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ id, ...command }) + '\n');
    });
  }

  trace(): string {
    return this.stderr;
  }

  async stop(): Promise<void> {
    if (this.ended === undefined) this.child.kill('SIGTERM');
    await this.completion;
  }
}

const started = (name: string, file: string, args: readonly string[]) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => new InputClient(name, file, args),
      catch: (cause) => new TouchFailed({ message: `the ${name} could not start`, cause }),
    }),
    (client) => Effect.promise(() => client.stop()),
  );

export const nativeInput = Effect.fn('e2e.nativeTouch')(function* ({ tools, port, device }: ClientOptions) {
  const companion = yield* started('native input client', tools.python, ['-I', '-u', join(import.meta.dir, 'hid.py'), String(port)]);
  const digitizer = yield* started('digitizer', tools.digitizer, [device.set, device.udid]);
  let isPressed = false;
  const input: NativeInput = {
    touch: async (phase, point) => {
      if (phase === 'press') {
        if (isPressed) throw new TouchFailed({ message: 'the native touch stream already holds a finger' });
        isPressed = true;
      }
      if (!isPressed) throw new TouchFailed({ message: 'the native touch stream has no pressed finger' });
      await digitizer.send({ phase, x: point.x, y: point.y });
      if (phase === 'release') isPressed = false;
    },
    swipe: async ({ from, to, duration = 0.15, delta = 5 }, pressed) => {
      if (isPressed) throw new TouchFailed({ message: 'the native touch stream already holds a finger' });
      isPressed = true;
      await digitizer.send({ phase: 'press', x: from.x, y: from.y });
      await pressed();
      await digitizer.send({ phase: 'swipe', to, duration, delta });
      isPressed = false;
    },
    tap: async (point) => {
      await companion.send({ phase: 'tap', x: Math.round(point.x), y: Math.round(point.y) });
    },
    launch: async (bundle) => Schema.decodeUnknownSync(PID)(await companion.send({ phase: 'launch', bundle })),
    quiescence: async (pid) => {
      const response = Schema.decodeUnknownSync(Quiet)(await companion.send({ phase: 'quiet', pid }));
      if ('state' in response) return true;
      if (response.retry === 'safe' && alive(pid)) return false;
      throw new TouchFailed({
        message: `the native interface of pid ${pid} did not go quiet: ${response.message} (${response.retry}: ${response.reason})`,
      });
    },
    trace: () => `${companion.trace()}\n--- digitizer\n${digitizer.trace()}`,
  };
  return input;
});

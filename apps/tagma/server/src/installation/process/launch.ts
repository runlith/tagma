import { closeSync, existsSync, mkdirSync, openSync, realpathSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { Effect, Schema } from 'effect';
import type { ProcessReader } from '@runlith/execution-host/ProcessReader';
import type { SuccessorLaunch } from '../contract/service/succession.js';
import { PROCESS_CHAIN, type ProcessChain } from '../contract/wire/process.js';
import { forkChain, inheritedChain, ProcessChainRefused } from './chain.js';
import {
  type LaunchAnswer,
  type LaunchRequest,
  type Handoff,
  type Takeover,
  handoffOf,
  handoffSchema,
  launchAnswerSchema,
  launchRequestSchema,
  CHAINED,
  HANDOFF,
  HOST_REPLACE,
  HOST_STATE,
  RELEASES,
  REPLACES,
  STANDING_BY,
  SUPERVISED,
  takeoverSchema,
} from '../contract/wire/launch.js';
import { RESTART_ID } from '../contract/wire/restart.js';
import { LaunchLifetime } from './lifetime.js';

const RETURN_DROPS = [REPLACES, HANDOFF, HOST_STATE, HOST_REPLACE, RESTART_ID] as const;

const decodeRequest = Schema.decodeUnknownSync(Schema.Union([launchRequestSchema, handoffSchema, takeoverSchema]));
const decodeAnswer = Schema.decodeUnknownSync(launchAnswerSchema);
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
type Child = Bun.Subprocess<number, number, number>;
type Attempt = {
  readonly id: string;
  readonly predecessor: Child;
  readonly child: Child;
  readonly command: string;
  readonly chain: ProcessChain | undefined;
  state: 'starting' | 'ready' | 'cancelled';
  released: boolean;
  serving: boolean;
  failed: boolean;
};

type Launched = { readonly command: readonly string[]; readonly env: NodeJS.ProcessEnv };

export class ServerLaunch {
  readonly initial: Child;
  readonly exited: Promise<number>;
  readonly startedAt = new Date().toISOString();
  private readonly children = new Set<Child>();
  private attempt: Attempt | null = null;
  private current: Child | null = null;
  private readonly launched = new Map<Child, Launched>();
  private stopping = false;
  private returning = 0;
  private starting: { readonly id: string; cancelled: boolean } | null = null;
  private hasFailed = false;
  private code = 0;
  private readonly settled: (code: number) => void;
  private readonly forwards = SIGNALS.map((signal) => [signal, () => this.stop(signal)] as const);
  private readonly lifetime = LaunchLifetime.open();

  constructor(
    command: readonly string[],
    env: NodeJS.ProcessEnv,
    private readonly log: string,
    private readonly processes: ProcessReader,
  ) {
    const ending = Promise.withResolvers<number>();
    this.exited = ending.promise;
    this.settled = ending.resolve;
    this.initial = this.spawn(command, env);
    this.current = this.initial;
    for (const [signal, forward] of this.forwards) process.on(signal, forward);
  }

  readonly stop = (signal: NodeJS.Signals = 'SIGTERM'): Promise<number> => {
    this.stopping = true;
    for (const child of this.children) child.kill(signal);
    return this.exited;
  };

  private spawn(command: readonly string[], env: NodeJS.ProcessEnv, predecessor?: number, returned = false): Child {
    mkdirSync(dirname(this.log), { recursive: true });
    const sink = openSync(this.log, 'a');
    let child: Child;
    try {
      const stamp = predecessor === undefined && !returned ? this.startedAt : new Date().toISOString();
      writeSync(
        sink,
        returned
          ? `\n=== tagma serve started ${stamp}, returned by pid ${process.pid} after its successor ended ===\n`
          : `\n=== tagma serve started ${stamp}, asked by pid ${predecessor ?? process.pid}${predecessor === undefined ? '' : ' on restart'} ===\n`,
      );
      child = Bun.spawn([...command], {
        stdin: this.lifetime.reader,
        stdout: sink,
        stderr: sink,
        env: {
          ...env,
          [SUPERVISED]: '1',
          [RELEASES]: '1',
          [CHAINED]: '1',
          ...(predecessor === undefined ? {} : { [REPLACES]: String(predecessor) }),
        },
        ipc: (message, sender) => this.received(message, sender),
        onDisconnect: () => {
          if (this.children.has(child)) child.kill('SIGTERM');
        },
      });
    } finally {
      closeSync(sink);
    }
    this.children.add(child);
    this.launched.set(child, {
      command: command.map((part) => (part.startsWith('/') && existsSync(part) ? realpathSync(part) : part)),
      env,
    });
    void child.exited.then((code) => this.ended(child, code));
    return child;
  }

  private received(message: unknown, sender: Child): void {
    if (message === STANDING_BY) {
      const attempt = this.attempt;
      if (attempt === null || attempt.child !== sender || attempt.state !== 'starting' || this.stopping) return;
      attempt.state = 'ready';
      this.current = sender;
      this.answer(attempt.predecessor, { _tag: 'Started', id: attempt.id });
      return;
    }
    let request: LaunchRequest | Handoff | Takeover;
    try {
      request = decodeRequest(message);
    } catch (cause) {
      this.fail(`the server launch received an invalid message: ${String(cause)}`);
      return;
    }
    if (request._tag === 'Taken' || request._tag === 'Serving') {
      const attempt = this.attempt;
      if (attempt === null || attempt.child !== sender || request.pid !== sender.pid || !attempt.released || request._tag === 'Taken')
        return;
      attempt.serving = true;
      this.attempt = null;
      if (!this.children.has(attempt.predecessor)) this.launched.delete(attempt.predecessor);
      return;
    }
    if (request._tag === 'Released' || request._tag === 'ReleaseFailed') {
      const attempt = this.attempt;
      if (attempt === null || attempt.predecessor !== sender || request.pid !== sender.pid || attempt.state !== 'ready') {
        this.fail(`pid ${sender.pid} sent a data directory handoff outside its prepared succession`);
        return;
      }
      attempt.released = true;
      if (attempt.failed) return;
      this.answer(attempt.child, request);
      return;
    }
    if (request._tag === 'Cancel') {
      if (this.starting?.id === request.id) {
        this.starting.cancelled = true;
        return;
      }
      const attempt = this.attempt;
      if (attempt === null || attempt.predecessor !== sender || attempt.id !== request.id) return;
      attempt.state = 'cancelled';
      if (this.current === attempt.child) this.current = sender;
      attempt.child.kill('SIGTERM');
      return;
    }
    const refused = this.stopping
      ? 'the launch is stopping'
      : sender !== this.current
        ? 'this server is handing its place to its successor'
        : this.starting !== null
          ? 'a successor is still starting or being cancelled'
          : this.attempt === null
            ? null
            : this.attempt.state === 'ready'
              ? `the predecessor pid ${this.attempt.predecessor.pid} is still leaving`
              : 'a successor is still starting or being cancelled';
    if (refused !== null) {
      this.answer(sender, { _tag: 'Failed', id: request.id, detail: refused });
      return;
    }
    const begin = (child: Child, chain: ProcessChain | undefined): Attempt => {
      this.attempt = {
        id: request.id,
        predecessor: sender,
        child,
        command: request.command.join(' '),
        chain,
        state: 'starting',
        released: false,
        serving: false,
        failed: false,
      };
      return this.attempt;
    };
    let chain: ProcessChain | undefined;
    try {
      chain = inheritedChain(request.env);
      if (chain === undefined) {
        begin(this.spawn(request.command, request.env, sender.pid), undefined);
        return;
      }
    } catch (cause) {
      this.answer(sender, { _tag: 'Failed', id: request.id, detail: `the successor would not start: ${String(cause)}` });
      return;
    }
    const starting = { id: request.id, cancelled: false };
    this.starting = starting;
    const generation = chain;
    let spawned: Attempt | null = null;
    const spawn = () => {
      if (this.stopping) throw new ProcessChainRefused({ detail: 'the launch is stopping', reason: 'stopping' });
      const child = this.spawn(request.command, request.env, sender.pid);
      spawned = begin(child, generation);
      return child;
    };
    void Effect.runPromise(Effect.result(forkChain(this.processes, generation, spawn))).then((forked) => {
      this.starting = null;
      const attempt: Attempt | null = spawned;
      if (attempt === null) {
        if (this.children.has(sender))
          this.answer(sender, {
            _tag: 'Failed',
            id: request.id,
            detail: `the successor would not start: ${forked._tag === 'Failure' ? forked.failure.detail : 'it was never spawned'}`,
          });
      } else if (forked._tag === 'Success' && starting.cancelled && this.attempt === attempt) {
        attempt.state = 'cancelled';
        if (this.current === attempt.child) this.current = sender;
        attempt.child.kill('SIGTERM');
      }
      this.settle();
    });
  }

  private answer(child: Child, answer: LaunchAnswer | Handoff): void {
    try {
      child.send(answer);
    } catch (cause) {
      this.fail(`the server launch could not answer pid ${child.pid}: ${String(cause)}`);
    }
  }

  private fail(detail: string): void {
    this.hasFailed ||= !this.stopping;
    console.error(`[tagma] ${detail}`);
    void this.stop();
  }

  private ended(child: Child, code: number): void {
    this.children.delete(child);
    if (this.attempt?.predecessor !== child) this.launched.delete(child);
    const attempt = this.attempt;
    if (attempt !== null && attempt.child === child) {
      if (attempt.state === 'ready' && !attempt.serving && !this.stopping) {
        if (this.current === child) this.current = null;
        if (attempt.released) {
          this.attempt = null;
          this.returned(attempt.predecessor, attempt.chain);
        } else {
          attempt.failed = true;
          if (!this.children.has(attempt.predecessor)) {
            this.attempt = null;
            this.returned(attempt.predecessor, attempt.chain);
          }
        }
        return this.settle();
      }
      this.attempt = null;
      if (attempt.state === 'starting' && !this.stopping) {
        this.answer(attempt.predecessor, {
          _tag: 'Failed',
          id: attempt.id,
          detail: `the successor ${attempt.command} ended with ${child.signalCode ?? `code ${code}`} before it stood by`,
        });
      }
    } else if (attempt !== null && attempt.predecessor === child) {
      if (attempt.released && !attempt.failed) {
        this.settle();
        return;
      }
      this.attempt = null;
      if (attempt.failed && !this.stopping) this.returned(child, attempt.chain);
      else if (attempt.state !== 'ready') attempt.child.kill('SIGTERM');
      else if (!attempt.released && !this.stopping)
        this.answer(attempt.child, {
          _tag: 'ReleaseFailed',
          pid: child.pid,
          detail: `pid ${child.pid} ended before releasing the data directory`,
        });
    }
    if (this.current === child) {
      this.current = null;
      this.code = code;
      void this.stop();
    }
    this.settle();
  }

  private settle(): void {
    if (this.children.size !== 0 || this.returning !== 0 || this.starting !== null) return;
    for (const [signal, forward] of this.forwards) process.off(signal, forward);
    this.lifetime.end();
    this.settled(this.hasFailed ? 1 : this.code);
  }

  private returned(predecessor: Child, chain: ProcessChain | undefined): void {
    const was = this.launched.get(predecessor);
    if (was === undefined) {
      this.fail(`pid ${predecessor.pid} left no record of how it was started`);
      return;
    }
    this.launched.delete(predecessor);
    const env = { ...was.env };
    for (const name of RETURN_DROPS) delete env[name];
    if (chain === undefined) {
      try {
        this.current = this.spawn(was.command, env, undefined, true);
      } catch (cause) {
        this.fail(`the server launch could not start pid ${predecessor.pid}'s build again: ${String(cause)}`);
      }
      return;
    }
    if (this.current === predecessor) this.current = null;
    this.returning += 1;
    const spawn = () => {
      if (this.stopping) throw new ProcessChainRefused({ detail: 'the launch is stopping', reason: 'stopping' });
      return this.spawn(was.command, { ...env, [PROCESS_CHAIN]: JSON.stringify(chain) }, undefined, true);
    };
    void Effect.runPromise(Effect.result(forkChain(this.processes, chain, spawn))).then((forked) => {
      this.returning -= 1;
      if (forked._tag === 'Success') this.current = forked.success;
      else if (forked.failure.reason === undefined)
        this.fail(`pid ${predecessor.pid}'s build could not return into its process generation: ${forked.failure.detail}`);
      else console.error(`[tagma] pid ${predecessor.pid}'s build does not return: ${forked.failure.detail}`);
      this.settle();
    });
  }
}

export const connectLaunch = (env: NodeJS.ProcessEnv): SuccessorLaunch | undefined => {
  const supervised = env[SUPERVISED] === '1';
  delete env[SUPERVISED];
  const releases = env[RELEASES] === '1';
  delete env[RELEASES];
  const chained = env[CHAINED] === '1';
  delete env[CHAINED];
  if (!supervised) return undefined;
  const lost = () => process.kill(process.pid, 'SIGTERM');
  process.once('disconnect', lost);
  if (!process.connected || process.send === undefined) {
    process.off('disconnect', lost);
    throw new Error('the server launch is not connected');
  }
  let started: string | null = null;
  return {
    releases,
    chained,
    release: (failure) => {
      if (!process.connected || process.send === undefined) throw new Error('the server launch is not connected');
      process.send(handoffOf(process.pid, failure));
    },
    cancel: () => {
      if (started !== null && process.connected) process.send?.({ _tag: 'Cancel', id: started });
      started = null;
    },
    start: (command, environment, signal) =>
      new Promise<void>((resolve, reject) => {
        const id = crypto.randomUUID();
        started = id;
        const clean = () => {
          process.off('message', received);
          process.off('disconnect', disconnected);
          signal.removeEventListener('abort', cancelled);
        };
        const failed = (cause: unknown) => {
          clean();
          reject(cause);
        };
        const disconnected = () => failed(new Error('the server launch disconnected'));
        const cancelled = () => {
          try {
            if (process.connected) process.send?.({ _tag: 'Cancel', id });
          } catch (cause) {
            failed(cause);
            return;
          }
          failed(signal.reason);
        };
        const received = (message: unknown) => {
          let answer: LaunchAnswer;
          try {
            answer = decodeAnswer(message);
          } catch (cause) {
            failed(cause);
            return;
          }
          if (answer.id !== id) return;
          clean();
          if (answer._tag === 'Started') resolve();
          else reject(new Error(answer.detail));
        };
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        if (!process.connected || process.send === undefined) {
          reject(new Error('the server launch is not connected'));
          return;
        }
        process.on('message', received);
        process.once('disconnect', disconnected);
        signal.addEventListener('abort', cancelled, { once: true });
        const defined = Object.fromEntries(
          Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined),
        );
        try {
          process.send({ _tag: 'Start', id, command, env: defined });
        } catch (cause) {
          failed(cause);
        }
      }),
  };
};
